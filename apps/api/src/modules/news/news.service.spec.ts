import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { NewsService, NEWS_FEED_LIMIT } from './news.service';
import type { NewsArticleRepository } from './repository/news-article.repository';
import type { OrganizationsService } from '../organizations/organizations.service';
import type { MediaService } from '../media/media.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { AuditService } from '../audit/audit.service';
import type { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import type { NewsArticleDocument } from './schemas/news-article.schema';
import { AppException } from '../../shared/errors/app-exception';

function makeMockConnection() {
  return {
    startSession: jest.fn().mockResolvedValue({
      withTransaction: async (work: () => Promise<unknown>) => work(),
      endSession: jest.fn().mockResolvedValue(undefined),
    }),
  };
}

const organizationId = new Types.ObjectId();
const callerPositionId = new Types.ObjectId();
const actorIdentityId = new Types.ObjectId();
const idempotency = { actorIdentityId, key: 'k-1', requestBody: { title: 'T' } };

function articleDoc(overrides: Partial<NewsArticleDocument> = {}): NewsArticleDocument {
  return {
    _id: new Types.ObjectId(),
    source: 'organization',
    organizationId,
    title: 'Регламент по лидам',
    body: 'Квалификация за 30 минут',
    category: 'company',
    pinned: false,
    version: 0,
    publishedAt: new Date('2026-09-15T10:00:00.000Z'),
    ...overrides,
  } as unknown as NewsArticleDocument;
}

const verifiedImage = {
  status: 'verified',
  bucket: 'public',
  purpose: 'news_image',
  verifiedMimeType: 'image/webp',
  variants: [],
};

function makeService(
  overrides: {
    articles?: Partial<NewsArticleRepository>;
    organizations?: Partial<OrganizationsService>;
    media?: Partial<MediaService>;
    notifications?: Partial<NotificationsService>;
  } = {},
) {
  const append = jest.fn().mockResolvedValue(undefined);
  const record = jest.fn().mockResolvedValue(undefined);
  const media = {
    getPublicImageUrls: jest.fn().mockResolvedValue(new Map()),
    getAssetForOwnerScope: jest.fn().mockResolvedValue(verifiedImage),
    ...overrides.media,
  };
  const notifications = {
    channels: jest.fn().mockReturnValue({ email: true, telegram: true }),
    newsFeedUrl: jest.fn().mockReturnValue('https://erp.baza.sale/#/dashboard/settings/info/news'),
    queueNewsDeliveries: jest.fn().mockResolvedValue({ email: 0, telegram: 0 }),
    newsDeliveryStats: jest.fn().mockResolvedValue(new Map()),
    ...overrides.notifications,
  };
  const service = new NewsService(
    makeMockConnection() as never,
    (overrides.articles ?? {}) as NewsArticleRepository,
    (overrides.organizations ?? {}) as OrganizationsService,
    media as unknown as MediaService,
    notifications as unknown as NotificationsService,
    { append } as unknown as AuditService,
    { record } as unknown as IdempotencyService,
  );
  return { service, append, record, media, notifications };
}

describe('NewsService.listFeed', () => {
  it('лента — новости платформы и своей организации, с потолком выдачи и ссылками на картинки', async () => {
    const imageAssetId = new Types.ObjectId();
    const listFeed = jest.fn().mockResolvedValue([
      articleDoc({ source: 'platform', organizationId: undefined, authorName: undefined, imageAssetId }),
      articleDoc({ authorName: 'Марина Петрова' }),
    ]);
    const { service, media } = makeService({
      articles: { listFeed },
      media: { getPublicImageUrls: jest.fn().mockResolvedValue(new Map([[imageAssetId.toString(), 'https://cdn/x/detail/1.webp']])) },
    });

    const items = await service.listFeed(organizationId);

    expect(listFeed).toHaveBeenCalledWith(organizationId, NEWS_FEED_LIMIT);
    expect(media.getPublicImageUrls).toHaveBeenCalledWith([imageAssetId]);
    expect(items.map((item) => [item.source, item.authorName, item.imageUrl])).toEqual([
      ['platform', null, 'https://cdn/x/detail/1.webp'],
      ['organization', 'Марина Петрова', null],
    ]);
    expect(items[0]!.publishedAt).toBe('2026-09-15T10:00:00.000Z');
  });
});

describe('NewsService.publishForOrganization', () => {
  it('подписывает новость именем сотрудника, пишет аудит и идемпотентность в одной транзакции', async () => {
    const create = jest.fn().mockImplementation(async (params) => articleDoc({ ...params }));
    const getPositionSummary = jest.fn().mockResolvedValue({ fixedRole: 'director', currentOccupantName: ' Марина Петрова ' });
    const { service, append, record } = makeService({ articles: { create }, organizations: { getPositionSummary } });

    const view = await service.publishForOrganization({
      organizationId,
      callerPositionId,
      input: {
        title: '  Регламент  ',
        body: ' Текст ',
        category: 'company',
        linkUrl: 'https://baza.sale/rules',
        linkLabel: '  ',
      },
      idempotency,
      correlationId: 'c',
    });

    expect(getPositionSummary).toHaveBeenCalledWith(callerPositionId, organizationId);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'organization',
        organizationId,
        authorName: 'Марина Петрова',
        createdByPositionId: callerPositionId,
        title: 'Регламент',
        body: 'Текст',
        pinned: false,
        linkUrl: 'https://baza.sale/rules',
        linkLabel: undefined,
      }),
      expect.anything(),
    );
    expect(view.authorName).toBe('Марина Петрова');
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'news.publish', resource: 'news', actor: { type: 'identity', id: actorIdentityId } }),
      expect.anything(),
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'createNewsArticle', key: 'k-1', responseStatus: 201 }),
      expect.anything(),
    );
  });

  it('подпись ссылки без самой ссылки не сохраняется', async () => {
    const create = jest.fn().mockImplementation(async (params) => articleDoc({ ...params }));
    const { service } = makeService({
      articles: { create },
      organizations: { getPositionSummary: jest.fn().mockResolvedValue(null) },
    });

    await service.publishForOrganization({
      organizationId,
      callerPositionId,
      input: { title: 'T', body: 'B', category: 'market', linkLabel: 'Подробнее' },
      idempotency,
      correlationId: 'c',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ linkUrl: undefined, linkLabel: undefined, authorName: undefined }),
      expect.anything(),
    );
  });

  it('картинка — только своя, news_image и уже подтверждённая', async () => {
    const imageAssetId = new Types.ObjectId().toString();
    const input = { title: 'T', body: 'B', category: 'market' as const, imageAssetId };
    const base = { organizationId, callerPositionId, input, idempotency, correlationId: 'c' };

    const foreign = makeService({ media: { getAssetForOwnerScope: jest.fn().mockResolvedValue(null) } });
    await expect(foreign.service.publishForOrganization(base)).rejects.toBeInstanceOf(NotFoundException);
    expect(foreign.media.getAssetForOwnerScope).toHaveBeenCalledWith(new Types.ObjectId(imageAssetId), {
      type: 'organization',
      organizationId,
    });

    const privateFile = makeService({
      media: { getAssetForOwnerScope: jest.fn().mockResolvedValue({ ...verifiedImage, purpose: 'library_file', bucket: 'private' }) },
    });
    await expect(privateFile.service.publishForOrganization(base)).rejects.toBeInstanceOf(AppException);

    const pending = makeService({ media: { getAssetForOwnerScope: jest.fn().mockResolvedValue({ ...verifiedImage, status: 'pending' }) } });
    await expect(pending.service.publishForOrganization(base)).rejects.toBeInstanceOf(AppException);
  });
});

