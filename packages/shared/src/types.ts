export type AccountRole = 'cs' | 'ad' | 'hybrid';
export type AccountStatus = 'offline' | 'online' | 'connecting' | 'error' | 'banned';
export type WarmupPhase = 0 | 1 | 2 | 3 | 4;

export interface Account {
  id: string;
  phoneNumber: string;
  role: AccountRole;
  status: AccountStatus;
  warmupPhase: WarmupPhase;
  proxy?: ProxyConfig;
  sessionString?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  type: 'socks5' | 'http' | 'https';
}
