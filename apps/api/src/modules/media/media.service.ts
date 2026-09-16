import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { runInTransaction } from '../../shared/transactions/run-in-transaction';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import {
  MediaAssetRepository,
  MediaObjectTooLargeError,
  MediaStorageService,
  type MediaBucket,
  type MediaVariant,
} from '@baza/media-storage';
import { ownerScopesEqual, type OwnerScope } from '@baza/tenant-scope';
import { MediaMimeVerifierService } from './media-mime-verifier.service';
import { IMAGE_MIME_TYPES, MAX_UPLOAD_SIZE_BYTES } from './media.constants';

export interface CreateUploadIntentParams {
  ownerScope: OwnerScope;
  declaredMimeType: string;
  sizeBytes: number;
  purpose: string;
  /**
   * ADR-008: приватный/публичный buckets физически разделены. Вызывающий
   * код (controller) решает bucket по purpose (например, `agency_document`
   * → private, `unit_photo` → public) — MediaService не хардкодит это
   * решение, чтобы не дублировать purpose→bucket маппинг в двух местах.
   */
  bucket: MediaBucket;
}

export interface ConfirmUploadParams {
  assetId: Types.ObjectId;
  actorIdentityId: Types.ObjectId;
  /**
   * ADR-002 требование 1 (tenant escape prevention) — server-derived, из
   * VerifiedTenantContext, никогда из URL/body. Без этой проверки любая
   * организация, зная (или подобрав) чужой assetId, могла бы прочитать
   * содержимое чужого файла (включая приватные agency_document), сменить
   * его статус и триггернуть worker на генерацию публичных derivative-
   * вариантов чужого media_asset — обнаружено ревью, было отсутствующей
   * проверкой, не покрытым edge case.
   */
  expectedOwnerScope: OwnerScope;
  correlationId: string;
}

