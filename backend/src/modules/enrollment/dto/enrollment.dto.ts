import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['active', 'transferred', 'withdrawn'] as const;

export class EnrollmentQueryDto {
  /** Leave out for the current academic year. */
  @IsOptional()
  @IsUUID('all', { message: 'yearId must be an id.' })
  yearId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'sectionId must be an id.' })
  sectionId?: string;

  @IsOptional()
  @IsIn(STATUSES, { message: 'status must be active, transferred or withdrawn.' })
  status?: (typeof STATUSES)[number];
}

export class YearQueryDto {
  @IsOptional()
  @IsUUID('all', { message: 'yearId must be an id.' })
  yearId?: string;
}

/** Puts one or more students in a section (a whole new class at once is fine). */
export class EnrollDto {
  /** Leave out for the current academic year. */
  @IsOptional()
  @IsUUID('all', { message: 'yearId must be an id.' })
  yearId?: string;

  @IsUUID('all', { message: 'sectionId must be an id.' })
  sectionId: string;

  @IsArray()
  @ArrayNotEmpty({ message: 'Choose at least one student.' })
  @ArrayMaxSize(200, { message: 'Enroll at most 200 students at a time.' })
  @IsUUID('all', { each: true, message: 'Every studentId must be an id.' })
  studentIds: string[];

  /** Default: today (kept inside the school year). */
  @IsOptional()
  @Matches(DAY, { message: 'enrolledOn must be a date such as 2026-09-07.' })
  enrolledOn?: string;
}

export class TransferDto {
  @IsUUID('all', { message: 'sectionId must be an id.' })
  sectionId: string;

  /** Default: today. */
  @IsOptional()
  @Matches(DAY, { message: 'on must be a date such as 2026-11-23.' })
  on?: string;
}

export class WithdrawDto {
  /** Default: today. */
  @IsOptional()
  @Matches(DAY, { message: 'on must be a date such as 2026-11-23.' })
  on?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
