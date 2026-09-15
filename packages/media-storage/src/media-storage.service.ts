import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { MediaBucket } from './schemas/media-asset.schema';

/**
 * Отдельный тип ошибки (не generic Error) — media.service.ts::confirmUpload
 * должен уметь отличить "объект больше лимита" (ожидаемый плохой ввод,
 * трактуется как обычный reject) от инфраструктурного сбоя S3/MinIO
 * (должен остаться 500, не тихо превращаться в "rejected").
 */
export class MediaObjectTooLargeError extends Error {
  constructor(
    public readonly actualSizeBytes: number,
    public readonly maxSizeBytes: number,
  ) {
    super(`Object size ${actualSizeBytes} exceeds limit ${maxSizeBytes}`);
    this.name = 'MediaObjectTooLargeError';
  }
}

const PRESIGNED_UPLOAD_TTL_SECONDS = 300;
const PRESIGNED_DOWNLOAD_TTL_SECONDS = 300;

/**
 * Content-Disposition для подписанной ссылки: ASCII-запасное имя плюс
 * filename* по RFC 5987 для кириллицы и прочего UTF-8. Кавычки, обратный
 * слэш и управляющие символы из имени убираются — имя приходит от
 * пользователя и не должно ломать заголовок.
 */
export function contentDispositionInline(fileName: string): string {
  const safe = fileName.replace(/[\u0000-\u001f\u007f"\\]/g, '').trim() || 'file';
  const ascii = safe.replace(/[^\u0020-\u007e]/g, '_');
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * ADR-008: тонкая обёртка над S3-совместимым (MinIO) клиентом. Приватный/
 * публичный buckets — физически разные bucket-имена, не одна коллекция с
 * access-правилами на объект (defense-in-depth: ошибка в access-policy кода
 * не делает приватный документ публично доступным, поскольку он физически
 * не в том bucket, который вообще выдаётся публично).
 *
 * Живёт в @baza/media-storage (не в apps/api), потому что и API-процесс
 * (presigned upload/download URL для клиента, чтение оригинала для MIME
 * verify), и worker-процесс (чтение оригинала + запись сгенерированных
 * derivative-вариантов) обращаются к ОДНОЙ и той же S3/MinIO конфигурации
 * — тот же принцип, что уже применён к OutboxEventRepository
 * (@baza/domain-events): дублирование клиент-кода в двух apps создало бы
 * риск рассинхронизации конфигурации между процессами.
 */
@Injectable()
export class MediaStorageService {
  private readonly client: S3Client;
  private readonly bucketNames: Record<MediaBucket, string>;

  constructor(private readonly config: ConfigService) {
    this.client = new S3Client({
      endpoint: this.config.getOrThrow<string>('MINIO_ENDPOINT'),
      region: 'us-east-1', // MinIO игнорирует region, но SDK требует непустое значение.
      forcePathStyle: true, // MinIO — path-style ({endpoint}/{bucket}/{key}), не virtual-hosted.
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('MINIO_ACCESS_KEY'),
        secretAccessKey: this.config.getOrThrow<string>('MINIO_SECRET_KEY'),
      },
    });
    this.bucketNames = {
      private: this.config.getOrThrow<string>('MINIO_BUCKET_PRIVATE'),
      public: this.config.getOrThrow<string>('MINIO_BUCKET_PUBLIC'),
    };
  }

  /**
   * Короткоживущая presigned URL на ПРЯМУЮ загрузку клиента в storage
   * (ADR-008: файл не проходит через API-процесс целиком).
   *
   * `contentLength` подписывается вместе с остальными параметрами команды
   * (SigV4) — S3/MinIO требует, чтобы клиентский PUT прислал ТОЧНО такой же
   * `Content-Length`, иначе подпись не совпадает и запрос отклоняется ДО
   * приёма байт. Без этого presigned URL был ограничен только тем, что
   * заявил клиент в `sizeBytes` на уровне API — ничто на стороне storage не
   * мешало залить произвольно большой файл по той же ссылке (security
   * review: unbounded upload).
   */
  async createUploadUrl(params: {
    bucket: MediaBucket;
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketNames[params.bucket],
      Key: params.key,
      ContentType: params.contentType,
      ContentLength: params.contentLength,
    });
    return getSignedUrl(this.client, command, { expiresIn: PRESIGNED_UPLOAD_TTL_SECONDS });
  }

  /**
   * Постоянный публичный URL готового объекта в PUBLIC bucket (team-users
   * avatar и любой другой публичный derivative). НЕ presigned — public
   * bucket по определению открыт, подписывать URL к нему нет смысла (в
   * отличие от createDownloadUrl ниже, единственно для private bucket).
   * MINIO_PUBLIC_BASE_URL — отдельная env-переменная (не MINIO_ENDPOINT
   * напрямую): в dev совпадает с MinIO-адресом, в проде указывает на
   * CDN/прокси перед storage, не жёстко привязывает клиентские URL к
   * инфраструктурному адресу MinIO.
   */
  getPublicUrl(key: string): string {
    const base = this.config.getOrThrow<string>('MINIO_PUBLIC_BASE_URL');
    return `${base.replace(/\/$/, '')}/${key}`;
  }

  /**
   * Короткоживущая signed URL на скачивание — для приватных документов
   * (ADR-008: никогда не постоянный публичный адрес, даже "неугадываемый").
   */
  async createDownloadUrl(params: { bucket: MediaBucket; key: string; fileName?: string }): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketNames[params.bucket],
      Key: params.key,
      // Storage key — `<assetId>/original.pdf`; без заголовка файл сохраняется
      // как «original.pdf». inline: PDF и картинки открываются в браузере.
      ResponseContentDisposition: params.fileName ? contentDispositionInline(params.fileName) : undefined,
    });
    return getSignedUrl(this.client, command, { expiresIn: PRESIGNED_DOWNLOAD_TTL_SECONDS });
  }

  /**
   * Считывает объект целиком в память для magic-byte верификации —
   * приемлемо на MVP-масштабе (см. Media module размерные лимиты в
   * media.constants.ts); для видео/крупных файлов достаточно первых байт,
   * но GetObject с Range здесь не используется намеренно: checksum-подсчёт
   * (следующий шаг того же confirm-flow) всё равно требует полного файла,
   * два отдельных частичных чтения были бы менее эффективны, чем одно
   * полное для MVP-объёмов (лимиты в media.constants.ts).
   *
   * `maxSizeBytes` — опциональная defense-in-depth проверка ДО чтения тела
   * в память: `createUploadUrl` уже подписывает `Content-Length`, но это
   * не гарантия для любого S3-совместимого backend'а (не все реализации
   * строго проверяют подписанный заголовок) — HEAD здесь дешёвый (только
   * метаданные), и вызывающий код (MediaService.confirmUpload) не должен
   * буферизовать в памяти объект, который уже сейчас, по метаданным,
   * превышает лимит. Без maxSizeBytes (worker-путь derivative-generation)
   * поведение не меняется — та ветка читает уже прошедший этот же confirm
   * оригинал.
   */
  async readObject(params: {
    bucket: MediaBucket;
    key: string;
    maxSizeBytes?: number;
  }): Promise<Buffer> {
    if (params.maxSizeBytes !== undefined) {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketNames[params.bucket], Key: params.key }),
      );
      if (typeof head.ContentLength === 'number' && head.ContentLength > params.maxSizeBytes) {
        throw new MediaObjectTooLargeError(head.ContentLength, params.maxSizeBytes);
      }
    }

    const command = new GetObjectCommand({
      Bucket: this.bucketNames[params.bucket],
      Key: params.key,
    });
    const response = await this.client.send(command);
    const body = response.Body;
    if (!body) {
      throw new Error(`MediaStorageService.readObject: пустой Body для ${params.bucket}/${params.key}`);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Запись объекта — worker-side (сгенерированные derivative-варианты).
   * Server-side write, не presigned URL — worker уже прошёл через
   * markProcessing claim, дополнительная presigned-URL-косвенность здесь
   * не нужна (в отличие от клиентского upload-flow, где presigned URL
   * снимает нагрузку с API-процесса, ADR-008).
   */
  async putObject(params: {
    bucket: MediaBucket;
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucketNames[params.bucket],
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    });
    await this.client.send(command);
  }

  /**
   * Удаление объекта — orphaned pending media cleanup (media-cleanup.job.ts).
   * S3/MinIO DeleteObject идемпотентен по контракту (удаление уже
   * отсутствующего ключа не ошибка) — вызывающий код не обязан проверять
   * существование объекта заранее.
   */
  async deleteObject(params: { bucket: MediaBucket; key: string }): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketNames[params.bucket],
      Key: params.key,
    });
    await this.client.send(command);
  }
}
