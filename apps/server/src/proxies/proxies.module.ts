import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProxiesController } from './proxies.controller';
import { ProxiesService } from './proxies.service';
import { Proxy } from './proxy.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Proxy])],
  controllers: [ProxiesController],
  providers: [ProxiesService],
  exports: [ProxiesService],
})
export class ProxiesModule {}
