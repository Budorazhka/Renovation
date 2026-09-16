import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import { PLATFORM_OWNER_SCOPE, type OwnerScope } from '@baza/tenant-scope';
import { emptyDeliveryStats, formatNewsMessage, type DeliveryStats, type NotificationChannels } from '@baza/notifications';
import { runInTransaction } from '../../shared/transactions/run-in-transaction';
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import { AuditService } from '../audit/audit.service';
import { MediaService } from '../media/media.service';
import { IMAGE_MIME_TYPES } from '../media/media.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { NewsArticleRepository, type CreateNewsArticleParams, type NewsArticleContent } from './repository/news-article.repository';
import type { NewsArticleDocument, NewsCategory, NewsSource } from './schemas/news-article.schema';

/** Потолок ленты: сотрудник листает последние новости, архив за годы ему не нужен. */
export const NEWS_FEED_LIMIT = 100;

export interface NewsArticleView {
  id: string;
  source: NewsSource;
  title: string;
  body: string;
  category: NewsCategory;
  pinned: boolean;
  linkUrl: string | null;
  linkLabel: string | null;
  imageAssetId: string | null;
  imageUrl: string | null;
  authorName: string | null;
  publishedAt: string;
  editedAt: string | null;
  version: number;
  /** Сводка рассылки по каналам — только тем, кто новость публикует; остальным null. */
  delivery: DeliveryStats | null;
}

export interface NewsArticleInput {
  title: string;
  body: string;
  category: NewsCategory;
  pinned?: boolean;
  linkUrl?: string;
  linkLabel?: string;
  imageAssetId?: string;
}

/** Куда разослать новость при публикации. */
export type NewsDeliveryRequest = NotificationChannels;

interface IdempotencyParams {
  actorIdentityId: Types.ObjectId;
  key: string;
  requestBody: Record<string, unknown>;
}

type Actor = { type: 'identity' | 'admin_account'; id: Types.ObjectId };

export function toNewsArticleReadModel(
  article: NewsArticleDocument,
  imageUrl: string | null = null,
  delivery: DeliveryStats | null = null,
): NewsArticleView {
  return {
    id: article._id.toString(),
    source: article.source,
    title: article.title,
    body: article.body,
    category: article.category,
    pinned: article.pinned,
    linkUrl: article.linkUrl ?? null,
    linkLabel: article.linkLabel ?? null,
    imageAssetId: article.imageAssetId ? article.imageAssetId.toString() : null,
    imageUrl,
    authorName: article.authorName ?? null,
    publishedAt: article.publishedAt ? article.publishedAt.toISOString() : new Date().toISOString(),
    editedAt: article.editedAt ? article.editedAt.toISOString() : null,
    version: article.version ?? 0,
    delivery,
  };
}

/** Обрезает края и выбрасывает пустую подпись ссылки — хранится только то, что увидит читатель. */
function normalizeContent(input: NewsArticleInput): NewsArticleContent {
  const linkUrl = input.linkUrl?.trim() || undefined;
  const linkLabel = input.linkLabel?.trim();
  return {
    title: input.title.trim(),
    body: input.body.trim(),
    category: input.category,
    pinned: input.pinned ?? false,
    linkUrl,
    linkLabel: linkUrl && linkLabel ? linkLabel : undefined,
    imageAssetId: input.imageAssetId ? new Types.ObjectId(input.imageAssetId) : undefined,
  };
}

/** Картинку проверяем, только если её сменили: уже прикреплённая прошла проверку при прошлой записи. */
function isNewImage(next: Types.ObjectId | undefined, current: Types.ObjectId | undefined): next is Types.ObjectId {
  return !!next && (!current || !next.equals(current));
}

/** Что попадает в журнал о содержимом новости: без текста — он может быть длинным, а в журнале нужен факт. */
function auditSnapshot(article: Pick<NewsArticleDocument, 'title' | 'category' | 'pinned' | 'linkUrl' | 'imageAssetId'>) {
  return {
    title: article.title,
    category: article.category,
    pinned: article.pinned,
    linkUrl: article.linkUrl ?? null,
    imageAssetId: article.imageAssetId ? article.imageAssetId.toString() : null,
  };
}

function wantsDelivery(delivery: NewsDeliveryRequest | undefined): delivery is NewsDeliveryRequest {
  return !!delivery && (delivery.email || delivery.telegram);
}

