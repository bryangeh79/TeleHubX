import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

import { ConnectionManager } from './telegram/telegram-client.service';
import { attachMessageHandler } from './telegram/message-handler';
import { KeepOnlineService } from './telegram/keeponline';

async function bootstrap() {
  const apiId = parseInt(process.env.TG_API_ID ?? '0', 10);
  const apiHash = process.env.TG_API_HASH ?? '';
  const phone = process.env.TG_PHONE ?? '';
  const session = process.env.TG_SESSION ?? '';

  if (!apiId || !apiHash || !phone) {
    console.log('TeleHubX Agent — set TG_API_ID, TG_API_HASH, TG_PHONE, TG_SESSION in .env to connect');
    return;
  }

  const manager = new ConnectionManager();
  const keepOnline = new KeepOnlineService();

  const proxy = process.env.TG_PROXY_IP
    ? {
        ip: process.env.TG_PROXY_IP,
        port: parseInt(process.env.TG_PROXY_PORT ?? '1080', 10),
        socksType: 5 as const,
        username: process.env.TG_PROXY_USER,
        password: process.env.TG_PROXY_PASS,
      }
    : undefined;

  const client = await manager.addAccount('account-1', {
    phoneNumber: phone,
    sessionString: session,
    apiId,
    apiHash,
    proxy,
  });

  console.log('State:', manager.getState('account-1'));

  const me = await client.getMe();
  console.log('Logged in as:', (me as any).username ?? phone);

  attachMessageHandler(client, {
    role: 'ad',
    botUsername: process.env.BOT_USERNAME ?? 'your_bot',
    adGroupFaqReply: 'For more details please DM our bot!',
  });

  keepOnline.start(client);
  console.log('KeepOnline active. Listening for messages...');

  process.once('SIGINT', async () => {
    keepOnline.stop();
    await manager.removeAccount('account-1');
    console.log('Disconnected.');
    process.exit(0);
  });
}

bootstrap().catch(console.error);
