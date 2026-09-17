import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * POST /auth/verify-password. Подтверждает, что за клавиатурой владелец
 * текущей сессии — используется перед чувствительными действиями (массовое
 * редактирование), которые не должны требовать полноценного re-login.
 * Не меняет пароль и не отзывает сессии (в отличие от change-password).
 */
export class VerifyPasswordRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}
