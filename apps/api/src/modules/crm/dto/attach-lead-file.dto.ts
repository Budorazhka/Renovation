import { IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * POST /leads/:leadId/files — уже загруженный и подтверждённый MediaAsset
 * организации (purpose 'lead_attachment' либо файл библиотеки материалов).
 */
export class AttachLeadFileDto {
  @IsMongoId()
  assetId!: string;

  /** Имя файла для экрана; без него имя выводится из storage key («original.pdf»). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName?: string;
}
