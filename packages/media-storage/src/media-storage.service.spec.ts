import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { contentDispositionInline, MediaObjectTooLargeError, MediaStorageService } from './media-storage.service';
import type { ConfigService } from '@nestjs/config';

// getSignedUrl — non-configurable named export в commonjs-интеропе этого
// пакета (jest.spyOn падает с "Cannot redefine property") — jest.mock
// подменяет весь модуль ДО импорта, единственный надёжный способ проверить,
// с какими аргументами MediaStorageService.createUploadUrl его вызывает.
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function makeConfigService(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    MINIO_ENDPOINT: 'http://localhost:9000',
    MINIO_ACCESS_KEY: 'test-access',
    MINIO_SECRET_KEY: 'test-secret',
    MINIO_BUCKET_PRIVATE: 'baza-private-test',
    MINIO_BUCKET_PUBLIC: 'baza-public-test',
    ...overrides,
  };
  return {
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`Missing config: ${key}`);
      return value;
    },
  } as unknown as ConfigService;
}

/**
 * Не мокирует S3Client целиком (не через aws-sdk-client-mock — не хотим
 * тянуть ещё одну зависимость только ради теста) — вместо этого spy на
 * S3Client.prototype.send, реальный конструктор S3Client вызывается,
 * реальный сетевой вызов — нет.
 */
