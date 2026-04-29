import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateSessionDto {
  @IsString()
  @IsNotEmpty()
  sessionString: string;
}
