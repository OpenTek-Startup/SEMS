import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { MAX_PAGE_SIZE } from '../audit-rules';

/** Query string of GET /api/audit. Every filter is optional. */
export class AuditQueryDto {
  /** A category ending with a dot ("auth.", "user.") or one exact action ("user.created"). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z_]+(\.[a-z_]+)*\.?$/, { message: 'action must look like "auth." or "user.created".' })
  action?: string;

  @IsOptional()
  @IsUUID('all', { message: 'actorUserId must be a user id.' })
  actorUserId?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'from must be a date such as 2026-10-15.' })
  from?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'to must be a date such as 2026-10-15.' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}
