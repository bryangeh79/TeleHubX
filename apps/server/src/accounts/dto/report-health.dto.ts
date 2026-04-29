import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ReportHealthDto {
  @IsInt()
  @Min(0)
  @Max(100)
  healthScore: number;

  @IsString()
  @IsOptional()
  remark?: string;

  @IsString()
  @IsOptional()
  note?: string;
}