@Injectable()
export class MediaService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly mediaAssetRepository: MediaAssetRepository,
    private readonly storage: MediaStorageService,
    private readonly mimeVerifier: MediaMimeVerifierService,
    private readonly auditService: AuditService,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Фаза 1 upload flow (ADR-008): создаёт pending media_assets-запись +
   * короткоживущую presigned URL на прямую загрузку в storage. Файл ещё
   * не существует в storage на этом шаге — только intent.
   */
  async createUploadIntent(
    params: CreateUploadIntentParams,
  ): Promise<{ assetId: string; uploadUrl: string }> {
    if (params.sizeBytes > MAX_UPLOAD_SIZE_BYTES) {
      throw new Error(
        `MediaService.createUploadIntent: sizeBytes ${params.sizeBytes} превышает лимит ${MAX_UPLOAD_SIZE_BYTES}`,
      );
    }

    // Storage key детерминирован заранее (до создания записи), потому что
    // сам _id понадобится и для key, и для записи — генерируем id вручную,
    // а не полагаемся на Mongo auto-generated _id, чтобы не делать create()
    // в два прохода (создать → узнать _id → update с key).
    const assetId = new Types.ObjectId();
    const extension = declaredMimeToExtension(params.declaredMimeType);
    const originalPath = `${assetId.toString()}/original${extension}`;

    const uploadUrl = await this.storage.createUploadUrl({
      bucket: params.bucket,
      key: originalPath,
      contentType: params.declaredMimeType,
      contentLength: params.sizeBytes,
    });

    await this.mediaAssetRepository.create({
      _id: assetId,
      ownerScope: params.ownerScope,
      declaredMimeType: params.declaredMimeType,
      sizeBytes: params.sizeBytes,
      bucket: params.bucket,
      originalPath,
      purpose: params.purpose,
    });

    return { assetId: assetId.toString(), uploadUrl };
  }

  /**
   * Фаза 3 upload flow (ADR-008): клиент подтвердил завершение загрузки.
   * Синхронно верифицирует magic-byte MIME (не выносится в worker —
   * пользователь ждёт ответ на confirm, чтобы понять, принят файл или нет;
   * derivative-варианты/EXIF-strip — вот это уже асинхронный worker-шаг,
   * запускаемый через outbox-событие MediaVerified ниже).
   */
  async confirmUpload(params: ConfirmUploadParams): Promise<{ status: 'verified' | 'rejected' }> {
    const asset = await this.mediaAssetRepository.findById(params.assetId);
    if (!asset || !ownerScopesEqual(asset.ownerScope, params.expectedOwnerScope)) {
      // Один и тот же NotFoundException для "не существует" и "существует,
      // но принадлежит другому владельцу" — не раскрываем cross-tenant
      // существование (тот же паттерн, что organizations.service.ts::
      // assignOccupant и error-catalog.md NOT_FOUND). Проверка ДО чтения
      // содержимого файла из storage — неавторизованный запрос не должен
      // тратить работу и точно не должен получить доступ к байтам чужого
      // файла, даже временно в памяти процесса.
      throw new NotFoundException('Media asset not found');
    }

    // maxSizeBytes: HEAD-проверка реального размера объекта в storage ДО
    // чтения тела в память — presigned URL уже подписывает Content-Length
    // (MediaStorageService.createUploadUrl), но это defense-in-depth на
    // случай backend'а, который не проверяет подписанный заголовок строго
    // (security review: unbounded upload). Превышение лимита — тот же
    // путь, что провал MIME-верификации: asset помечается rejected, не
    // 500 — оверсайз-файл такой же ожидаемый "плохой ввод", как и
    // неверный magic-byte.
    let buffer: Buffer;
    try {
      buffer = await this.storage.readObject({
        bucket: asset.bucket,
        key: asset.originalPath,
        maxSizeBytes: MAX_UPLOAD_SIZE_BYTES,
      });
    } catch (error) {
      if (!(error instanceof MediaObjectTooLargeError)) {
        throw error;
      }
      return runInTransaction(this.connection, async (session) => {
        const { modifiedCount } = await this.mediaAssetRepository.markRejected(
          asset._id,
          'File exceeds size limit',
          session,
        );
        if (modifiedCount === 0) {
          return { status: 'rejected' as const };
        }
        await this.auditService.append(
          {
            actor: { type: 'identity', id: params.actorIdentityId },
            action: 'media.reject',
            resource: 'media_asset',
            resourceId: asset._id,
            reason: 'File exceeds size limit',
            correlationId: params.correlationId,
          },
          session,
        );
        return { status: 'rejected' as const };
      });
    }
    const verifyResult = await this.mimeVerifier.verify(buffer);

    // Magic-byte verify подтверждает, что реальный MIME входит в allowlist,
    // но НЕ подтверждает, что он совпадает с тем, что клиент заявил на
    // upload-intent (declaredMimeType). Оба могут независимо входить в
    // allowlist (заявлен image/png, реально залит application/pdf) — без
    // этой проверки объект прошёл бы verify, но storage Content-Type
    // остался бы соответствовать заявленному, а не реальному содержимому
    // (data-integrity issue, найдено ревью).
    const result =
      verifyResult.verified && verifyResult.mimeType !== asset.declaredMimeType
        ? {
            verified: false as const,
            checksum: verifyResult.checksum,
            mimeType: verifyResult.mimeType,
            rejectionReason: `Реальный MIME (${verifyResult.mimeType}) не совпадает с заявленным на upload-intent (${asset.declaredMimeType})`,
          }
        : verifyResult;

    return runInTransaction(this.connection, async (session) => {
      if (!result.verified || !result.mimeType) {
        const { modifiedCount } = await this.mediaAssetRepository.markRejected(
          asset._id,
          result.rejectionReason ?? 'MIME verification failed',
          session,
        );
        // modifiedCount === 0: конкурентный confirmUpload для этого же
        // asset уже перевёл его из 'pending' в другой статус между нашим
        // findById и этим updateOne — этот вызов не должен создавать
        // повторную audit-запись/outbox-событие поверх того, что уже
        // сделал победивший конкурент (иначе дублирующийся side-effect,
        // именно то, что ADR-006 идемпотентность обязана предотвращать).
        if (modifiedCount === 0) {
          return { status: 'rejected' as const };
        }
        await this.auditService.append(
          {
            actor: { type: 'identity', id: params.actorIdentityId },
            action: 'media.reject',
            resource: 'media_asset',
            resourceId: asset._id,
            reason: result.rejectionReason,
            correlationId: params.correlationId,
          },
          session,
        );
        return { status: 'rejected' as const };
      }

      const { modifiedCount } = await this.mediaAssetRepository.markVerified(
        asset._id,
        { verifiedMimeType: result.mimeType, checksum: result.checksum },
        session,
      );
      if (modifiedCount === 0) {
        // См. комментарий в ветке rejected выше — тот же принцип.
        return { status: 'verified' as const };
      }

      await this.auditService.append(
        {
          actor: { type: 'identity', id: params.actorIdentityId },
          action: 'media.verify',
          resource: 'media_asset',
          resourceId: asset._id,
          after: { verifiedMimeType: result.mimeType, checksum: result.checksum },
          correlationId: params.correlationId,
        },
        session,
      );

      await this.outboxService.publish(
        {
          eventType: 'MediaVerified',
          aggregateType: 'media_asset',
          aggregateId: asset._id,
          payload: {
            bucket: asset.bucket,
            originalPath: asset.originalPath,
            mimeType: result.mimeType,
            purpose: asset.purpose,
          },
          deduplicationKey: `media_asset:${asset._id.toString()}:MediaVerified`,
        },
        session,
      );

      return { status: 'verified' as const };
    });
  }

  /**
   * team-users avatar (TeamService.toView) / setPositionAvatar
   * (organizations.service.ts) — единственная точка доступа к MediaAsset
   * для внешних модулей (ADR-002 требование 2/module-boundaries тест —
   * MediaAssetRepository не должен импортироваться напрямую другими
   * модулями, тот же принцип, что AuthService.findByIds для Identity).
   *
   * expectedOwnerScope проверяется здесь же (tenant-escape prevention,
   * тот же паттерн, что confirmUpload) — вызывающий код не должен уметь
   * прочитать чужой asset, даже зная/подобрав чужой assetId.
   */
  async getAssetForOwnerScope(
    assetId: Types.ObjectId,
    expectedOwnerScope: OwnerScope,
  ): Promise<{ status: 'pending' | 'verified' | 'rejected'; variants: MediaVariant[]; bucket: MediaBucket; purpose?: string; declaredMimeType?: string; verifiedMimeType?: string; sizeBytes?: number; createdAt?: Date } | null> {
    const asset = await this.mediaAssetRepository.findById(assetId);
    if (!asset || !ownerScopesEqual(asset.ownerScope, expectedOwnerScope)) {
      return null;
    }
    return {
      status: asset.status,
      variants: asset.variants,
      bucket: asset.bucket,
      purpose: asset.purpose,
      declaredMimeType: asset.declaredMimeType,
      verifiedMimeType: asset.verifiedMimeType,
      sizeBytes: asset.sizeBytes,
      createdAt: asset.createdAt,
    };
  }

  /**
   * Публичные ссылки на картинки пачкой (лента новостей): вариант `detail`
   * без EXIF, пока worker его не построил — оригинал. Только подтверждённые
   * изображения из ПУБЛИЧНОГО бакета: приватный asset ссылки не получает ни
   * при каких условиях. Владение не сверяется — публичный бакет открыт по
   * определению; право прикрепить картинку проверяет вызывающий при записи.
   */
  async getPublicImageUrls(assetIds: Types.ObjectId[]): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    if (assetIds.length === 0) return urls;
    const assets = await this.mediaAssetRepository.findByIds(assetIds);
    for (const asset of assets) {
      if (asset.bucket !== 'public' || asset.status !== 'verified') continue;
      if (!asset.verifiedMimeType || !IMAGE_MIME_TYPES.has(asset.verifiedMimeType)) continue;
      const variant = asset.variants.find((v) => v.type === 'detail') ?? asset.variants.find((v) => v.type === 'card');
      urls.set(asset._id.toString(), this.storage.getPublicUrl(variant ? variant.assetPath : asset.originalPath));
    }
    return urls;
  }

  async getAssetsForOwnerScope(
    assetIds: Types.ObjectId[],
    expectedOwnerScope: OwnerScope,
  ): Promise<Map<string, { status: 'pending' | 'verified' | 'rejected'; variants: MediaVariant[]; bucket: MediaBucket; declaredMimeType: string; verifiedMimeType?: string; sizeBytes: number; createdAt: Date; originalPath: string }>> {
    const assets = await this.mediaAssetRepository.findByIds(assetIds);
    const result = new Map<string, { status: 'pending' | 'verified' | 'rejected'; variants: MediaVariant[]; bucket: MediaBucket; declaredMimeType: string; verifiedMimeType?: string; sizeBytes: number; createdAt: Date; originalPath: string }>();
    for (const asset of assets) {
      if (ownerScopesEqual(asset.ownerScope, expectedOwnerScope)) {
        result.set(asset._id.toString(), {
          status: asset.status,
          variants: asset.variants,
          bucket: asset.bucket,
          declaredMimeType: asset.declaredMimeType,
          verifiedMimeType: asset.verifiedMimeType,
          sizeBytes: asset.sizeBytes,
          createdAt: asset.createdAt,
          originalPath: asset.originalPath,
        });
      }
    }
    return result;
  }

  /**
   * Task attachments (CrmService) — единственная точка получения короткоживущей
   * ссылки на скачивание приватного asset'а: `MediaStorageService` не
   * экспортируется из `MediaModule` (ADR-001/module-boundaries тест), только
   * этот метод умеет превратить assetId+ownerScope в подписанный URL. Тот же
   * tenant-escape-принцип, что `getAssetForOwnerScope` выше: неверный
   * ownerScope или неподтверждённый asset — `null`, не URL; вызывающий код
   * сам решает, во что это превратить (обычно NotFoundException — тот же
   * non-disclosure паттерн, единый 404 для "нет" и "чужой").
   */
  async createDownloadUrlForOwnerScope(
    assetId: Types.ObjectId,
    expectedOwnerScope: OwnerScope,
    fileName?: string,
  ): Promise<{ url: string } | null> {
    const asset = await this.mediaAssetRepository.findById(assetId);
    if (!asset || !ownerScopesEqual(asset.ownerScope, expectedOwnerScope) || asset.status !== 'verified') {
      return null;
    }
    const url = await this.storage.createDownloadUrl({ bucket: asset.bucket, key: asset.originalPath, fileName });
    return { url };
  }

  /**
   * Публичный URL variant'а — только для 'public' bucket asset'ов (avatar/
   * фото объекта недвижимости); вызывающий код (TeamService) не должен
   * пытаться получить постоянный URL для 'private' asset'ов (agency_document
   * и т.п.) — та архитектурная граница уже enforced на уровне bucket'а
   * (ADR-008), не проверяется здесь повторно, просто не имеет смысла для
   * private в текущих use-case'ах.
   */
  getVariantUrl(variant: MediaVariant): string {
    return this.storage.getPublicUrl(variant.assetPath);
  }

  getPublicUrl(key: string): string {
    return this.storage.getPublicUrl(key);
  }
}

/**
 * Только для построения storage key расширения файла — не источник истины
 * для MIME (это magic-byte verify на confirm). Используется здесь
 * исключительно как человекочитаемое расширение в пути объекта, ошибка
 * в этом маппинге не создаёт security-риска (объект всё равно проходит
 * verify до использования где-либо).
 */
function declaredMimeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
  };
  return map[mimeType] ?? '';
}
