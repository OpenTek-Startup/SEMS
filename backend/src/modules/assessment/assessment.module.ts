import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { EnrollmentModule } from '../enrollment/enrollment.module';
import { TeachingModule } from '../teaching/teaching.module';
import { AssessmentController } from './assessment.controller';
import { AssessmentService } from './assessment.service';

/** Assessment (Phase 3): tests, sequences and exams per term, and their workflow. */
@Module({
  imports: [AuthModule, TeachingModule, EnrollmentModule],
  controllers: [AssessmentController],
  providers: [AssessmentService],
  exports: [AssessmentService],
})
export class AssessmentModule {}
