import { IsArray, IsMongoId, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/** N-27: лоты — юниты новостройки и/или объявления вторички; хотя бы один из двух массивов непуст (SelectionsService.createSelection). */
export class CreateSelectionDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  unitIds?: string[];

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  listingIds?: string[];

  @IsOptional()
  @IsMongoId()
  leadId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  clientPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  agentNote?: string;

  /** Настройки клиентского отображения (язык/валюта/видимость блоков) — свободная UI-конфигурация, см. dev-selection-customization.ts на фронте. */
  @IsOptional()
  @IsObject()
  customization?: Record<string, unknown>;
}
