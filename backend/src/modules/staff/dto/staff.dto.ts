import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

// Dates are calendar days (2024-09-02). Names must contain a visible
// character (@Matches(/\S/)); the service trims them.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = { message: 'hireDate must be a date such as 2024-09-02.' };
const CATEGORIES = ['teaching', 'non_teaching'] as const;
const CATEGORY_MESSAGE = { message: 'Category must be teaching or non_teaching.' };

export class CreateStaffDto {
  /** Optional: generated (STF-0001, …) when left out. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  staffNumber?: string;

  @IsString()
  @Matches(/\S/, { message: 'Enter a first name.' })
  @MaxLength(100)
  firstName: string;

  @IsString()
  @Matches(/\S/, { message: 'Enter a last name.' })
  @MaxLength(100)
  lastName: string;

  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsString()
  @Matches(/\S/, { message: 'Enter a position, e.g. Mathematics teacher.' })
  @MaxLength(100)
  position: string;

  @IsOptional()
  @IsIn(CATEGORIES, CATEGORY_MESSAGE)
  category?: (typeof CATEGORIES)[number];

  @IsOptional()
  @Matches(DAY, DAY_MESSAGE)
  hireDate?: string | null;

  /** Link to an existing user account of the school. */
  @IsOptional()
  @IsUUID('all', { message: 'userId must be a valid user id.' })
  userId?: string | null;
}

/** Every field is optional; null clears email, phone or hireDate. */
export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  staffNumber?: string;

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
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'Enter a position, e.g. Mathematics teacher.' })
  @MaxLength(100)
  position?: string;

  @IsOptional()
  @IsIn(CATEGORIES, CATEGORY_MESSAGE)
  category?: (typeof CATEGORIES)[number];

  @IsOptional()
  @Matches(DAY, DAY_MESSAGE)
  hireDate?: string | null;
}

export class SetStaffStatusDto {
  @IsIn(['active', 'inactive'], { message: 'Status must be active or inactive.' })
  status: 'active' | 'inactive';
}

export class LinkAccountDto {
  /** The user account to link; null unlinks. */
  @IsOptional()
  @IsUUID('all', { message: 'userId must be a valid user id.' })
  userId: string | null;
}

export class ListStaffQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'], { message: 'Status must be active or inactive.' })
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsIn(CATEGORIES, CATEGORY_MESSAGE)
  category?: (typeof CATEGORIES)[number];
}
