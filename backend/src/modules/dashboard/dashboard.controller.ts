import { Controller, Get } from '@nestjs/common';
import type { AuthContext } from '../../core/auth/auth.types';
import { CurrentAuth } from '../../core/auth/decorators';
import { DashboardService } from './dashboard.service';

/**
 * /api/dashboard — the figures of the school dashboard for the signed-in
 * user. No permission of its own: each part is included only when its
 * module is active and the user may see it (see DashboardService).
 */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  overview(@CurrentAuth() auth: AuthContext) {
    return this.dashboard.overview(auth);
  }
}
