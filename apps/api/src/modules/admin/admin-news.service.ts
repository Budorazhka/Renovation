import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AdminContext } from '../../shared/admin/admin-context';
import type { NotificationChannels } from '@baza/notifications';
import { NewsService, type NewsArticleInput, type NewsArticleView, type NewsDeliveryRequest } from '../news/news.service';
import { AdminPolicyService } from './admin-policy.service';

/**
 * Новости платформы (permission-matrix.md §2.2, грант `news.publish.global`).
 * Тот же паттерн, что AdminRealtorReviewService: AdminGuard на контроллере —
 * только аутентификация администратора, право проверяется здесь. Одно право
 * на чтение, публикацию, правку, удаление и загрузку картинок: список
 * новостей платформы — рабочий экран того, кто их ведёт.
 */
@Injectable()
export class AdminNewsService {
  constructor(
    private readonly newsService: NewsService,
    private readonly adminPolicy: AdminPolicyService,
  ) {}

  async list(adminContext: AdminContext): Promise<{ items: NewsArticleView[]; channels: NotificationChannels }> {
    await this.requirePublisher(adminContext);
    return { items: await this.newsService.listPlatform(), channels: this.newsService.deliveryChannels() };
  }

  async publish(
    adminContext: AdminContext,
    params: {
      input: NewsArticleInput;
      delivery: NewsDeliveryRequest;
      idempotency: { key: string; requestBody: Record<string, unknown> };
      correlationId: string;
    },
  ): Promise<NewsArticleView> {
    await this.requirePublisher(adminContext);
    return this.newsService.publishForPlatform({
      adminAccountId: new Types.ObjectId(adminContext.adminAccountId),
      input: params.input,
      delivery: params.delivery,
      idempotency: { actorIdentityId: new Types.ObjectId(adminContext.identityId), ...params.idempotency },
      correlationId: params.correlationId,
    });
  }

  async update(
    adminContext: AdminContext,
    params: { newsId: Types.ObjectId; input: NewsArticleInput; expectedVersion: number; correlationId: string },
  ): Promise<NewsArticleView> {
    await this.requirePublisher(adminContext);
    return this.newsService.updatePlatform({
      newsId: params.newsId,
      adminAccountId: new Types.ObjectId(adminContext.adminAccountId),
      input: params.input,
      expectedVersion: params.expectedVersion,
      correlationId: params.correlationId,
    });
  }

  async remove(adminContext: AdminContext, params: { newsId: Types.ObjectId; correlationId: string }): Promise<void> {
    await this.requirePublisher(adminContext);
    await this.newsService.deletePlatform({
      newsId: params.newsId,
      adminAccountId: new Types.ObjectId(adminContext.adminAccountId),
      correlationId: params.correlationId,
    });
  }

  async createImageUploadIntent(
    adminContext: AdminContext,
    params: { declaredMimeType: string; sizeBytes: number },
  ): Promise<{ assetId: string; uploadUrl: string }> {
    await this.requirePublisher(adminContext);
    return this.newsService.createPlatformImageUploadIntent(params);
  }

  async confirmImageUpload(
    adminContext: AdminContext,
    params: { assetId: Types.ObjectId; correlationId: string },
  ): Promise<{ status: 'verified' | 'rejected' }> {
    await this.requirePublisher(adminContext);
    return this.newsService.confirmPlatformImageUpload({
      assetId: params.assetId,
      actorIdentityId: new Types.ObjectId(adminContext.identityId),
      correlationId: params.correlationId,
    });
  }

  private requirePublisher(adminContext: AdminContext): Promise<void> {
    return this.adminPolicy.requireGrant({ adminContext, resource: 'news', action: 'publish' });
  }
}
