import { IsArray, IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { CONTACT_ROLES, type ContactRole } from '../schemas/contact.schema';

/** POST /contacts — «Добавить клиента» в ERP независимо от лида (N-20). */
export class CreateContactDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsString()
  @Length(1, 30)
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsArray()
  @IsIn(CONTACT_ROLES, { each: true })
  roles?: ContactRole[];
}
