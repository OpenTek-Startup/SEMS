import { Global, Module } from '@nestjs/common';
import { ModuleRegistryService } from './module-registry.service';
import { ModulesController } from './modules.controller';

/** Global: AuthGuard, AuthService and feature modules all ask the registry. */
@Global()
@Module({
  controllers: [ModulesController],
  providers: [ModuleRegistryService],
  exports: [ModuleRegistryService],
})
export class ModulesModule {}
