import { IsString, MinLength } from 'class-validator';

export class UpdateMyNameDto {
  @IsString()
  @MinLength(1)
  fullName!: string;
}
