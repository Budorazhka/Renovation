import { IsString, MinLength } from 'class-validator';

export class VerifyMlsRequestDto {
  @IsString()
  @MinLength(10)
  reason!: string;
}
