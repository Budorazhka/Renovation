import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NewsArticleDocument, NewsArticleSchema } from './schemas/news-article.schema';
import { NewsArticleRepository } from './repository/news-article.repository';
import { NewsService } from './news.service';
import { NewsController } from './news.controller';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { MediaModule } from '../media/media.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IdempotencyModule } from '../../shared/idempotency/idempotency.module';

/** NewsService экспортируется для AdminModule: новости платформы ведёт админка (ADR-001 — только через сервис). */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: NewsArticleDocument.name, schema: NewsArticleSchema }]),
    AuthorizationModule,
    AuditModule,
    OrganizationsModule,
    MediaModule,
    NotificationsModule,
    IdempotencyModule,
  ],
  controllers: [NewsController],
  providers: [NewsArticleRepository, NewsService],
  exports: [NewsService],
})
export class NewsModule {}
