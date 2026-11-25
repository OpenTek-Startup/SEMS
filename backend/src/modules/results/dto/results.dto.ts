import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class ResultsQueryDto {
  @IsUUID('all', { message: 'termId must be an id.' })
  termId: string;

  @IsUUID('all', { message: 'sectionId must be an id.' })
  sectionId: string;

  /** "true": also count submitted and validated assessments (a preview before locking). */
  @IsOptional()
  @IsIn(['true', 'false'], { message: 'provisional must be true or false.' })
  provisional?: 'true' | 'false';
}
