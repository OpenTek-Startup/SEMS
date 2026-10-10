import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { TenancyModule } from './core/tenancy/tenancy.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    // Global config from .env, validated at startup
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),

    // Core infrastructure
    PrismaModule,
    TenancyModule,

    // Feature modules
    HealthModule,
  ],
})
export class AppModule {}
