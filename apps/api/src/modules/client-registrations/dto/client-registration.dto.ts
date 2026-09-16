import { IsIn, IsInt, IsMongoId, IsOptional, IsString, Length, Min } from 'class-validator';
import {
  CLIENT_REGISTRATION_STATUSES,
  type ClientRegistrationStatus,
} from '../schemas/client-registration.schema';

/**
 * Подача заявки. Либо `developmentId` (ЖК на платформе — застройщика и
 * название сервер берёт оттуда сам), либо пара «застройщик + проект» для
 * застройщика вне платформы. Организацию застройщика клиент не передаёт
 * никогда: иначе заявку можно было бы адресовать любой чужой организации.
 */
export class CreateClientRegistrationDto {
  @IsOptional()
  @IsMongoId()
  developmentId?: string;

  /** Адрес карточки ЖК на витрине — каталог платформы адресует комплекс им. */
  @IsOptional()
  @IsString()
  @Length(2, 200)
  developmentSlug?: string;

  @IsOptional()
  @IsString()
  @Length(2, 200)
  developerName?: string;

  @IsOptional()
  @IsString()
  @Length(2, 200)
  projectName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  unitLabel?: string;

  @IsString()
  @Length(2, 200)
  clientName!: string;

  @IsString()
  @Length(5, 40)
  clientPhone!: string;

  @IsOptional()
  @IsMongoId()
  leadId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;
}

/** Правка своей заявки: лот и заметка. Клиент и застройщик — это другая заявка. */
export class UpdateClientRegistrationDto {
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  unitLabel?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;
}

/** Решение без пояснения: подтверждение, завершение, снятие. */
export class DecideClientRegistrationDto {
  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

/** Отказ застройщика: причина обязательна — агентству нужна причина, а не только статус. */
export class RejectClientRegistrationDto {
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsString()
  @Length(3, 1000)
  reason!: string;
}

export class ListClientRegistrationsDto {
  @IsOptional()
  @IsIn(CLIENT_REGISTRATION_STATUSES as readonly string[])
  status?: ClientRegistrationStatus;
}

/** Тело для записи идемпотентности: ровно то, что определяет создаваемую заявку. */
export function clientRegistrationIdempotencyBody(dto: CreateClientRegistrationDto): Record<string, unknown> {
  return {
    developmentId: dto.developmentId ?? null,
    developmentSlug: dto.developmentSlug ?? null,
    developerName: dto.developerName ?? null,
    projectName: dto.projectName ?? null,
    unitLabel: dto.unitLabel ?? null,
    clientName: dto.clientName,
    clientPhone: dto.clientPhone,
    leadId: dto.leadId ?? null,
    notes: dto.notes ?? null,
  };
}
