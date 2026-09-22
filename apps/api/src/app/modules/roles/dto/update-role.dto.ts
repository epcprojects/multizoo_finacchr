import { IsArray, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { Permission } from '@multizoo/types';

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions?: Permission[];
}
