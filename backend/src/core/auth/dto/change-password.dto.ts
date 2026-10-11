import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Strength rules are checked in AuthService (passwordProblems) for clearer messages. */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Enter your current password.' })
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @IsNotEmpty({ message: 'Enter a new password.' })
  @MaxLength(128)
  newPassword: string;
}
