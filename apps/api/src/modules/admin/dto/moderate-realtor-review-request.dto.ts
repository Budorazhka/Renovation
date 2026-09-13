import { IsIn, IsString, MinLength } from 'class-validator';

/**
 * permission-matrix.md разд.4: обязательный reason для Admin critical
 * action — тот же контракт, что ResolveComplaintRequestDto/
 * ConfirmDuplicateRequestDto. `decision` — explicit approved/rejected, не
 * булев флаг: только это явное admin-решение переводит pending-отзыв в тот
 * или иной терминальный статус.
 */
export class ModerateRealtorReviewRequestDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsString()
  @MinLength(10)
  reason!: string;
}
