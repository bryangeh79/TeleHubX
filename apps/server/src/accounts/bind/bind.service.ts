import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { computeCheck } from 'telegram/Password';
import { AccountsService } from '../accounts.service';
import { ProxiesService } from '../../proxies/proxies.service';

interface ActiveBind {
  client: TelegramClient;
  phone: string;
  phoneCodeHash: string;
  createdAt: number;
}

export interface BindInitResult {
  phoneCodeHash: string;
  expiresIn: number;
  /** Helps the UI hint where the OTP arrived (Telegram app, SMS, etc.) */
  codeType?: string;
}

export interface BindVerifyResult {
  ok: true;
  needsPassword: false;
  user: { id: string; username?: string; firstName?: string; phone?: string };
}

export interface BindVerifyNeedsPassword {
  ok: false;
  needsPassword: true;
  hint?: string;
}

const BIND_TTL_MS = 5 * 60_000;
const GC_INTERVAL_MS = 60_000;

/** GramJS proxy format. SOCKS only (MTProto needs binary tunnel). */
interface GramProxy {
  ip: string;
  port: number;
  socksType: 4 | 5;
  username?: string;
  password?: string;
}

@Injectable()
export class BindOrchestratorService implements OnModuleDestroy {
  private readonly logger = new Logger(BindOrchestratorService.name);
  private readonly active = new Map<string, ActiveBind>();
  private readonly apiId: number;
  private readonly apiHash: string;
  private readonly configured: boolean;
  private readonly gcTimer: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService,
    private readonly accounts: AccountsService,
    private readonly proxies: ProxiesService,
  ) {
    const idRaw = this.config.get<string>('TG_API_ID', '');
    this.apiId = parseInt(idRaw, 10) || 0;
    this.apiHash = this.config.get<string>('TG_API_HASH', '');
    this.configured = Boolean(this.apiId && this.apiHash);
    if (!this.configured) {
      this.logger.warn('TG_API_ID / TG_API_HASH not set — bind endpoints will return 503');
    }

    this.gcTimer = setInterval(() => this.gcExpired(), GC_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.gcTimer);
    for (const [, entry] of this.active) {
      try {
        await entry.client.disconnect();
      } catch {
        /* best-effort */
      }
    }
    this.active.clear();
  }

  async init(accountId: string, phone: string): Promise<BindInitResult> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Telegram bind not configured. Set TG_API_ID and TG_API_HASH in environment.',
      );
    }

    // Verify the account record exists; throws NotFoundException if not
    const account = await this.accounts.findOne(accountId);

    // Cancel any in-progress bind for this account (e.g. user retried)
    await this.cancelExisting(accountId);

    // 1. 拿账号专属设备指纹（永远跟着 accountId 走，绑/重连都一致）
    const fp = await this.accounts.ensureDeviceFingerprint(accountId);

    // 2. 拿账号绑定的代理（如果有），转成 GramJS 期望的 SOCKS 格式
    let gramProxy: GramProxy | undefined;
    if (account.proxyId) {
      try {
        const p = await this.proxies.getDecrypted(account.proxyId);
        const t = p.type.toLowerCase();
        if (t === 'socks5' || t === 'socks4') {
          gramProxy = {
            ip: p.host,
            port: p.port,
            socksType: t === 'socks4' ? 4 : 5,
            username: p.username,
            password: p.password,
          };
          this.logger.log(
            `[bind:${accountId}] using proxy ${t}://${p.host}:${p.port}`,
          );
        } else {
          this.logger.warn(
            `[bind:${accountId}] proxy type=${p.type} 不被 GramJS MTProto 支持 — 本次绑号将走服务器直连。请改用 SOCKS5 代理。`,
          );
        }
      } catch (err) {
        this.logger.error(`[bind:${accountId}] failed to load proxy: ${(err as Error).message}`);
      }
    } else {
      this.logger.warn(
        `[bind:${accountId}] 账号未绑定代理 — 走服务器直连。强烈建议为每号绑定 SOCKS5 住宅代理。`,
      );
    }

    const client = new TelegramClient(
      new StringSession(''),
      this.apiId,
      this.apiHash,
      {
        connectionRetries: 3,
        deviceModel: fp.deviceModel,
        systemVersion: fp.systemVersion,
        appVersion: fp.appVersion,
        langCode: fp.langCode || 'en',
        systemLangCode: fp.systemLangCode || 'en',
        ...(gramProxy ? { proxy: gramProxy } : {}),
      },
    );

    try {
      await client.connect();
      const sent = await client.invoke(
        new Api.auth.SendCode({
          phoneNumber: phone,
          apiId: this.apiId,
          apiHash: this.apiHash,
          settings: new Api.CodeSettings({
            allowFlashcall: false,
            currentNumber: false,
            allowAppHash: true,
            allowMissedCall: false,
          }),
        }),
      ) as Api.auth.SentCode;

      const phoneCodeHash = sent.phoneCodeHash;
      const expiresIn = sent.timeout ?? 60;
      const codeType = (sent.type as { className?: string } | undefined)?.className?.replace(
        'auth.SentCodeType',
        '',
      );

      this.active.set(accountId, {
        client,
        phone,
        phoneCodeHash,
        createdAt: Date.now(),
      });

      this.logger.log(
        `[bind:${accountId}] sendCode ok phone=${maskPhone(phone)} type=${codeType ?? '?'}`,
      );

      return { phoneCodeHash, expiresIn, codeType };
    } catch (err) {
      await client.disconnect().catch(() => {});
      this.translateGramError(err);
    }
  }

  async verify(
    accountId: string,
    code: string,
    password?: string,
  ): Promise<BindVerifyResult | BindVerifyNeedsPassword> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Telegram bind not configured. Set TG_API_ID and TG_API_HASH in environment.',
      );
    }

    const entry = this.active.get(accountId);
    if (!entry) {
      throw new BadRequestException(
        'No active bind session for this account. Call /bind/init first (sessions expire after 5min).',
      );
    }

    try {
      // Step 1: try signIn with the code
      try {
        await entry.client.invoke(
          new Api.auth.SignIn({
            phoneNumber: entry.phone,
            phoneCodeHash: entry.phoneCodeHash,
            phoneCode: code,
          }),
        );
      } catch (err: unknown) {
        const errMsg = (err as { errorMessage?: string })?.errorMessage ?? '';

        // 2FA gate — caller must re-call verify with password
        if (errMsg === 'SESSION_PASSWORD_NEEDED') {
          if (!password) {
            // Keep the bind session alive so the user can submit password next
            const pwdInfo = await entry.client.invoke(new Api.account.GetPassword());
            const hint = (pwdInfo as { hint?: string }).hint;
            this.logger.log(
              `[bind:${accountId}] 2FA required for ${maskPhone(entry.phone)}`,
            );
            return { ok: false, needsPassword: true, hint };
          }

          // Step 2: 2FA password check via SRP
          const pwdInfo = await entry.client.invoke(new Api.account.GetPassword());
          const srpCheck = await computeCheck(pwdInfo, password);
          await entry.client.invoke(
            new Api.auth.CheckPassword({ password: srpCheck }),
          );
        } else {
          throw err;
        }
      }

      // Sign-in completed — collect identity + persist session, then disconnect
      const me = (await entry.client.getMe()) as {
        id?: { toString(): string };
        username?: string;
        firstName?: string;
        phone?: string;
      };
      const sessionString = (entry.client.session as StringSession).save();

      // Encrypt + persist via existing AccountsService.updateSession
      // (it picks up SESSION_ENCRYPTION_KEY automatically)
      await this.accounts.updateSession(accountId, sessionString);

      await entry.client.disconnect().catch(() => {});
      this.active.delete(accountId);

      const userId = me.id?.toString() ?? '';
      this.logger.log(
        `[bind:${accountId}] signIn ok user=@${me.username ?? '(none)'} id=${userId}`,
      );

      return {
        ok: true,
        needsPassword: false,
        user: {
          id: userId,
          username: me.username,
          firstName: me.firstName,
          phone: me.phone,
        },
      };
    } catch (err) {
      // Hard failures dispose the connection so user must restart from /init
      await entry.client.disconnect().catch(() => {});
      this.active.delete(accountId);
      this.translateGramError(err);
    }
  }

  async cancel(accountId: string): Promise<{ ok: true; cancelled: boolean }> {
    const had = this.active.has(accountId);
    await this.cancelExisting(accountId);
    return { ok: true, cancelled: had };
  }

  /** Public: how many in-progress binds. Handy for /info or smoke tests. */
  inFlight(): number {
    return this.active.size;
  }

  private async cancelExisting(accountId: string): Promise<void> {
    const entry = this.active.get(accountId);
    if (!entry) return;
    await entry.client.disconnect().catch(() => {});
    this.active.delete(accountId);
  }

  private gcExpired(): void {
    const now = Date.now();
    for (const [id, entry] of this.active) {
      if (now - entry.createdAt > BIND_TTL_MS) {
        entry.client.disconnect().catch(() => {});
        this.active.delete(id);
        this.logger.log(`[bind:${id}] expired (ttl ${BIND_TTL_MS}ms)`);
      }
    }
  }

  /** Translate GramJS errors into user-meaningful HTTP exceptions. */
  private translateGramError(err: unknown): never {
    // Pass through HttpExceptions (already shaped by us, e.g. NotFoundException)
    if ((err as { status?: number; getStatus?: unknown })?.getStatus) throw err;

    const e = err as { errorMessage?: string; message?: string };
    const code = e?.errorMessage ?? '';
    const msg = e?.message ?? code ?? 'Telegram bind error';
    this.logger.error(`bind error code=${code} message=${msg}`);

    switch (true) {
      case code === 'PHONE_NUMBER_INVALID':
        throw new BadRequestException('Phone number invalid (must be E.164 with country code).');
      case code === 'PHONE_NUMBER_BANNED':
        throw new BadRequestException('This phone number is banned by Telegram.');
      case code === 'PHONE_CODE_INVALID':
        throw new BadRequestException('OTP code is incorrect.');
      case code === 'PHONE_CODE_EXPIRED':
        throw new BadRequestException('OTP code expired — request a new one via /bind/init.');
      case code === 'PASSWORD_HASH_INVALID':
        throw new BadRequestException('2FA password is incorrect.');
      case code === 'PHONE_NUMBER_OCCUPIED':
        throw new BadRequestException('This phone number is already taken.');
      case code.startsWith('FLOOD_WAIT_'): {
        const secs = parseInt(code.replace('FLOOD_WAIT_', ''), 10) || 60;
        throw new BadRequestException(`Telegram rate-limited this number — wait ${secs}s before retrying.`);
      }
      default:
        throw new BadRequestException(`Telegram error: ${code || msg}`);
    }
  }
}

function maskPhone(p: string): string {
  if (!p || p.length < 6) return '***';
  return `${p.slice(0, 3)}***${p.slice(-2)}`;
}
