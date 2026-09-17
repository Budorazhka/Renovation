import { IsInt, IsString, MinLength, Min } from 'class-validator';

export class RevokePositionGrantDto {
  /** CAS — прочитан вместе со списком грантов (GET .../grants). */
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsString()
  @MinLength(1)
  reason!: string;
}