describe('NewsService — рассылка при публикации', () => {
  it('новость компании: получатели — сотрудники организации без автора, письмо от имени компании', async () => {
    const colleague = new Types.ObjectId();
    const create = jest.fn().mockImplementation(async (params) => articleDoc({ ...params }));
    const { service, notifications } = makeService({
      articles: { create },
      organizations: {
        getPositionSummary: jest.fn().mockResolvedValue(null),
        listActiveOccupantIdentityIds: jest.fn().mockResolvedValue([actorIdentityId, colleague]),
        getOrganizationById: jest.fn().mockResolvedValue({ name: 'BAZA Realty' }),
      },
    });

    await service.publishForOrganization({
      organizationId,
      callerPositionId,
      input: { title: 'Планёрка', body: 'В пятницу в 10:00', category: 'company' },
      delivery: { email: true, telegram: false },
      idempotency,
      correlationId: 'c',
    });

    expect(notifications.queueNewsDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIdentityIds: [colleague],
        channels: { email: true, telegram: false },
        message: expect.objectContaining({ subject: 'BAZA Realty: Планёрка' }),
      }),
      expect.anything(),
    );
  });

  it('без рассылки получатели не собираются и в очередь ничего не ставится', async () => {
    const listActiveOccupantIdentityIds = jest.fn();
    const { service, notifications } = makeService({
      articles: { create: jest.fn().mockImplementation(async (params) => articleDoc({ ...params })) },
      organizations: { getPositionSummary: jest.fn().mockResolvedValue(null), listActiveOccupantIdentityIds },
    });

    await service.publishForOrganization({
      organizationId,
      callerPositionId,
      input: { title: 'T', body: 'B', category: 'company' },
      delivery: { email: false, telegram: false },
      idempotency,
      correlationId: 'c',
    });

    expect(listActiveOccupantIdentityIds).not.toHaveBeenCalled();
    expect(notifications.queueNewsDeliveries).not.toHaveBeenCalled();
  });

  it('новость платформы рассылается сотрудникам всех организаций от имени BAZA', async () => {
    const recipient = new Types.ObjectId();
    const { service, notifications } = makeService({
      articles: { create: jest.fn().mockImplementation(async (params) => articleDoc({ ...params, organizationId: undefined })) },
      organizations: { listAllActiveOccupantIdentityIds: jest.fn().mockResolvedValue([recipient]) },
    });

    await service.publishForPlatform({
      adminAccountId: new Types.ObjectId(),
      input: { title: 'Обновление', body: 'Что нового', category: 'market' },
      delivery: { email: true, telegram: true },
      idempotency,
      correlationId: 'c',
    });

    expect(notifications.queueNewsDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ recipientIdentityIds: [recipient], message: expect.objectContaining({ subject: 'BAZA: Обновление' }) }),
      expect.anything(),
    );
  });

  it('сводка рассылки в ленте — только для новостей компании и только если попросили', async () => {
    const own = articleDoc();
    const platform = articleDoc({ source: 'platform', organizationId: undefined });
    const { service, notifications } = makeService({ articles: { listFeed: jest.fn().mockResolvedValue([platform, own]) } });

    const plain = await service.listFeed(organizationId);
    expect(plain.every((item) => item.delivery === null)).toBe(true);
    expect(notifications.newsDeliveryStats).not.toHaveBeenCalled();

    const withDelivery = await service.listFeed(organizationId, { withDelivery: true });
    expect(notifications.newsDeliveryStats).toHaveBeenCalledWith([own._id]);
    expect(withDelivery[0]!.delivery).toBeNull();
    expect(withDelivery[1]!.delivery).toEqual(expect.objectContaining({ email: expect.objectContaining({ sent: 0 }) }));
  });
});

