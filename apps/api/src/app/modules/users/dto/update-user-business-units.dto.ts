import { IsArray, IsUUID } from 'class-validator';

export class UpdateUserBusinessUnitsDto {
  @IsArray()
  @IsUUID('all', { each: true })
  businessUnitIds!: string[];
}