describe('MediaStorageService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('резолвит private/public bucket-имена из ConfigService', async () => {
    const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({
      Body: Readable.from([Buffer.from('data')]),
    } as never);

    const service = new MediaStorageService(makeConfigService());
    await service.readObject({ bucket: 'private', key: 'x/original.png' });

    const command = sendSpy.mock.calls[0]![0] as { input: { Bucket: string; Key: string } };
    expect(command.input.Bucket).toBe('baza-private-test');
    expect(command.input.Key).toBe('x/original.png');
  });

  it('readObject собирает Body-поток в единый Buffer', async () => {
    jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({
      Body: Readable.from([Buffer.from('hello '), Buffer.from('world')]),
    } as never);

    const service = new MediaStorageService(makeConfigService());
    const result = await service.readObject({ bucket: 'public', key: 'x' });

    expect(result.toString('utf-8')).toBe('hello world');
  });

  /**
   * Security review: presigned URL раньше не подписывал Content-Length —
   * клиент мог заливать по этой ссылке произвольно большой файл, ничто на
   * стороне S3/MinIO этого не проверяло. Подписанный ContentLength заставляет
   * S3-совместимый backend отклонить PUT с несовпадающим заголовком ДО
   * приёма байт.
   */
  it('createUploadUrl подписывает ContentLength вместе с Bucket/Key/ContentType', async () => {
    const getSignedUrlSpy = jest.mocked(getSignedUrl);
    getSignedUrlSpy.mockResolvedValue('https://minio.example.com/presigned-put');

    const service = new MediaStorageService(makeConfigService());
    const url = await service.createUploadUrl({
      bucket: 'private',
      key: 'assetId/original.jpg',
      contentType: 'image/jpeg',
      contentLength: 12_345,
    });

    expect(url).toBe('https://minio.example.com/presigned-put');
    const command = getSignedUrlSpy.mock.calls[0]![1] as unknown as {
      input: { Bucket: string; Key: string; ContentType: string; ContentLength: number };
    };
    expect(command.input.Bucket).toBe('baza-private-test');
    expect(command.input.Key).toBe('assetId/original.jpg');
    expect(command.input.ContentType).toBe('image/jpeg');
    expect(command.input.ContentLength).toBe(12_345);
  });

  it('createDownloadUrl с именем файла подписывает Content-Disposition, без имени — нет', async () => {
    const getSignedUrlSpy = jest.mocked(getSignedUrl);
    getSignedUrlSpy.mockResolvedValue('https://minio.example.com/presigned-get');
    const service = new MediaStorageService(makeConfigService());

    await service.createDownloadUrl({ bucket: 'private', key: 'assetId/original.pdf', fileName: 'КП ЖК.pdf' });
    await service.createDownloadUrl({ bucket: 'private', key: 'assetId/original.pdf' });

    const [withName, withoutName] = getSignedUrlSpy.mock.calls.slice(-2).map(
      (call) => call[1] as unknown as { input: { ResponseContentDisposition?: string } },
    );
    expect(withName!.input.ResponseContentDisposition).toBe(
      `inline; filename="__ __.pdf"; filename*=UTF-8''%D0%9A%D0%9F%20%D0%96%D0%9A.pdf`,
    );
    expect(withoutName!.input.ResponseContentDisposition).toBeUndefined();
  });

  it('contentDispositionInline вырезает кавычки, обратный слэш и переводы строк из имени', () => {
    expect(contentDispositionInline('a"b\\c\r\nd.pdf')).toBe(`inline; filename="abcd.pdf"; filename*=UTF-8''abcd.pdf`);
    expect(contentDispositionInline('  ')).toBe(`inline; filename="file"; filename*=UTF-8''file`);
    expect(contentDispositionInline("it's (1).pdf")).toBe(`inline; filename="it's (1).pdf"; filename*=UTF-8''it%27s%20%281%29.pdf`);
  });

  /**
   * Security review: presigned upload раньше не имел серверной проверки
   * фактического размера объекта в storage — HEAD ДО GetObject защищает от
   * буферизации оверсайз-файла в память, даже если подписанный
   * Content-Length (createUploadUrl) почему-либо не enforced backend'ом.
   */
  it('readObject с maxSizeBytes делает HEAD и бросает MediaObjectTooLargeError, если объект больше лимита', async () => {
    const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return { ContentLength: 50_000_000 } as never;
      }
      throw new Error('GetObject не должен вызываться, если HEAD уже показал превышение лимита');
    });

    const service = new MediaStorageService(makeConfigService());

    await expect(
      service.readObject({ bucket: 'public', key: 'x/original.jpg', maxSizeBytes: 20_000_000 }),
    ).rejects.toBeInstanceOf(MediaObjectTooLargeError);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('readObject с maxSizeBytes читает Body как обычно, если объект в пределах лимита', async () => {
    jest.spyOn(S3Client.prototype, 'send').mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return { ContentLength: 1024 } as never;
      }
      return { Body: Readable.from([Buffer.from('ok')]) } as never;
    });

    const service = new MediaStorageService(makeConfigService());
    const result = await service.readObject({ bucket: 'public', key: 'x', maxSizeBytes: 20_000_000 });

    expect(result.toString('utf-8')).toBe('ok');
  });

  it('readObject без maxSizeBytes НЕ делает HEAD (обратная совместимость с worker-путём)', async () => {
    const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({
      Body: Readable.from([Buffer.from('data')]),
    } as never);

    const service = new MediaStorageService(makeConfigService());
    await service.readObject({ bucket: 'public', key: 'x' });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]![0]).not.toBeInstanceOf(HeadObjectCommand);
  });

  it('readObject бросает, если Body отсутствует в ответе', async () => {
    jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({ Body: undefined } as never);

    const service = new MediaStorageService(makeConfigService());

    await expect(service.readObject({ bucket: 'public', key: 'x' })).rejects.toThrow(/пустой Body/);
  });

  it('putObject отправляет Bucket/Key/Body/ContentType в public bucket', async () => {
    const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);

    const service = new MediaStorageService(makeConfigService());
    await service.putObject({
      bucket: 'public',
      key: 'assetId/thumbnail/1.webp',
      body: Buffer.from('webp-bytes'),
      contentType: 'image/webp',
    });

    const command = sendSpy.mock.calls[0]![0] as {
      input: { Bucket: string; Key: string; Body: Buffer; ContentType: string };
    };
    expect(command.input.Bucket).toBe('baza-public-test');
    expect(command.input.Key).toBe('assetId/thumbnail/1.webp');
    expect(command.input.ContentType).toBe('image/webp');
  });

  it('конструктор бросает, если обязательная env-переменная отсутствует', () => {
    const incompleteConfig = makeConfigService({ MINIO_ENDPOINT: undefined as unknown as string });
    expect(() => new MediaStorageService(incompleteConfig)).toThrow(/Missing config/);
  });

  it('deleteObject отправляет Bucket/Key для приватного bucket', async () => {
    const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);

    const service = new MediaStorageService(makeConfigService());
    await service.deleteObject({ bucket: 'private', key: 'assetId/original.png' });

    const command = sendSpy.mock.calls[0]![0] as { input: { Bucket: string; Key: string } };
    expect(command.input.Bucket).toBe('baza-private-test');
    expect(command.input.Key).toBe('assetId/original.png');
  });

  describe('getPublicUrl', () => {
    it('строит URL из MINIO_PUBLIC_BASE_URL + key, не привязываясь к MINIO_ENDPOINT', () => {
      const service = new MediaStorageService(
        makeConfigService({ MINIO_PUBLIC_BASE_URL: 'https://cdn.example.com/baza-public' }),
      );

      const url = service.getPublicUrl('assetId/card/1.webp');

      expect(url).toBe('https://cdn.example.com/baza-public/assetId/card/1.webp');
    });

    it('обрезает лишний завершающий слэш в base URL', () => {
      const service = new MediaStorageService(
        makeConfigService({ MINIO_PUBLIC_BASE_URL: 'https://cdn.example.com/baza-public/' }),
      );

      const url = service.getPublicUrl('assetId/card/1.webp');

      expect(url).toBe('https://cdn.example.com/baza-public/assetId/card/1.webp');
    });

    it('бросает, если MINIO_PUBLIC_BASE_URL отсутствует', () => {
      const service = new MediaStorageService(
        makeConfigService({ MINIO_PUBLIC_BASE_URL: undefined as unknown as string }),
      );

      expect(() => service.getPublicUrl('assetId/card/1.webp')).toThrow(/Missing config/);
    });
  });
});
