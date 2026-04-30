import { Injectable } from '@nestjs/common';
import { ProtectedEntityType } from './kb-protected.entity';

interface ExtractedEntity {
  entityType: ProtectedEntityType;
  value: string;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const URL_RE = /https?:\/\/[^\s<>"'，。、]+|(?:wa\.me|t\.me)\/[^\s<>"'，。、]+/gi;
const PHONE_RE = /(?:\+?\d[\d\s-]{6,18}\d)/g;

@Injectable()
export class EntityExtractorService {
  /**
   * Extract phone/email/url entities from raw text. Deduplicates within the
   * batch. Caller is responsible for skipping duplicates that already exist
   * in the kb_protected table for the same KB.
   */
  extract(text: string): ExtractedEntity[] {
    const out: ExtractedEntity[] = [];
    const seen = new Set<string>();
    const push = (entityType: ProtectedEntityType, value: string) => {
      const key = `${entityType}:${value}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ entityType, value });
    };

    for (const m of text.matchAll(EMAIL_RE)) push(ProtectedEntityType.EMAIL, m[0]);
    for (const m of text.matchAll(URL_RE)) push(ProtectedEntityType.URL, m[0]);

    for (const m of text.matchAll(PHONE_RE)) {
      const cleaned = m[0].replace(/[\s-]/g, '');
      if (cleaned.length >= 8 && cleaned.length <= 16) {
        push(ProtectedEntityType.PHONE, cleaned);
      }
    }

    return out;
  }
}
