import { IsInt, IsMongoId, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateRealtorReviewDto {
  @IsMongoId() realtorPositionId!: string;
  @IsMongoId() completedDealId!: string;
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsString() @MaxLength(4000) text!: string;
}
