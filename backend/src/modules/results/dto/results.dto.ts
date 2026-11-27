import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

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

export class TermQueryDto {
  @IsUUID('all', { message: 'termId must be an id.' })
  termId: string;
}

export class PublishDto {
  @IsUUID('all', { message: 'termId must be an id.' })
  termId: string;

  @IsUUID('all', { message: 'sectionId must be an id.' })
  sectionId: string;
}

export class UnpublishDto extends PublishDto {
  @IsString()
  @MaxLength(300)
  reason: string;
}

export class AnnualQueryDto {
  @IsUUID('all', { message: 'sectionId must be an id.' })
  sectionId: string;

  /** Leave out for the current academic year. */
  @IsOptional()
  @IsUUID('all', { message: 'yearId must be an id.' })
  yearId?: string;
}
