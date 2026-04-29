import * as fs from 'fs';
import * as path from 'path';

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Keyed by accountId + chatId, stored as individual JSON files under dataDir.
export class ContextStore {
  constructor(private readonly dataDir = './data/contexts') {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  private filePath(accountId: string, chatId: string): string {
    // Sanitise so it's a safe filename on any OS
    const key = `${accountId}_${chatId}`.replace(/[^a-z0-9_-]/gi, '_');
    return path.join(this.dataDir, `${key}.json`);
  }

  load(accountId: string, chatId: string): ConversationMessage[] {
    const fp = this.filePath(accountId, chatId);
    if (!fs.existsSync(fp)) return [];
    try {
      return JSON.parse(fs.readFileSync(fp, 'utf-8')) as ConversationMessage[];
    } catch {
      return [];
    }
  }

  append(accountId: string, chatId: string, msg: ConversationMessage, maxHistory = 20): void {
    const msgs = this.load(accountId, chatId);
    msgs.push(msg);
    // Preserve leading system message; keep last maxHistory non-system turns
    const system = msgs.find((m) => m.role === 'system');
    const rest = msgs.filter((m) => m.role !== 'system').slice(-maxHistory);
    const next = system ? [system, ...rest] : rest;
    fs.writeFileSync(this.filePath(accountId, chatId), JSON.stringify(next, null, 2));
  }

  clear(accountId: string, chatId: string): void {
    const fp = this.filePath(accountId, chatId);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
}
