import { BadRequestException, Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { currentTenant } from './tenant-context';

@Public() // the sign-in page needs the school's name before anyone signs in
@Controller('tenant')
export class TenancyController {
  /** Which school is this request for? Used by the frontend and for checks. */
  @Get('current')
  current() {
    const tenant = currentTenant();
    if (!tenant) {
      throw new BadRequestException(
        'No school in this request. Send the X-Tenant header (development) or use the school subdomain.',
      );
    }
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      type: tenant.type,
    };
  }
}
