export enum AccountState {
  OFFLINE = 'offline',
  CONNECTING = 'connecting',
  ONLINE = 'online',
  ERROR = 'error',
  BANNED = 'banned',
}

const VALID_TRANSITIONS: Record<AccountState, AccountState[]> = {
  [AccountState.OFFLINE]: [AccountState.CONNECTING],
  [AccountState.CONNECTING]: [AccountState.ONLINE, AccountState.ERROR, AccountState.BANNED],
  [AccountState.ONLINE]: [AccountState.OFFLINE, AccountState.ERROR, AccountState.BANNED],
  [AccountState.ERROR]: [AccountState.CONNECTING, AccountState.OFFLINE],
  [AccountState.BANNED]: [],
};

export class AccountStateMachine {
  private state: AccountState = AccountState.OFFLINE;

  constructor(readonly accountId: string) {}

  getState(): AccountState {
    return this.state;
  }

  transition(next: AccountState): boolean {
    if (!VALID_TRANSITIONS[this.state].includes(next)) {
      console.warn(`[${this.accountId}] Invalid transition ${this.state} -> ${next}`);
      return false;
    }
    console.log(`[${this.accountId}] State: ${this.state} -> ${next}`);
    this.state = next;
    return true;
  }

  is(state: AccountState): boolean {
    return this.state === state;
  }
}
