import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { KbSourceKind } from './kb-source.entity';

/**
 * Parses uploaded files into plain text. Currently supports txt/md inline.
 * PDF/docx require optional deps (pdf-parse / mammoth) — when those packages
 * are installed they will be loaded dynamically; until then the corresponding
 * upload returns a clear error.
 */
@Injectable()
export class FileParserService {
  private readonly logger = new Logger(FileParserService.name);

  detectKind(fileName: string, mime?: string): KbSourceKind {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.txt')) return KbSourceKind.TXT;
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) return KbSourceKind.MD;
    if (lower.endsWith('.pdf') || mime === 'application/pdf') return KbSourceKind.PDF;
    if (lower.endsWith('.docx') || mime?.includes('officedocument.wordprocessingml')) {
      return KbSourceKind.DOCX;
    }
    throw new BadRequestException(`Unsupported file type: ${fileName}`);
  }

  async parse(buffer: Buffer, kind: KbSourceKind): Promise<string> {
    switch (kind) {
      case KbSourceKind.TXT:
      case KbSourceKind.MD:
        return buffer.toString('utf8');
      case KbSourceKind.PDF:
        return this.parsePdf(buffer);
      case KbSourceKind.DOCX:
        return this.parseDocx(buffer);
      default:
        throw new BadRequestException(`Cannot parse kind=${kind}`);
    }
  }

  private async parsePdf(buffer: Buffer): Promise<string> {
    try {
      // @ts-expect-error optional dep loaded at runtime
      const mod = await import('pdf-parse');
      const pdfParse = mod.default ?? mod;
      const result = await pdfParse(buffer);
      return result.text ?? '';
    } catch (err) {
      const e = err as Error;
      if (e.message?.includes('Cannot find module')) {
        throw new BadRequestException('PDF 解析依赖未安装，请先 pnpm add pdf-parse');
      }
      this.logger.error(`PDF parse failed: ${e.message}`);
      throw new BadRequestException(`PDF parse failed: ${e.message}`);
    }
  }

  private async parseDocx(buffer: Buffer): Promise<string> {
    try {
      // @ts-expect-error optional dep loaded at runtime
      const mod = await import('mammoth');
      const mammoth = mod.default ?? mod;
      const result = await mammoth.extractRawText({ buffer });
      return result.value ?? '';
    } catch (err) {
      const e = err as Error;
      if (e.message?.includes('Cannot find module')) {
        throw new BadRequestException('DOCX 解析依赖未安装，请先 pnpm add mammoth');
      }
      this.logger.error(`DOCX parse failed: ${e.message}`);
      throw new BadRequestException(`DOCX parse failed: ${e.message}`);
    }
  }

  /** Simple chunker: ~500 chars per chunk with 50-char overlap. */
  chunk(text: string, size = 500, overlap = 50): string[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    if (trimmed.length <= size) return [trimmed];

    const chunks: string[] = [];
    let pos = 0;
    while (pos < trimmed.length) {
      const end = Math.min(pos + size, trimmed.length);
      chunks.push(trimmed.slice(pos, end));
      if (end === trimmed.length) break;
      pos = end - overlap;
    }
    return chunks;
  }
}
