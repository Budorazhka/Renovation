import { IsString, MinLength } from 'class-validator';

export class RevokeMlsVerificationRequestDto {
  @IsString()
  @MinLength(10)
  reason!: string;
}
