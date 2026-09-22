import { IsOptional, IsString } from 'class-validator';

export class GetRoleQueryDTO {
  @IsOptional()
  @IsString()
  search?: string;
}
