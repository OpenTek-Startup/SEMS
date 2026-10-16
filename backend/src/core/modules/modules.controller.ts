import { BadRequestException, Controller, Get } from '@nestjs/common';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../auth/decorators';
import { isCore } from './module-rules';
import { ModuleRegistryService } from './module-registry.service';

/**
 * /api/modules — the module catalogue as seen by the CURRENT school:
 * which modules are active, so the frontend can show only their menus.
 * Any signed-in school user may read it.
 */
@Controller('modules')
export class ModulesController {
  constructor(private readonly registry: ModuleRegistryService) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext) {
    if (!auth.tenantId) {
      throw new BadRequestException({ code: 'SCHOOL_REQUIRED', message: 'Module activation is per school.' });
    }
    const [catalogue, active] = await Promise.all([
      this.registry.catalogue(),
      this.registry.activeModules(auth.tenantId),
    ]);
    return catalogue.map((m) => ({
      code: m.code,
      name: m.name,
      category: m.category,
      description: m.description,
      dependsOn: m.dependsOn,
      core: isCore(m),
      active: active.has(m.code),
    }));
  }
}
