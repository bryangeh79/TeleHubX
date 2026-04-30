import { IsArray, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  notes?: string;
}

export class AssignMembersDto {
  /** 完整的成员列表（覆盖式）。最多 6 个 accountId。 */
  @IsArray()
  @IsUUID('4', { each: true })
  accountIds: string[];
}

export class AssignSingleAccountDto {
  /** Target group id; null/undefined = remove from any group */
  @IsOptional()
  @IsUUID('4')
  groupId?: string | null;
}

export class SetGroupCountDto {
  @IsInt()
  @Min(0)
  @Max(9)
  count: number;
}
