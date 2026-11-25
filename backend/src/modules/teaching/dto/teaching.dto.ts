import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class AssignmentsQueryDto {
  /** Leave out for the current academic year. */
  @IsOptional()
  @IsUUID('all', { message: 'yearId must be an id.' })
  yearId?: string;
}

/** Sets the teacher of one subject in one section, or clears it (staffMemberId null). */
export class SetAssignmentDto {
  /** Leave out for the current academic year. */
  @IsOptional()
  @IsUUID('all', { message: 'yearId must be an id.' })
  yearId?: string;

  @IsUUID('all', { message: 'sectionId must be an id.' })
  sectionId: string;

  @IsUUID('all', { message: 'subjectId must be an id.' })
  subjectId: string;

  /** null removes the teacher. */
  @ValidateIf((_, v) => v !== null)
  @IsUUID('all', { message: 'staffMemberId must be an id or null.' })
  staffMemberId: string | null;
}
