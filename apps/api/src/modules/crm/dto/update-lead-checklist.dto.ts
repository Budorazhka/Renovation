import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, Max, Min, ValidateNested } from 'class-validator';
import { ALL_LEAD_STAGE_VALUES } from '../lead-stage';
import type { LeadStage } from '../schemas/lead.schema';

/**
 * `stage` — та же coarse-проверка, что ChangeLeadStageDto.stage
 * (`@IsIn(ALL_LEAD_STAGE_VALUES)` — "это вообще известная стадия хоть
 * какого-то продукта"): точной привязки к productType лида здесь не
 * требуется — чек-лист пункта стадии, которая лиду сейчас не принадлежит,
 * просто никогда не отобразится на фронте, хранить его сервер не мешает
 * (в отличие от самого `Lead.stage`, где чужая стадия была бы бессмысленна).
 */
export class LeadChecklistChangeDto {
  @IsIn(ALL_LEAD_STAGE_VALUES)
  stage!: LeadStage;

  @IsInt()
  @Min(0)
  @Max(100)
  index!: number;

  @IsBoolean()
  checked!: boolean;
}

export class UpdateLeadChecklistDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LeadChecklistChangeDto)
  changes!: LeadChecklistChangeDto[];
}
