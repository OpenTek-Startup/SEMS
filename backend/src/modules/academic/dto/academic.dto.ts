import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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

// Dates are calendar days (2026-09-07). Names must contain a visible
// character (@Matches(/\S/)); the service trims them.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = (field: string) => ({ message: `${field} must be a date such as 2026-09-07.` });

// ------------------------------------------------------------- years/terms

export class CreateYearDto {
  @IsString()
  @Matches(/\S/, { message: 'Enter a name, e.g. 2026-2027.' })
  @MaxLength(50)
  name: string;

  @Matches(DAY, DAY_MESSAGE('startDate'))
  startDate: string;

  @Matches(DAY, DAY_MESSAGE('endDate'))
  endDate: string;
}

export class UpdateYearDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'Enter a name, e.g. 2026-2027.' })
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @Matches(DAY, DAY_MESSAGE('startDate'))
  startDate?: string;

  @IsOptional()
  @Matches(DAY, DAY_MESSAGE('endDate'))
  endDate?: string;
}

export class CreateTermDto {
  @IsString()
  @Matches(/\S/, { message: 'Enter a name, e.g. Term 1.' })
  @MaxLength(50)
  name: string;

  @Matches(DAY, DAY_MESSAGE('startDate'))
  startDate: string;

  @Matches(DAY, DAY_MESSAGE('endDate'))
  endDate: string;
}

export class UpdateTermDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'Enter a name, e.g. Term 1.' })
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @Matches(DAY, DAY_MESSAGE('startDate'))
  startDate?: string;

  @IsOptional()
  @Matches(DAY, DAY_MESSAGE('endDate'))
  endDate?: string;
}

// ---------------------------------------------------------- classes/sections

export class CreateClassDto {
  @IsString()
  @Matches(/\S/, { message: 'Enter a name, e.g. Form 1.' })
  @MaxLength(50)
  name: string;

  /** Orders the classes: Form 1 = 1, Form 2 = 2, ... */
  @IsInt({ message: 'level must be a whole number.' })
  @Min(1)
  @Max(30)
  level: number;
}

export class UpdateClassDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'Enter a name, e.g. Form 1.' })
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsInt({ message: 'level must be a whole number.' })
  @Min(1)
  @Max(30)
  level?: number;
}

export class CreateSectionDto {
  @IsString()
  @Matches(/\S/, { message: 'Enter a name, e.g. A.' })
  @MaxLength(20)
  name: string;

  @IsOptional()
  @IsInt({ message: 'capacity must be a whole number.' })
  @Min(1)
  @Max(500)
  capacity?: number | null;
}

export class UpdateSectionDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'Enter a name, e.g. A.' })
  @MaxLength(20)
  name?: string;

  /** null removes the capacity. */
  @IsOptional()
  @IsInt({ message: 'capacity must be a whole number.' })
  @Min(1)
  @Max(500)
  capacity?: number | null;
}

// ------------------------------------------------------------------ subjects

export class CreateSubjectDto {
  /** 1–12 letters, digits or dashes, e.g. MATH. Stored in capitals. */
  @IsString()
  @Matches(/^\s*[A-Za-z0-9][A-Za-z0-9-]{0,11}\s*$/, {
    message: 'code must be 1 to 12 letters, digits or dashes, e.g. MATH.',
  })
  code: string;

  @IsString()
  @Matches(/\S/, { message: 'Enter a name, e.g. Mathematics.' })
  @MaxLength(100)
  name: string;
}

export class UpdateSubjectDto {
  @IsOptional()
  @IsString()
  @Matches(/^\s*[A-Za-z0-9][A-Za-z0-9-]{0,11}\s*$/, {
    message: 'code must be 1 to 12 letters, digits or dashes, e.g. MATH.',
  })
  code?: string;

  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'Enter a name, e.g. Mathematics.' })
  @MaxLength(100)
  name?: string;
}

export class ClassSubjectItemDto {
  @IsUUID('all', { message: 'subjectId must be a subject id.' })
  subjectId: string;

  /** Weight of the subject in the class average. */
  @IsInt({ message: 'coefficient must be a whole number.' })
  @Min(1)
  @Max(20)
  coefficient: number;
}

/** The complete subject list of a class (replaces the previous one). */
export class SetClassSubjectsDto {
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ClassSubjectItemDto)
  subjects: ClassSubjectItemDto[];
}
