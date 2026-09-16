import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { CURRENCIES, type Currency } from '@baza/contracts';
import type { ReferralRequestStatus, ReferralRequestType } from '../schemas/referral-request.schema';

const REQUEST_TYPES: readonly ReferralRequestType[] = ['become_curator', 'leave_team', 'change_curator'];
const REQUEST_STATUSES: readonly ReferralRequestStatus[] = ['pending', 'approved', 'rejected'];

// ─── Кабинет ───────────────────────────────────────────────────────────────

export class JoinReferralTeamDto {
  @IsString()
  @Length(4, 32)
  code!: string;
}

export class CreateReferralRequestDto {
  @IsIn(REQUEST_TYPES as string[])
  type!: ReferralRequestType;

  @IsString()
  @Length(3, 1000)
  reason!: string;

  /** Код приглашения нового куратора — только для смены куратора. */
  @IsOptional()
  @IsString()
  @Length(4, 32)
  targetInviteCode?: string;
}

// ─── Админка: сеть ─────────────────────────────────────────────────────────

/** Любая правка сети BAZA пишется с причиной: она попадает в историю участника и журнал аудита. */
export class ReferralReasonDto {
  @IsString()
  @Length(3, 1000)
  reason!: string;
}

export class AppointCuratorDto extends ReferralReasonDto {
  @IsMongoId()
  identityId!: string;
}

export class AssignReferralMemberDto extends ReferralReasonDto {
  @IsMongoId()
  memberIdentityId!: string;

  @IsMongoId()
  curatorIdentityId!: string;
}

export class FindReferralPersonQueryDto {
  @IsString()
  @Length(3, 254)
  login!: string;
}

export class ListReferralRequestsQueryDto {
  @IsOptional()
  @IsIn(REQUEST_STATUSES as string[])
  status?: ReferralRequestStatus;
}

export class DecideReferralRequestDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  comment?: string;
}

// ─── Админка: комиссии и выплаты ───────────────────────────────────────────

export class ListCommissionsQueryDto {
  /** `true` — деньги уже пришли, иначе — сделки, которые ждут денег. */
  @IsOptional()
  @IsIn(['true', 'false'])
  received?: 'true' | 'false';
}

export class MarkCommissionReceivedDto {
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountMinorUnits!: number;

  @IsIn(CURRENCIES as readonly string[])
  currency!: Currency;

  /** Когда деньги пришли; по умолчанию — сейчас. */
  @IsOptional()
  @IsDateString()
  receivedAt?: string;
}

export class CancelCommissionReceivedDto extends ReferralReasonDto {
  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

export class MarkCuratorPaidDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsMongoId({ each: true })
  accrualIds!: string[];

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}
