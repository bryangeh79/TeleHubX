import { Injectable, Logger } from '@nestjs/common';
import { TelegramUpdate } from './bot-update.adapter';

const TG_API = 'https://api.telegram.org';

export interface TgGetMeResult {
  id: number;
  username: string;
  first_name: string;
  is_bot: boolean;
}

@Injectable()
export class BotReplyService {
  private readonly logger = new Logger(BotReplyService.name);

  async getMe(token: string): Promise<TgGetMeResult> {
    const res = await fetch(`${TG_API}/bot${token}/getMe`);
    const body = (await res.json()) as { ok: boolean; result?: TgGetMeResult; description?: string };
    if (!body.ok || !body.result) {
      throw new Error(`getMe failed: ${body.description ?? 'unknown error'}`);
    }
    return body.result;
  }

  async getUpdates(token: string, offset: number, timeout = 25): Promise<TelegramUpdate[]> {
    const url = `${TG_API}/bot${token}/getUpdates?offset=${offset}&timeout=${timeout}&allowed_updates=["message"]`;
    const res = await fetch(url, { signal: AbortSignal.timeout((timeout + 5) * 1000) });
    const body = (await res.json()) as { ok: boolean; result?: TelegramUpdate[]; description?: string };
    if (!body.ok) {
      const err = new Error(body.description ?? 'getUpdates failed') as Error & { statusCode?: number };
      err.statusCode = res.status;
      throw err;
    }
    return body.result ?? [];
  }

  async sendText(token: string, chatId: string, text: string): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: Number(chatId), text }),
      });
    } catch (err) {
      this.logger.error(`sendText network error chatId=${chatId}: ${(err as Error).message}`);
      return;
    }

    if (res.status === 429) {
      this.logger.warn(`sendText rate-limited chatId=${chatId}`);
      return;
    }
    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`sendText failed chatId=${chatId} status=${res.status} body=${body}`);
    }
  }
}
