import { IsBoolean, IsEmail, IsIn, IsString, Matches, MaxLength } from 'class-validator';

export class SetModuleActiveDto {
  @IsBoolean({ message: 'active must be true or false.' })
  active: boolean;
}

export class CreateSchoolDto {
  @IsString()
  @Matches(/\S/, { message: 'Enter the name of the school.' })
  @MaxLength(150)
  name: string;

  /** Subdomain and X-Tenant value, e.g. "hillside". Checked by checkSlug(). */
  @IsString()
  @MaxLength(60)
  slug: string;

  @IsIn(['primary', 'secondary', 'university'], { message: 'Type must be primary, secondary or university.' })
  type: 'primary' | 'secondary' | 'university';

  @IsEmail({}, { message: "Enter a valid email address for the school's administrator." })
  @MaxLength(254)
  adminEmail: string;

  @IsString()
  @Matches(/\S/, { message: "Enter the administrator's first name." })
  @MaxLength(100)
  adminFirstName: string;

  @IsString()
  @Matches(/\S/, { message: "Enter the administrator's last name." })
  @MaxLength(100)
  adminLastName: string;
}

export class SetSchoolStatusDto {
  @IsIn(['active', 'suspended'], { message: 'Status must be active or suspended.' })
  status: 'active' | 'suspended';
}
