import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { IdentityModule } from './modules/identity/identity.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { AuthorizationModule } from './modules/authorization/authorization.module';
import { AuditModule } from './modules/audit/audit.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { MediaModule } from './modules/media/media.module';
import { DevelopmentsModule } from './modules/developments/developments.module';
import { CrmModule } from './modules/crm/crm.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthController } from './shared/health/health.controller';
import { CorrelationIdMiddleware } from './shared/errors/correlation-id.middleware';
import { TenantContextMiddleware } from './shared/tenant/tenant-context.middleware';
import { AdminContextMiddleware } from './shared/admin/admin-context.middleware';
import { MarketplaceAccountContextMiddleware } from './shared/marketplace-account/marketplace-account-context.middleware';
import { PropertyAssetsModule } from './modules/property-assets/property-assets.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { SelectionsModule } from './modules/selections/selections.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { MarketplaceSelectionsModule } from './modules/marketplace-selections/marketplace-selections.module';
import { BillingModule } from './modules/billing/billing.module';
import { MessengerModule } from './modules/messenger/messenger.module';
import { LmsModule } from './modules/lms/lms.module';
import { CommunityModule } from './modules/community/community.module';
import { BuyerRequestsModule } from './modules/buyer-requests/buyer-requests.module';
import { RealtorReviewsModule } from './modules/realtor-reviews/realtor-reviews.module';
import { PublicRealtorsModule } from './modules/public-realtors/public-realtors.module';
import { NotesModule } from './modules/notes/notes.module';
import { LibraryModule } from './modules/library/library.module';
import { PlansModule } from './modules/plans/plans.module';
import { NewsModule } from './modules/news/news.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGO_URI'),
      }),
    }),
    // D-05: master plan явно требует "reveal — отдельная rate-limited
    // команда" — не глобальный guard на все endpoints (тот же принцип
    // explicit application, что TenantGuard/PermissionGuard), применяется
    // точечно через @UseGuards(RedisRateLimitGuard) на конкретных
    // контроллерах (CrmController/ListingCrmController.revealContact).
    // Redis-backed (shared/rate-limit/redis-rate-limit.guard.ts) — заменил
    // @nestjs/throttler ThrottlerModule.forRoot (in-memory, не shared между
    // API-инстансами за балансировщиком, см. guard докстринг). По IP
    // (req.ip, Fastify-совместимо) + по listing/development slug, не по
    // identity-сессии — reveal-contact вызывается гостями без сессии.
    IdentityModule,
    OrganizationsModule,
    AuthorizationModule,
    AuditModule,
    OutboxModule,
    MediaModule,
    DevelopmentsModule,
    CrmModule,
    AdminModule,
    PropertyAssetsModule,
    BookingsModule,
    SelectionsModule,
    FavoritesModule,
    MarketplaceSelectionsModule,
    BillingModule,
    MessengerModule,
    LmsModule,
    CommunityModule,
    BuyerRequestsModule,
    RealtorReviewsModule,
    PublicRealtorsModule,
    NotesModule,
    LibraryModule,
    PlansModule,
    NewsModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
  // TenantContextMiddleware/AdminContextMiddleware явно зарегистрированы
  // здесь как providers — они больше не проходят через consumer.apply()
  // (см. configure() комментарий ниже), которое раньше неявно их
  // инстанцировало; main.api.ts резолвит их через app.get(...), что требует
  // явной регистрации в DI-графе.
  // CorrelationIdMiddleware/TenantContextMiddleware/AdminContextMiddleware
  // НЕ регистрируются здесь через consumer.apply(...) — найден и подтверждён
  // реальным сетевым E2E-прогоном баг (GitHub issue nestjs/nest#8837,
  // maintainer-confirmed): NestMiddleware на FastifyAdapter получает сырой
  // Node.js req через @fastify/middie compat-слой, НЕ тот же FastifyRequest,
  // что видят Guards/Controllers — мутация req.correlationId/req.tenantContext/
  // req.adminContext внутри такого middleware никогда не долетает дальше.
  // Изначально CorrelationIdMiddleware считался не подверженным этой
  // проблеме ("пишет req.correlationId, читаемое напрямую контроллерами") —
  // это предположение оказалось ОШИБОЧНЫМ, второе мнение (Gemini) указало на
  // тот же баг для него, реальный E2E-прогон подтвердил: AuditEventDocument
  // validation failed (correlationId required) при вызове из контроллера.
  // Все три зарегистрированы вместо этого как нативные Fastify onRequest
  // hooks в main.api.ts (после NestFactory.create(), через
  // app.getHttpAdapter().getInstance().addHook(...)) — тот hook получает тот
  // же объект, что видят Guards. Классы остаются здесь как providers, их
  // .use() вызывается из hook-обёртки в main.ts, не из NestModule.configure().
  providers: [CorrelationIdMiddleware, TenantContextMiddleware, AdminContextMiddleware, MarketplaceAccountContextMiddleware],
})
export class AppModule {}
