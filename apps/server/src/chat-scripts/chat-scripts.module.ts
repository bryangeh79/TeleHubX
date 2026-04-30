import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatScript } from './chat-script.entity';
import { ChatScriptsController } from './chat-scripts.controller';
import { ChatScriptsService } from './chat-scripts.service';

@Module({
  imports: [TypeOrmModule.forFeature([ChatScript])],
  controllers: [ChatScriptsController],
  providers: [ChatScriptsService],
  exports: [ChatScriptsService],
})
export class ChatScriptsModule {}
