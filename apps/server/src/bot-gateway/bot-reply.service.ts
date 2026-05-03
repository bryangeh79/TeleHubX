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

  /** 查询 bot 当前的 webhook 配置，用于诊断"消息为什么没到我们"的问题。 */
  async getWebhookInfo(token: string): Promise<{ url: string; pendingUpdateCount: number; hasCustomCertificate: boolean; lastErrorDate?: number; lastErrorMessage?: string }> {
    const res = await fetch(`${TG_API}/bot${token}/getWebhookInfo`);
    const body = (await res.json()) as { ok: boolean; result?: any; description?: string };
    if (!body.ok || !body.result) {
      throw new Error(`getWebhookInfo failed: ${body.description ?? 'unknown'}`);
    }
    return {
      url: body.result.url ?? '',
      pendingUpdateCount: body.result.pending_update_count ?? 0,
      hasCustomCertificate: body.result.has_custom_certificate ?? false,
      lastErrorDate: body.result.last_error_date,
      lastErrorMessage: body.result.last_error_message,
    };
  }

  /** 清除 webhook + 丢弃积压的 pending updates，让 getUpdates 长轮询独占消息流。 */
  async deleteWebhook(token: string): Promise<{ ok: boolean; description?: string }> {
    const res = await fetch(`${TG_API}/bot${token}/deleteWebhook?drop_pending_updates=true`);
    const body = (await res.json()) as { ok: boolean; result?: boolean; description?: string };
    return { ok: body.ok, description: body.description };
  }

  async getUpdates(token: string, offset: number, timeout = 25): Promise<TelegramUpdate[]> {
    const allowed = encodeURIComponent('["message","callback_query"]');
    const url = `${TG_API}/bot${token}/getUpdates?offset=${offset}&timeout=${timeout}&allowed_updates=${allowed}`;
    const res = await fetch(url, { signal: AbortSignal.timeout((timeout + 5) * 1000) });
    const body = (await res.json()) as { ok: boolean; result?: TelegramUpdate[]; description?: string };
    if (!body.ok) {
      const err = new Error(body.description ?? 'getUpdates failed') as Error & { statusCode?: number };
      err.statusCode = res.status;
      throw err;
    }
    return body.result ?? [];
  }

  /** Telegram inline_keyboard reply_markup. 二维数组：每一行一个 button 数组 */
  async sendText(
    token: string,
    chatId: string,
    text: string,
    replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> },
  ): Promise<{ ok: boolean; description?: string; status?: number }> {
    let res: Response;
    try {
      const payload: Record<string, unknown> = { chat_id: Number(chatId), text };
      if (replyMarkup) payload.reply_markup = replyMarkup;
      res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      const description = (err as Error).message;
      this.logger.error(`sendText network error chatId=${chatId}: ${description}`);
      return { ok: false, description };
    }

    if (res.status === 429) {
      this.logger.warn(`sendText rate-limited chatId=${chatId}`);
      return { ok: false, description: 'rate limited', status: 429 };
    }
    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`sendText failed chatId=${chatId} status=${res.status} body=${body}`);
      let description = body;
      try {
        const parsed = JSON.parse(body);
        if (parsed?.description) description = String(parsed.description);
      } catch { /* keep raw */ }
      return { ok: false, description, status: res.status };
    }
    return { ok: true, status: 200 };
  }

  /**
   * 必须在收到 callback_query 后调用，否则客户端按钮上的 loading spinner 不会消失。
   * text 可选 — 若提供，会作为 toast 弹一下（≤200 字符）。
   */
  async answerCallbackQuery(token: string, callbackQueryId: string, text?: string): Promise<void> {
    try {
      const payload: Record<string, unknown> = { callback_query_id: callbackQueryId };
      if (text) payload.text = text.slice(0, 200);
      await fetch(`${TG_API}/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      this.logger.warn(`answerCallbackQuery failed id=${callbackQueryId}: ${(err as Error).message}`);
    }
  }

  /**
   * 发送多媒体消息到 Telegram。
   * @param kind 'photo' / 'video' / 'document' — TG API 端点和字段名都不同
   * @param file Node Buffer + 原始文件名 + mime
   * @param caption 可选附文（≤1024 字符）
   */
  async sendMedia(
    token: string,
    chatId: string,
    kind: 'photo' | 'video' | 'document',
    file: { buffer: Buffer; filename: string; mimetype: string },
    caption?: string,
  ): Promise<{ ok: boolean; description?: string }> {
    const fd = new FormData();
    fd.append('chat_id', String(chatId));
    if (caption) fd.append('caption', caption);
    // Web FormData wants Blob/File; convert from Buffer (Node 20+ has Blob globally)
    const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype || 'application/octet-stream' });
    fd.append(kind, blob, file.filename);

    let res: Response;
    try {
      res = await fetch(`${TG_API}/bot${token}/send${kind.charAt(0).toUpperCase() + kind.slice(1)}`, {
        method: 'POST',
        body: fd,
      });
    } catch (err) {
      const e = (err as Error).message;
      this.logger.error(`send${kind} network error chatId=${chatId}: ${e}`);
      return { ok: false, description: e };
    }
    const body = (await res.json()) as { ok: boolean; description?: string };
    if (!body.ok) {
      this.logger.error(`send${kind} failed chatId=${chatId} status=${res.status} body=${JSON.stringify(body).slice(0, 200)}`);
    }
    return { ok: body.ok, description: body.description };
  }

  /**
   * 把 Telegram 上的文件 (file_id) 通过 getFile + downloadable URL 转成可分享 URL。
   * 用于客户发图给 bot 时，dashboard 端能渲染缩略图。
   * 注意：URL 30 分钟后失效，且 token 嵌在 URL 里 — 仅给 dashboard 内网用。
   */
  async getFileUrl(token: string, fileId: string): Promise<string | null> {
    try {
      const res = await fetch(`${TG_API}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
      const body = (await res.json()) as { ok: boolean; result?: { file_path: string }; description?: string };
      if (!body.ok || !body.result?.file_path) return null;
      return `${TG_API}/file/bot${token}/${body.result.file_path}`;
    } catch {
      return null;
    }
  }
}
