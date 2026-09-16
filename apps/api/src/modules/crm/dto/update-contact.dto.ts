import { IsArray, IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { CONTACT_ROLES, type ContactRole } from '../schemas/contact.schema';

/**
 * PATCH /contacts/:contactId — правка контакта по его собственному id.
 * Партиал: поле, которое не передано, не трогается. `email: null` (в
 * отличие от отсутствия поля) снимает адрес — тот же принцип, что
 * UpdateLeadDto использует для email лида.
 */
export class UpdateContactDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 30)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsArray()
  @IsIn(CONTACT_ROLES, { each: true })
  roles?: ContactRole[];
}
