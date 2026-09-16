import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * POST /auth/change-password. Текущий пароль подтверждает владельца аккаунта,
 * новый — не короче восьми символов (тот же минимум, что при активации
 * приглашения). Верхняя граница — чтобы argon2 не считал хеш минутами.
 */
export class ChangePasswordRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword!: string;
}
