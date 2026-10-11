import { Controller, Get } from '@nestjs/common';
import { Public } from '../../core/auth/decorators';
import { HealthService } from './health.service';

@Public() // monitoring must work without signing in
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  check() {
    return this.healthService.check();
  }
}
