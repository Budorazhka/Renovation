import { IsString, Length } from 'class-validator';

/**
 * PUT /leads/:leadId/stage-notes/:stage. `text` пустой (`''`) удаляет
 * заметку этой стадии целиком — см. CrmService.setLeadStageNote докстринг.
 * `stage` валидируется отдельно контроллером (path-параметр, не тело) —
 * тот же приём, что LeadChecklistChangeDto.stage, `ALL_LEAD_STAGE_VALUES`.
 */
export class SetLeadStageNoteDto {
  @IsString()
  @Length(0, 5000)
  text!: string;
}
