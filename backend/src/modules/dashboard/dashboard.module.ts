import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { TeachingModule } from '../teaching/teaching.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/** School dashboard (basic reporting): key figures for the signed-in user. */
@Module({
  imports: [AuthModule, TeachingModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
