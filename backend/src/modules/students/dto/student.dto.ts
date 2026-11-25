import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

// Dates are calendar days (2014-03-02). Names must contain a visible
// character (@Matches(/\S/)); the service trims them.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const GENDERS = ['male', 'female'] as const;
const GENDER_MESSAGE = { message: 'Gender must be male or female.' };

export class CreateStudentDto {
  /** Optional: generated (STU-0001, …) when left out. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  matricule?: string;

  @IsString()
  @Matches(/\S/, { message: 'Enter a first name.' })
  @MaxLength(100)
  firstName: string;

  @IsString()
  @Matches(/\S/, { message: 'Enter a last name.' })
  @MaxLength(100)
  lastName: string;

  @IsIn(GENDERS, GENDER_MESSAGE)
  gender: (typeof GENDERS)[number];

  @IsOptional()
  @Matches(DAY, { message: 'dateOfBirth must be a date such as 2014-03-02.' })
  dateOfBirth?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  placeOfBirth?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  guardianName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  guardianPhone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  guardianRelationship?: string | null;

  @IsOptional()
  @Matches(DAY, { message: 'admittedOn must be a date such as 2026-09-07.' })
  admittedOn?: string | null;
}

/** Every field is optional; null clears an optional field. */
export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  matricule?: string;

  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'Enter a first name.' })
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'Enter a last name.' })
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsIn(GENDERS, GENDER_MESSAGE)
  gender?: (typeof GENDERS)[number];

  @IsOptional()
  @Matches(DAY, { message: 'dateOfBirth must be a date such as 2014-03-02.' })
  dateOfBirth?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  placeOfBirth?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  guardianName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  guardianPhone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  guardianRelationship?: string | null;

  @IsOptional()
  @Matches(DAY, { message: 'admittedOn must be a date such as 2026-09-07.' })
  admittedOn?: string | null;
}

export class SetStudentStatusDto {
  @IsIn(['active', 'inactive'], { message: 'Status must be active or inactive.' })
  status: 'active' | 'inactive';
}

export class ListStudentsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'], { message: 'Status must be active or inactive.' })
  status?: 'active' | 'inactive';

  /** Students of this section in the current year. */
  @IsOptional()
  @IsUUID('all', { message: 'sectionId must be an id.' })
  sectionId?: string;

  /** "true": only active students with no class in the current year. */
  @IsOptional()
  @IsIn(['true', 'false'], { message: 'unplaced must be true or false.' })
  unplaced?: 'true' | 'false';
}
