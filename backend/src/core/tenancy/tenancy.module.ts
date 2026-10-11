import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenancyController } from './tenancy.controller';
import { TenantMiddleware } from './tenant.middleware';
import { TenantPrismaService } from './tenant-prisma.service';

/**
 * Core tenancy: resolves the school on every request and provides the
 * school-scoped database client to every other module.
 */
@Global()
@Module({
  controllers: [TenancyController],
  providers: [TenantMiddleware, TenantPrismaService],
  exports: [TenantPrismaService, TenantMiddleware],
})
export class TenancyModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*path');
  }
}
