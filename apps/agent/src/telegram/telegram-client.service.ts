import { TelegramClient } from 'telegram';
import { AccountState, AccountStateMachine } from './account.state';
import { createTelegramClient, TelegramClientConfig, exportSession } from './telegram-client.factory';

const RECONNECT_BASE_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 10;

// Error substrings that indicate a permanently dead account
const BANNED_ERRORS = ['USER_DEACTIVATED', 'AUTH_KEY_UNREGISTERED', 'SESSION_REVOKED'];

interface ManagedAccount {
  config: TelegramClientConfig;
  client: TelegramClient;
  sm: AccountStateMachine;
  reconnectAttempts: number;
  reconnectTimer: NodeJS.Timeout | null;
}

export class ConnectionManager {
  private accounts = new Map<string, ManagedAccount>();

  async addAccount(accountId: string, config: TelegramClientConfig): Promise<TelegramClient> {
    if (this.accounts.has(accountId)) {
      throw new Error(`Account ${accountId} already managed`);
    }
    const client = createTelegramClient(config);
    const sm = new AccountStateMachine(accountId);
    const entry: ManagedAccount = { config, client, sm, reconnectAttempts: 0, reconnectTimer: null };
    this.accounts.set(accountId, entry);
    await this.connect(accountId);
    return client;
  }

  async removeAccount(accountId: string): Promise<void> {
    const account = this.accounts.get(accountId);
    if (!account) return;
    if (account.reconnectTimer) clearTimeout(account.reconnectTimer);
    try {
      await account.client.disconnect();
    } catch {
      // best-effort
    }
    this.accounts.delete(accountId);
  }

  getClient(accountId: string): TelegramClient | undefined {
    return this.accounts.get(accountId)?.client;
  }

  getState(accountId: string): AccountState | undefined {
    return this.accounts.get(accountId)?.sm.getState();
  }

  getSession(accountId: string): string | undefined {
    const account = this.accounts.get(accountId);
    if (!account) return undefined;
    return exportSession(account.client);
  }

  listAccounts(): Array<{ accountId: string; state: AccountState; phone: string }> {
    return Array.from(this.accounts.entries()).map(([id, a]) => ({
      accountId: id,
      state: a.sm.getState(),
      phone: a.config.phoneNumber,
    }));
  }

  private async connect(accountId: string): Promise<void> {
    const account = this.accounts.get(accountId);
    if (!account) return;
    const { sm, client } = account;

    if (!sm.transition(AccountState.CONNECTING)) return;

    try {
      await client.connect();
      sm.transition(AccountState.ONLINE);
      account.reconnectAttempts = 0;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (BANNED_ERRORS.some((e) => msg.includes(e))) {
        sm.transition(AccountState.BANNED);
        return;
      }
      sm.transition(AccountState.ERROR);
      this.scheduleReconnect(accountId);
    }
  }

  private scheduleReconnect(accountId: string): void {
    const account = this.accounts.get(accountId);
    if (!account || account.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
    account.reconnectAttempts++;
    // Exponential back-off: 5s, 10s, 15s … capped at MAX_RECONNECT_ATTEMPTS
    const delay = RECONNECT_BASE_MS * account.reconnectAttempts;
    account.reconnectTimer = setTimeout(() => this.connect(accountId), delay);
  }
}
