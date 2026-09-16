import { IsString, Length } from 'class-validator';

/** PATCH /admin/people/:identityId — новое имя человека и обязательная причина для аудита. */
export class RenamePersonDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsString()
  @Length(3, 1000)
  reason!: string;
}
