import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async check() {
    try {
      // Round-trip to the database to prove connectivity.
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      this.logger.error(
        'Database health check failed',
        err instanceof Error ? err.stack : String(err),
      );
      // 503 tells monitoring tools "the service is up but not usable".
      throw new ServiceUnavailableException({
        status: 'error',
        service: 'YESE backend',
        database: 'unreachable',
      });
    }

    return {
      status: 'ok',
      service: 'YESE backend',
      database: 'connected',
      timestamp: new Date().toISOString(),
    };
  }
}
