import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { TenancyModule } from './core/tenancy/tenancy.module';
import { AuditModule } from './core/audit/audit.module';
import { AuthModule } from './core/auth/auth.module';
import { ModulesModule } from './core/modules/modules.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { AuditViewerModule } from './modules/audit/audit-viewer.module';
import { PlatformModule } from './modules/platform/platform.module';

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
    AuditModule,
    ModulesModule, // Module Registry: which modules each school has switched on
    AuthModule, // global AuthGuard: routes need a signed-in user unless @Public()

    // Feature modules
    HealthModule,
    UsersModule,
    AuditViewerModule,
    PlatformModule,
  ],
})
export class AppModule {}
