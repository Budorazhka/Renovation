import {
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  MESSENGER_PLATFORMS,
  type MessengerPlatform,
  MESSAGE_TYPES,
  type MessageType,
} from '@baza/messenger';

export class AddTelegramBotAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(120)
  botToken!: string;
}

export class AddWhatsAppAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phoneNumber?: string;
}

export class ListAccountsQueryDto {
  @IsOptional()
  @IsIn(MESSENGER_PLATFORMS)
  platform?: MessengerPlatform;
}

export class ListDialogsQueryDto {
  @IsOptional()
  @IsMongoId()
  accountId?: string;

  @IsOptional()
  @IsIn(MESSENGER_PLATFORMS)
  platform?: MessengerPlatform;

  @IsOptional()
  @IsMongoId()
  leadId?: string;

  @IsOptional()
  @IsMongoId()
  contactId?: string;

  @IsOptional()
  @IsMongoId()
  dealId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  // Непрозрачный составной cursor (base64url от JSON), не ObjectId —
  // см. decodeDialogListCursor в messenger-dialog.repository.ts. Голый
  // ObjectId тоже пройдёт валидацию строки и будет принят как legacy-формат
  // ниже по стеку, как и описано в OpenAPI Cursor-параметре.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit: number = 50;
}

export class ListMessagesQueryDto {
  @IsOptional()
  @IsMongoId()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit: number = 100;
}

export class SendTextMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string;
}

export class SendMediaMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string;

  @IsOptional()
  @IsIn(MESSAGE_TYPES)
  messageType?: MessageType;

  @IsOptional()
  @IsMongoId()
  assetId?: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mimeType?: string;
}

export class LinkDialogCrmDto {
  @IsOptional()
  @IsMongoId()
  leadId?: string;

  @IsOptional()
  @IsMongoId()
  contactId?: string;

  @IsOptional()
  @IsMongoId()
  dealId?: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

export class CreateTaskFromDialogDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  dueAt?: string;

  @IsOptional()
  @IsBoolean()
  isUrgent?: boolean;

  @IsOptional()
  @IsBoolean()
  isImportant?: boolean;
}
