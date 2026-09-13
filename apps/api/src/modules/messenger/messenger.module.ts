import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MessengerAccountDocument,
  MessengerAccountSchema,
  MessengerDialogDocument,
  MessengerDialogSchema,
  MessengerMessageDocument,
  MessengerMessageSchema,
  MessengerAccountRepository,
  MessengerDialogRepository,
  MessengerMessageRepository,
  TelegramBotClient,
} from '@baza/messenger';
import { MessengerService } from './messenger.service';
import { MessengerController } from './messenger.controller';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { OutboxModule } from '../outbox/outbox.module';
import { CrmModule } from '../crm/crm.module';
import { MediaModule } from '../media/media.module';
import { IdempotencyModule } from '../../shared/idempotency/idempotency.module';
import { RateLimitModule } from '../../shared/rate-limit/rate-limit.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MessengerAccountDocument.name, schema: MessengerAccountSchema },
      { name: MessengerDialogDocument.name, schema: MessengerDialogSchema },
      { name: MessengerMessageDocument.name, schema: MessengerMessageSchema },
    ]),
    AuthorizationModule,
    AuditModule,
    OutboxModule,
    CrmModule,
    MediaModule,
    IdempotencyModule,
    RateLimitModule,
  ],
  // N-12: TelegramWebhookController — публичный (без TenantGuard/PermissionGuard),
  // принимает входящие апдейты от Telegram по /public/messenger/telegram/:accountId.
  controllers: [MessengerController, TelegramWebhookController],
  providers: [
    MessengerAccountRepository,
    MessengerDialogRepository,
    MessengerMessageRepository,
    TelegramBotClient,
    MessengerService,
  ],
  exports: [MessengerService],
})
export class MessengerModule {}
