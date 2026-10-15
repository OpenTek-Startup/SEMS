import { Module } from '@nestjs/common';
import { RolesController, UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, RolesController],
  providers: [UsersService],
})
export class UsersModule {}
