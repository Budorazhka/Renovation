import { Types } from 'mongoose';
import { AppException } from '../../shared/errors/app-exception';
import { ErrorCode } from '../../shared/errors/error-codes';
import type { AdminContext } from '../../shared/admin/admin-context';
import type { NewsService } from '../news/news.service';
import type { AdminPolicyService } from './admin-policy.service';
import { AdminNewsService } from './admin-news.service';

const adminContext: AdminContext = {
  identityId: new Types.ObjectId().toString(),
  adminAccountId: new Types.ObjectId().toString(),
  isSuperAdmin: false,
};

function makeService(granted: boolean) {
  const requireGrant = jest.fn().mockImplementation(async () => {
    if (!granted) throw new AppException(ErrorCode.ADMIN_SCOPE_INSUFFICIENT, 'Недостаточно прав: news.publish');
  });
  const news = {
    listPlatform: jest.fn().mockResolvedValue([]),
    publishForPlatform: jest.fn().mockResolvedValue({ id: 'n1' }),
    deletePlatform: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AdminNewsService(news as unknown as NewsService, { requireGrant } as unknown as AdminPolicyService);
  return { service, news, requireGrant };
}

describe('AdminNewsService', () => {
  it('без гранта news.publish список, публикация и удаление закрыты', async () => {
    const { service, news } = makeService(false);

    await expect(service.list(adminContext)).rejects.toBeInstanceOf(AppException);
    await expect(
      service.publish(adminContext, {
        input: { title: 'T', body: 'B', category: 'market' },
        delivery: { email: false, telegram: false },
        idempotency: { key: 'k', requestBody: {} },
        correlationId: 'c',
      }),
    ).rejects.toBeInstanceOf(AppException);
    await expect(service.remove(adminContext, { newsId: new Types.ObjectId(), correlationId: 'c' })).rejects.toBeInstanceOf(
      AppException,
    );
    expect(news.publishForPlatform).not.toHaveBeenCalled();
    expect(news.deletePlatform).not.toHaveBeenCalled();
  });

  it('публикация идёт от аккаунта администратора, идемпотентность — по его identity', async () => {
    const { service, news, requireGrant } = makeService(true);

    await service.publish(adminContext, {
      input: { title: 'T', body: 'B', category: 'market' },
      delivery: { email: false, telegram: false },
      idempotency: { key: 'k', requestBody: { title: 'T' } },
      correlationId: 'c',
    });

    expect(requireGrant).toHaveBeenCalledWith({ adminContext, resource: 'news', action: 'publish' });
    const call = news.publishForPlatform.mock.calls[0]![0];
    expect(call.adminAccountId.toString()).toBe(adminContext.adminAccountId);
    expect(call.idempotency.actorIdentityId.toString()).toBe(adminContext.identityId);
    expect(call.idempotency.key).toBe('k');
  });
});