/**
 * Новости ERP (см. NewsArticleDocument). Публикация, правка и удаление
 * пишутся в журнал (`news.publish`/`news.update`/`news.delete`): новость
 * видят все сотрудники организации, а новость платформы — все организации.
 *
 * Права проверяет вызывающий: ERP-контроллер — грантами news.* позиции,
 * AdminNewsService — грантом news.publish аккаунта администратора.
 * Картинка — MediaAsset того же владельца, что и новость (организация или
 * платформа), purpose news_image, подтверждённое изображение.
 *
 * Рассылка — по желанию публикующего, только при публикации: доставки
 * ставятся в очередь той же транзакцией (NotificationsService), отправляет
 * worker. Получатели — те, кто сейчас работает в организации (или во всех
 * организациях для новости платформы), кроме самого автора.
 */
@Injectable()
export class NewsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly articles: NewsArticleRepository,
    private readonly organizationsService: OrganizationsService,
    private readonly mediaService: MediaService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  /** Каналы рассылки, настроенные на сервере: ERP и админка показывают только их. */
  deliveryChannels(): NotificationChannels {
    return this.notificationsService.channels();
  }

  /** Лента сотрудника; withDelivery — добавить сводку рассылки к новостям компании (тем, кто их публикует). */
  async listFeed(organizationId: Types.ObjectId, options: { withDelivery?: boolean } = {}): Promise<NewsArticleView[]> {
    const rows = await this.articles.listFeed(organizationId, NEWS_FEED_LIMIT);
    return this.toViews(rows, options.withDelivery ? rows.filter((row) => row.source === 'organization') : []);
  }

  async listPlatform(): Promise<NewsArticleView[]> {
    const rows = await this.articles.listPlatform(NEWS_FEED_LIMIT);
    return this.toViews(rows, rows);
  }

  async publishForOrganization(params: {
    organizationId: Types.ObjectId;
    callerPositionId: Types.ObjectId;
    input: NewsArticleInput;
    delivery?: NewsDeliveryRequest;
    idempotency: IdempotencyParams;
    correlationId: string;
  }): Promise<NewsArticleView> {
    const content = normalizeContent(params.input);
    await this.requireNewsImage(content.imageAssetId, { type: 'organization', organizationId: params.organizationId });
    const author = await this.organizationsService.getPositionSummary(params.callerPositionId, params.organizationId);

    let recipients: Types.ObjectId[] = [];
    let from = 'BAZA';
    if (wantsDelivery(params.delivery)) {
      const [identityIds, organization] = await Promise.all([
        this.organizationsService.listActiveOccupantIdentityIds(params.organizationId),
        this.organizationsService.getOrganizationById(params.organizationId),
      ]);
      recipients = identityIds.filter((id) => !id.equals(params.idempotency.actorIdentityId));
      from = organization?.name?.trim() || from;
    }

    return this.publish({
      create: {
        ...content,
        source: 'organization',
        organizationId: params.organizationId,
        authorName: author?.currentOccupantName?.trim() || undefined,
        createdByPositionId: params.callerPositionId,
      },
      actor: { type: 'identity', id: params.idempotency.actorIdentityId },
      delivery: params.delivery,
      recipients,
      from,
      idempotency: params.idempotency,
      operation: 'createNewsArticle',
      correlationId: params.correlationId,
    });
  }

  async publishForPlatform(params: {
    adminAccountId: Types.ObjectId;
    input: NewsArticleInput;
    delivery?: NewsDeliveryRequest;
    idempotency: IdempotencyParams;
    correlationId: string;
  }): Promise<NewsArticleView> {
    const content = normalizeContent(params.input);
    await this.requireNewsImage(content.imageAssetId, PLATFORM_OWNER_SCOPE);

    const recipients = wantsDelivery(params.delivery)
      ? (await this.organizationsService.listAllActiveOccupantIdentityIds()).filter(
          (id) => !id.equals(params.idempotency.actorIdentityId),
        )
      : [];

    return this.publish({
      create: { ...content, source: 'platform', createdByAdminId: params.adminAccountId },
      actor: { type: 'admin_account', id: params.adminAccountId },
      delivery: params.delivery,
      recipients,
      from: 'BAZA',
      idempotency: params.idempotency,
      operation: 'createPlatformNewsArticle',
      correlationId: params.correlationId,
    });
  }

  /** Правка новости компании; чужая или новость платформы — 404, устаревшая версия — 409. */
  async updateForOrganization(params: {
    newsId: Types.ObjectId;
    organizationId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    input: NewsArticleInput;
    expectedVersion: number;
    correlationId: string;
  }): Promise<NewsArticleView> {
    const existing = await this.articles.findForOrganization(params.newsId, params.organizationId);
    if (!existing) {
      throw new NotFoundException('News article not found');
    }
    const content = normalizeContent(params.input);
    if (isNewImage(content.imageAssetId, existing.imageAssetId)) {
      await this.requireNewsImage(content.imageAssetId, { type: 'organization', organizationId: params.organizationId });
    }

    return this.update({
      existing,
      actor: { type: 'identity', id: params.actorIdentityId },
      correlationId: params.correlationId,
      write: (session) =>
        this.articles.updateForOrganization(params.newsId, params.organizationId, params.expectedVersion, content, session),
    });
  }

  /** Правка новости платформы; новость компании этим путём — 404, устаревшая версия — 409. */
  async updatePlatform(params: {
    newsId: Types.ObjectId;
    adminAccountId: Types.ObjectId;
    input: NewsArticleInput;
    expectedVersion: number;
    correlationId: string;
  }): Promise<NewsArticleView> {
    const existing = await this.articles.findPlatform(params.newsId);
    if (!existing) {
      throw new NotFoundException('News article not found');
    }
    const content = normalizeContent(params.input);
    if (isNewImage(content.imageAssetId, existing.imageAssetId)) {
      await this.requireNewsImage(content.imageAssetId, PLATFORM_OWNER_SCOPE);
    }

    return this.update({
      existing,
      actor: { type: 'admin_account', id: params.adminAccountId },
      correlationId: params.correlationId,
      write: (session) => this.articles.updatePlatform(params.newsId, params.expectedVersion, content, session),
    });
  }

  /** Новость компании; чужая или новость платформы — 404 (non-disclosure). */
  async deleteForOrganization(params: {
    newsId: Types.ObjectId;
    organizationId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    correlationId: string;
  }): Promise<void> {
    await runInTransaction(this.connection, async (session) => {
      const { deletedCount } = await this.articles.deleteForOrganization(params.newsId, params.organizationId, session);
      if (deletedCount === 0) {
        throw new NotFoundException('News article not found');
      }
      await this.auditDelete({ type: 'identity', id: params.actorIdentityId }, params.newsId, 'organization', params.correlationId, session);
    });
  }

  async deletePlatform(params: { newsId: Types.ObjectId; adminAccountId: Types.ObjectId; correlationId: string }): Promise<void> {
    await runInTransaction(this.connection, async (session) => {
      const { deletedCount } = await this.articles.deletePlatform(params.newsId, session);
      if (deletedCount === 0) {
        throw new NotFoundException('News article not found');
      }
      await this.auditDelete({ type: 'admin_account', id: params.adminAccountId }, params.newsId, 'platform', params.correlationId, session);
    });
  }

  /**
   * Загрузка картинки к новости платформы (admin-контур): MediaAsset владельца
   * «платформа», purpose news_image. Новости компании грузят картинку обычным
   * POST /media/upload-intent своей организации.
   */
  async createPlatformImageUploadIntent(params: {
    declaredMimeType: string;
    sizeBytes: number;
  }): Promise<{ assetId: string; uploadUrl: string }> {
    return this.mediaService.createUploadIntent({
      ownerScope: PLATFORM_OWNER_SCOPE,
      declaredMimeType: params.declaredMimeType,
      sizeBytes: params.sizeBytes,
      purpose: 'news_image',
      bucket: 'public',
    });
  }

  async confirmPlatformImageUpload(params: {
    assetId: Types.ObjectId;
    actorIdentityId: Types.ObjectId;
    correlationId: string;
  }): Promise<{ status: 'verified' | 'rejected' }> {
    return this.mediaService.confirmUpload({ ...params, expectedOwnerScope: PLATFORM_OWNER_SCOPE });
  }

  /**
   * Картинка к новости: MediaAsset того же владельца (чужой — 404, как и
   * несуществующий), назначения news_image в публичном бакете и уже
   * подтверждённое изображение — иначе в ленте оказалась бы битая ссылка.
   */
  private async requireNewsImage(assetId: Types.ObjectId | undefined, ownerScope: OwnerScope): Promise<void> {
    if (!assetId) return;
    const asset = await this.mediaService.getAssetForOwnerScope(assetId, ownerScope);
    if (!asset) {
      throw new NotFoundException('Media asset not found');
    }
    if (asset.purpose !== 'news_image' || asset.bucket !== 'public') {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Media asset is not a news image');
    }
    if (asset.status !== 'verified' || !asset.verifiedMimeType || !IMAGE_MIME_TYPES.has(asset.verifiedMimeType)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'News image is not a verified image yet');
    }
  }

  /** Картинки пачкой; сводка рассылки — только для строк из withDeliveryFor. */
  private async toViews(rows: NewsArticleDocument[], withDeliveryFor: NewsArticleDocument[]): Promise<NewsArticleView[]> {
    const imageIds = rows.map((row) => row.imageAssetId).filter((id): id is Types.ObjectId => !!id);
    const deliveryIds = withDeliveryFor.map((row) => row._id);
    const [urls, stats] = await Promise.all([
      this.mediaService.getPublicImageUrls(imageIds),
      deliveryIds.length ? this.notificationsService.newsDeliveryStats(deliveryIds) : Promise.resolve(new Map<string, DeliveryStats>()),
    ]);
    const withDelivery = new Set(deliveryIds.map((id) => id.toString()));
    return rows.map((row) =>
      toNewsArticleReadModel(
        row,
        row.imageAssetId ? (urls.get(row.imageAssetId.toString()) ?? null) : null,
        withDelivery.has(row._id.toString()) ? (stats.get(row._id.toString()) ?? emptyDeliveryStats()) : null,
      ),
    );
  }

  private async publish(params: {
    create: CreateNewsArticleParams;
    actor: Actor;
    delivery?: NewsDeliveryRequest;
    recipients: Types.ObjectId[];
    from: string;
    idempotency: IdempotencyParams;
    operation: string;
    correlationId: string;
  }): Promise<NewsArticleView> {
    const feedUrl = this.notificationsService.newsFeedUrl();
    const article = await runInTransaction(this.connection, async (session) => {
      const created = await this.articles.create(params.create, session);

      await this.auditService.append(
        {
          actor: params.actor,
          action: 'news.publish',
          resource: 'news',
          resourceId: created._id,
          after: {
            source: created.source,
            ...auditSnapshot(created),
            sendEmail: params.delivery?.email ?? false,
            sendTelegram: params.delivery?.telegram ?? false,
          },
          correlationId: params.correlationId,
        },
        session,
      );
      if (wantsDelivery(params.delivery)) {
        await this.notificationsService.queueNewsDeliveries(
          {
            newsId: created._id,
            recipientIdentityIds: params.recipients,
            channels: params.delivery,
            message: formatNewsMessage({
              title: created.title,
              body: created.body,
              from: params.from,
              linkUrl: created.linkUrl,
              linkLabel: created.linkLabel,
              feedUrl,
            }),
          },
          session,
        );
      }
      await this.idempotencyService.record(
        {
          identityId: params.idempotency.actorIdentityId,
          operation: params.operation,
          key: params.idempotency.key,
          requestBody: params.idempotency.requestBody,
          responseStatus: 201,
          // Ответ повтора — без ссылки на картинку и сводки: их строит чтение ленты.
          responseBody: toNewsArticleReadModel(created) as unknown as Record<string, unknown>,
        },
        session,
      );
      return created;
    });
    const [view] = await this.toViews([article], [article]);
    return view!;
  }

  private async update(params: {
    existing: NewsArticleDocument;
    actor: Actor;
    correlationId: string;
    write: (session: ClientSession) => Promise<NewsArticleDocument | null>;
  }): Promise<NewsArticleView> {
    const updated = await runInTransaction(this.connection, async (session) => {
      const row = await params.write(session);
      if (!row) {
        throw new AppException(ErrorCode.VERSION_CONFLICT, 'News article was modified by another request — refresh and retry');
      }
      await this.auditService.append(
        {
          actor: params.actor,
          action: 'news.update',
          resource: 'news',
          resourceId: row._id,
          before: auditSnapshot(params.existing),
          after: auditSnapshot(row),
          correlationId: params.correlationId,
        },
        session,
      );
      return row;
    });
    const [view] = await this.toViews([updated], [updated]);
    return view!;
  }

  private async auditDelete(actor: Actor, newsId: Types.ObjectId, source: NewsSource, correlationId: string, session: ClientSession): Promise<void> {
    await this.auditService.append(
      { actor, action: 'news.delete', resource: 'news', resourceId: newsId, before: { source }, correlationId },
      session,
    );
  }
}
