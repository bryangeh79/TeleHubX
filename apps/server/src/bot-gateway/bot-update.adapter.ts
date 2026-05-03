import { Injectable } from '@nestjs/common';

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramVideo {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramSticker {
  file_id: string;
  file_unique_id: string;
  emoji?: string;
  set_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];      // 多个尺寸数组，最后一个是最大原图
  video?: TelegramVideo;
  document?: TelegramDocument;
  sticker?: TelegramSticker;
  voice?: { file_id: string; duration: number; mime_type?: string };
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
  chat_instance?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface NormalizedMessage {
  chatId: string;
  tgUserId: string;
  tgUsername?: string;
  text: string;
  /** 'message' = 客户文字消息；'callback' = 客户点了 inline keyboard 按钮 */
  kind: 'message' | 'callback';
  callbackQueryId?: string;
  callbackData?: string;
}

@Injectable()
export class BotUpdateAdapter {
  normalize(update: TelegramUpdate): NormalizedMessage | null {
    // ── 优先处理 callback_query（客户点 inline keyboard 按钮）
    if (update.callback_query) {
      const cb = update.callback_query;
      if (!cb.from || cb.from.is_bot) return null;
      const chat = cb.message?.chat;
      if (!chat) return null;
      return {
        chatId: String(chat.id),
        tgUserId: String(cb.from.id),
        tgUsername: cb.from.username,
        text: `[按钮] ${cb.data ?? ''}`,
        kind: 'callback',
        callbackQueryId: cb.id,
        callbackData: cb.data,
      };
    }

    const msg = update.message;
    if (!msg) return null;
    if (!msg.from) return null;
    if (msg.from.is_bot) return null;
    if (msg.chat.type !== 'private') return null;

    // 文字消息直接用
    let text = msg.text ?? '';
    if (!text) {
      // 媒体消息：转成可读占位文字（caption + 类型标签）
      const cap = msg.caption ?? '';
      if (msg.photo?.length) {
        text = `[图片]${cap ? ' ' + cap : ''}`;
      } else if (msg.video) {
        text = `[视频]${cap ? ' ' + cap : ''}`;
      } else if (msg.document) {
        const fname = msg.document.file_name ?? '文件';
        text = `[文件: ${fname}]${cap ? ' ' + cap : ''}`;
      } else if (msg.sticker) {
        text = `[贴纸 ${msg.sticker.emoji ?? ''}]`;
      } else if (msg.voice) {
        text = `[语音 ${msg.voice.duration}s]`;
      } else {
        return null;
      }
    }

    return {
      chatId: String(msg.chat.id),
      tgUserId: String(msg.from.id),
      tgUsername: msg.from.username,
      text,
      kind: 'message',
    };
  }
}
