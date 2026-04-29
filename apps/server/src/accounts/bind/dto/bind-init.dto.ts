import { IsString, Matches } from 'class-validator';

export class BindInitDto {
  /** E.164 international format, e.g. +60123456789 */
  @IsString()
  @Matches(/^\+\d{6,15}$/, {
    message: 'phone must be in E.164 format (e.g. +60123456789)',
  })
  phone: string;
}
