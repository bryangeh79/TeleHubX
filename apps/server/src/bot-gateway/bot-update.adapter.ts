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

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface NormalizedMessage {
  chatId: string;
  tgUserId: string;
  tgUsername?: string;
  text: string;
}

@Injectable()
export class BotUpdateAdapter {
  normalize(update: TelegramUpdate): NormalizedMessage | null {
    const msg = update.message;
    if (!msg) return null;
    if (!msg.text) return null;
    if (!msg.from) return null;
    if (msg.from.is_bot) return null;
    if (msg.chat.type !== 'private') return null;

    return {
      chatId: String(msg.chat.id),
      tgUserId: String(msg.from.id),
      tgUsername: msg.from.username,
      text: msg.text,
    };
  }
}
