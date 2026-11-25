import { Module } from '@nestjs/common';
import { EnrollmentModule } from '../enrollment/enrollment.module';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';

/** Results (Phase 3): term averages, ranks, class statistics and report card data. */
@Module({
  imports: [EnrollmentModule],
  controllers: [ResultsController],
  providers: [ResultsService],
})
export class ResultsModule {}
