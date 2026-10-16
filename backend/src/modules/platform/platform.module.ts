import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';

/** Super Admin console routes (the registry itself lives in core/modules). */
@Module({
  controllers: [PlatformController],
})
export class PlatformModule {}
