import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReplyLeadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text: string;
}
