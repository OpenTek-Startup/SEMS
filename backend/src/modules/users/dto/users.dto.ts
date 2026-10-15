import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateUserDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Enter a first name.' })
  @MaxLength(100)
  firstName: string;

  @IsString()
  @IsNotEmpty({ message: 'Enter a last name.' })
  @MaxLength(100)
  lastName: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true, message: 'Each role must be a valid role id.' })
  roleIds: string[];
}

export class SetUserRolesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true, message: 'Each role must be a valid role id.' })
  roleIds: string[];
}

export class SetUserStatusDto {
  @IsIn(['active', 'disabled'], { message: 'Status must be active or disabled.' })
  status: 'active' | 'disabled';
}
