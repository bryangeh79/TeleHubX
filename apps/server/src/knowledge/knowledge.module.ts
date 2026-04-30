import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiFaqGeneratorService } from './ai-faq-generator.service';
import { EntityExtractorService } from './entity-extractor.service';
import { Faq } from './faq.entity';
import { FileParserService } from './file-parser.service';
import { KbProtected } from './kb-protected.entity';
import { KbSource } from './kb-source.entity';
import { KnowledgeBase } from './kb.entity';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeBase, Faq, KbSource, KbProtected])],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    FileParserService,
    EntityExtractorService,
    AiFaqGeneratorService,
  ],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
