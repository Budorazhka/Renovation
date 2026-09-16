import { IsIn, IsOptional, IsString, Length, MinLength } from 'class-validator';
import type { OrganizationType } from '../schemas/organization.schema';

const ORGANIZATION_TYPES: OrganizationType[] = ['agency', 'developer', 'independent_realtor'];

/**
 * POST /organizations/register (публичный, OrganizationOnboardingController).
 * Пароль здесь — не для создания Identity (та уже существует после
 * /auth/register), а для повторного подтверждения владения этой Identity в
 * рамках ЭТОГО запроса: между /auth/register и этим вызовом сессии ещё нет
 * (login с audience:'erp' невозможен без ProductAccess, который этот же
 * запрос и выдаёт — circular dependency, которую нельзя разорвать без
 * повторной проверки пароля здесь).
 */
export class RegisterOrganizationDto {
  @IsString()
  @MinLength(1)
  login!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsIn(ORGANIZATION_TYPES)
  type!: OrganizationType;

  @IsString()
  @Length(1, 200)
  name!: string;

  /**
   * Как зовут владельца. Без него в должность пишется заглушка «Owner», и
   * человек так и виден в команде, сделках, рейтинге риэлторов и реферальной
   * сети. Необязателен ради клиентов, которые его ещё не присылают.
   */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  ownerName?: string;
}
