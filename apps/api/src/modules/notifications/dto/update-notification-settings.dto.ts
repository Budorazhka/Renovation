import { IsBoolean, IsOptional } from 'class-validator';

/** PUT /me/notifications: что присылать; не присланное поле не меняется. */
export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsBoolean()
  newsEmail?: boolean;

  @IsOptional()
  @IsBoolean()
  newsTelegram?: boolean;
}
