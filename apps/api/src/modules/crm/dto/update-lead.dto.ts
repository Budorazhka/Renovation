import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';
import { REALTOR_STAGE_VALUES, CURATOR_STAGE_VALUES } from '../lead-stage';
import { PRODUCT_TYPES } from '../lead-stage-definitions';
import type { RealtorStage, CuratorStage, LeadProductType } from '../schemas/lead.schema';

/**
 * PATCH /leads/:leadId — сопутствующие поля лида (см. lead.schema.ts
 * докстринг блока полей ниже `version`). НЕ содержит `stage` — смена
 * стадии остаётся только за `PATCH /leads/:leadId/stage`
 * (CAS/idempotency), этот DTO её не принимает вовсе.
 *
 * `[owner decision — 04.09.2026]`: `realtorStage`/`curatorStage` — своя
 * 6-шаговая номенклатура каждый, `@IsIn(REALTOR_STAGE_VALUES)`/
 * `@IsIn(CURATOR_STAGE_VALUES)`, независимо от `productType` лида (см.
 * lead.schema.ts докстринг у этих полей).
 *
 * `[legacy-erp-crm]`: `name`/`phone`/`email` — поля Contact, к которому
 * привязан лид, НЕ поля самого Lead-документа (см. CrmService.updateLead
 * докстринг). `phone` — тот же формат, что `CreateLeadDto.requesterPhone`
 * (свободная строка 1..30, без отдельной нормализации — в этом backend её
 * нет ни на создании лида, ни здесь). `email: null` явно очищает поле,
 * отсутствие поля — "не трогать" (тот же принцип, что `UpdateTaskDto.
 * dueAt`/`colorHex`). `productType` — смена продукта лида, сбрасывает
 * `stage` в стадию "Новый лид" нового продукта (см. CrmService.updateLead).
 */
export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  city?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 30)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsIn(PRODUCT_TYPES)
  productType?: LeadProductType;

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  dealValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetValue?: number;

  @IsOptional()
  @IsString()
  @Length(1, 10)
  budgetCurrency?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  expectedCloseDate?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  rejectionReason?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  rejectionComment?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  telegram?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  country?: string;

  @IsOptional()
  @IsIn(REALTOR_STAGE_VALUES)
  realtorStage?: RealtorStage;

  @IsOptional()
  @IsIn(CURATOR_STAGE_VALUES)
  curatorStage?: CuratorStage;

  // `expectedVersion`/`stage` намеренно нет в этом DTO: сопутствующие поля
  // не версионированы (см. LeadRepository.updateFields докстринг) — только
  // сам `stage` защищён optimistic concurrency через отдельный эндпоинт
  // PATCH /leads/:leadId/stage.
}
