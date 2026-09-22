import { IsArray, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { Permission } from '@multizoo/types';

export class CreateRoleDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions!: Permission[];
}
