import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    // Global config from .env
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    // Core infrastructure
    PrismaModule,

    // Feature modules (business modules go here as we build Phases 1+)
    HealthModule,
  ],
})
export class AppModule {}
