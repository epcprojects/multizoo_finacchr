import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class InviteUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  fullName!: string;

  @IsUUID()
  roleId!: string;

  /** Units they'll work in — irrelevant for roles holding units.access_all. */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  businessUnitIds?: string[];
}
