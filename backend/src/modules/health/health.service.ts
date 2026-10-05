import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check() {
    // Round-trip to the database to prove connectivity.
    await this.prisma.$queryRaw`SELECT 1`;

    return {
      status: 'ok',
      service: 'YESE backend',
      database: 'connected',
      timestamp: new Date().toISOString(),
    };
  }
}
