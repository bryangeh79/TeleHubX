import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreateProxyDto } from './dto/create-proxy.dto';
import { UpdateProxyDto } from './dto/update-proxy.dto';
import { ProxyStatus } from './proxy.entity';
import { ProxiesService } from './proxies.service';

@Controller('proxies')
export class ProxiesController {
  constructor(private readonly service: ProxiesService) {}

  @Post()
  create(@Body() dto: CreateProxyDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query('status') status?: ProxyStatus) {
    return this.service.findAll({ status });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProxyDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  /**
   * 真实测试代理：通过它向 ipify/ipinfo 拉一次外网 IP。
   * 返回延迟 + 观察到的外部 IP；失败时把 status 标记为 error。
   */
  @Post(':id/test')
  test(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.test(id);
  }

  /**
   * 给 agent 进程用的"即插即用"代理描述符。
   * - SOCKS5/4 → 解密后直接返回
   * - HTTP/HTTPS → 后台启动 HttpToSocks5Bridge，返回 127.0.0.1:bridge_port
   *
   * 这个端点跳过 select:false 的 password 字段限制（service.toGramConfig 内部走 getDecrypted）。
   * 仅在内网 (localhost) 调用安全；公网部署应加 JWT 守卫。
   */
  @Get(':id/gram-config')
  gramConfig(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.toGramConfig(id);
  }
}
