import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// Dates are calendar days (2026-10-12). The service checks they fall in the term.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = { message: 'heldOn must be a date such as 2026-10-12.' };
const STATUSES = ['open', 'submitted', 'validated', 'locked'] as const;

export class ListAssessmentsQueryDto {
  /** Leave out for the current academic year. */
  @IsOptional()
  @IsUUID('all', { message: 'yearId must be an id.' })
  yearId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'termId must be an id.' })
  termId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'sectionId must be an id.' })
  sectionId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'subjectId must be an id.' })
  subjectId?: string;

  @IsOptional()
  @IsIn(STATUSES, { message: 'status must be open, submitted, validated or locked.' })
  status?: (typeof STATUSES)[number];
}

export class CreateAssessmentDto {
  @IsUUID('all', { message: 'termId must be an id.' })
  termId: string;

  @IsUUID('all', { message: 'sectionId must be an id.' })
  sectionId: string;

  @IsUUID('all', { message: 'subjectId must be an id.' })
  subjectId: string;

  @IsString()
  @Matches(/\S/, { message: 'Enter a name, e.g. Sequence 1.' })
  @MaxLength(60)
  name: string;

  /** Default 20. */
  @IsOptional()
  @IsInt({ message: 'maxScore must be a whole number.' })
  @Min(1, { message: 'maxScore is at least 1.' })
  @Max(100, { message: 'maxScore is at most 100.' })
  maxScore?: number;

  /** Default 1. */
  @IsOptional()
  @IsInt({ message: 'weight must be a whole number.' })
  @Min(1, { message: 'weight is at least 1.' })
  @Max(10, { message: 'weight is at most 10.' })
  weight?: number;

  @IsOptional()
  @Matches(DAY, DAY_MESSAGE)
  heldOn?: string | null;
}

/** Only open assessments can be edited; null clears the date. */
export class UpdateAssessmentDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'Enter a name, e.g. Sequence 1.' })
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsInt({ message: 'maxScore must be a whole number.' })
  @Min(1, { message: 'maxScore is at least 1.' })
  @Max(100, { message: 'maxScore is at most 100.' })
  maxScore?: number;

  @IsOptional()
  @IsInt({ message: 'weight must be a whole number.' })
  @Min(1, { message: 'weight is at least 1.' })
  @Max(10, { message: 'weight is at most 10.' })
  weight?: number;

  @IsOptional()
  @Matches(DAY, DAY_MESSAGE)
  heldOn?: string | null;
}

/** One cell of the mark sheet: a score (number or "12,5"), "ABS", or null / "" to clear. */
export class MarkInputDto {
  @IsUUID('all', { message: 'studentId must be an id.' })
  studentId: string;

  /** Checked by the service: number, text or null. */
  @IsOptional()
  value: number | string | null;
}

export class SaveMarksDto {
  @IsArray()
  @ArrayMaxSize(300, { message: 'Save at most 300 marks at a time.' })
  @ValidateNested({ each: true })
  @Type(() => MarkInputDto)
  marks: MarkInputDto[];

  /** Required to change a locked mark (override). */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
