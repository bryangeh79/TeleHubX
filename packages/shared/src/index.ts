// Account roles
export type AccountRole = 'cs' | 'ad' | 'hybrid';
export type AccountStatus = 'inactive' | 'connecting' | 'connected' | 'disconnected' | 'banned';
export type WarmupPhase = 0 | 1 | 2 | 3 | 4;
export type IntentLevel = 'cold' | 'warm' | 'hot';

export interface Account {
  id: string;
  tenantId: string;
  phone: string;
  role: AccountRole;
  status: AccountStatus;
  warmupPhase: WarmupPhase;
  healthScore: number;
  proxyId?: string;
  sessionString?: string;
  lastActiveAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';
  startTime: string;
  endTime?: string;
  dailyLimitPerAccount: number;
  targets: CampaignTarget[];
  createdAt: string;
}

export interface CampaignTarget {
  type: 'group' | 'private' | 'channel';
  targetId: string;
  targetName?: string;
}

export interface CampaignMaterial {
  id: string;
  planId: string;
  type: 'text' | 'image' | 'video' | 'file';
  content: string;
  mediaUrl?: string;
  aiVariants: string[];
  ctaType?: 'bot' | 'link' | 'group';
  ctaValue?: string;
}

export interface ChatScript {
  id: string;
  tenantId: string;
  name: string;
  accountIds: string[];
  groupIds: string[];
  lines: ScriptLine[];
  schedule: {
    cron: string;
    maxDaily: number;
    activeHours: [number, number];
  };
  status: 'active' | 'paused';
}

export interface ScriptLine {
  accountIndex: number;
  text: string;
  delayAfter: number;
  delayStdDev: number;
  variantCount?: number;
}

export interface Lead {
  id: string;
  tenantId: string;
  tgUsername: string;
  tgUserId: string;
  displayName: string;
  campaignId?: string;
  intentLevel: IntentLevel;
  needsHuman: boolean;
  firstContactAt: string;
  lastReplyAt: string;
  messagesCount: number;
}

// API Response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  limit: number;
}