describe('NewsService.publishForPlatform', () => {
  it('новость платформы без организации и без подписи, картинка — владельца «платформа»', async () => {
    const adminAccountId = new Types.ObjectId();
    const imageAssetId = new Types.ObjectId().toString();
    const create = jest.fn().mockImplementation(async (params) => articleDoc({ ...params, organizationId: undefined }));
    const { service, append, record, media } = makeService({ articles: { create } });

    const view = await service.publishForPlatform({
      adminAccountId,
      input: { title: 'Обновление BAZA', body: 'Что нового', category: 'market', pinned: true, imageAssetId },
      idempotency,
      correlationId: 'c',
    });

    expect(media.getAssetForOwnerScope).toHaveBeenCalledWith(new Types.ObjectId(imageAssetId), { type: 'platform' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'platform', createdByAdminId: adminAccountId, pinned: true }),
      expect.anything(),
    );
    expect(create.mock.calls[0]![0]).not.toHaveProperty('organizationId');
    expect(view).toMatchObject({ source: 'platform', pinned: true, authorName: null, imageAssetId });
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'news.publish', actor: { type: 'admin_account', id: adminAccountId } }),
      expect.anything(),
    );
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ operation: 'createPlatformNewsArticle' }), expect.anything());
  });
});

describe('NewsService.update*', () => {
  const input = { title: 'Новый заголовок', body: 'Новый текст', category: 'company' as const };

  it('правка своей новости: CAS по версии, аудит news.update с до/после', async () => {
    const existing = articleDoc({ title: 'Старый заголовок' });
    const updated = articleDoc({ _id: existing._id, title: 'Новый заголовок', version: 1, editedAt: new Date() });
    const updateForOrganization = jest.fn().mockResolvedValue(updated);
    const { service, append } = makeService({
      articles: { findForOrganization: jest.fn().mockResolvedValue(existing), updateForOrganization },
    });

    const view = await service.updateForOrganization({
      newsId: existing._id,
      organizationId,
      actorIdentityId,
      input,
      expectedVersion: 0,
      correlationId: 'c',
    });

    expect(updateForOrganization).toHaveBeenCalledWith(existing._id, organizationId, 0, expect.objectContaining({ title: 'Новый заголовок' }), expect.anything());
    expect(view).toMatchObject({ title: 'Новый заголовок', version: 1 });
    expect(view.editedAt).not.toBeNull();
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'news.update',
        before: expect.objectContaining({ title: 'Старый заголовок' }),
        after: expect.objectContaining({ title: 'Новый заголовок' }),
      }),
      expect.anything(),
    );
  });

  it('устаревшая версия — 409 VERSION_CONFLICT, аудит не пишется', async () => {
    const existing = articleDoc();
    const { service, append } = makeService({
      articles: { findForOrganization: jest.fn().mockResolvedValue(existing), updateForOrganization: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.updateForOrganization({ newsId: existing._id, organizationId, actorIdentityId, input, expectedVersion: 3, correlationId: 'c' }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(append).not.toHaveBeenCalled();
  });

  it('чужая новость или новость платформы из ERP — 404', async () => {
    const { service } = makeService({ articles: { findForOrganization: jest.fn().mockResolvedValue(null) } });

    await expect(
      service.updateForOrganization({ newsId: new Types.ObjectId(), organizationId, actorIdentityId, input, expectedVersion: 0, correlationId: 'c' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('прежняя картинка повторно не проверяется, новая — проверяется', async () => {
    const imageAssetId = new Types.ObjectId();
    const existing = articleDoc({ imageAssetId });
    const { service, media } = makeService({
      articles: {
        findForOrganization: jest.fn().mockResolvedValue(existing),
        updateForOrganization: jest.fn().mockResolvedValue(existing),
      },
    });

    await service.updateForOrganization({
      newsId: existing._id,
      organizationId,
      actorIdentityId,
      input: { ...input, imageAssetId: imageAssetId.toString() },
      expectedVersion: 0,
      correlationId: 'c',
    });
    expect(media.getAssetForOwnerScope).not.toHaveBeenCalled();

    await service.updateForOrganization({
      newsId: existing._id,
      organizationId,
      actorIdentityId,
      input: { ...input, imageAssetId: new Types.ObjectId().toString() },
      expectedVersion: 0,
      correlationId: 'c',
    });
    expect(media.getAssetForOwnerScope).toHaveBeenCalledTimes(1);
  });
});

describe('NewsService.delete*', () => {
  it('чужая новость или новость платформы из ERP — 404, аудит не пишется', async () => {
    const deleteForOrganization = jest.fn().mockResolvedValue({ deletedCount: 0 });
    const { service, append } = makeService({ articles: { deleteForOrganization } });

    await expect(
      service.deleteForOrganization({ newsId: new Types.ObjectId(), organizationId, actorIdentityId, correlationId: 'c' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(append).not.toHaveBeenCalled();
  });

  it('удаление своей новости пишет news.delete', async () => {
    const newsId = new Types.ObjectId();
    const deleteForOrganization = jest.fn().mockResolvedValue({ deletedCount: 1 });
    const { service, append } = makeService({ articles: { deleteForOrganization } });

    await service.deleteForOrganization({ newsId, organizationId, actorIdentityId, correlationId: 'c' });

    expect(deleteForOrganization).toHaveBeenCalledWith(newsId, organizationId, expect.anything());
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ action: 'news.delete', resourceId: newsId }), expect.anything());
  });

  it('удаление несуществующей новости платформы — 404', async () => {
    const { service } = makeService({ articles: { deletePlatform: jest.fn().mockResolvedValue({ deletedCount: 0 }) } });

    await expect(
      service.deletePlatform({ newsId: new Types.ObjectId(), adminAccountId: new Types.ObjectId(), correlationId: 'c' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
