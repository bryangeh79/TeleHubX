import axios from 'axios';

const BASE = '/api/v1';

const api = axios.create({
  baseURL: BASE,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// Inject Bearer token if present in localStorage (set by LoginPage)
api.interceptors.request.use((config) => {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('telehubx:token') : null;
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

// 401 → 清 token + 跳登录页（避免 token 过期后 silent stuck）
api.interceptors.response.use(
  (resp) => resp,
  (err) => {
    if (err?.response?.status === 401) {
      const path = window.location.pathname;
      if (!path.startsWith('/login') && !path.startsWith('/activate')) {
        try { localStorage.removeItem('telehubx:token'); } catch {}
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  },
);

export const accountsApi = {
  list: (params?: any) => api.get('/accounts', { params }),
  get: (id: string) => api.get(`/accounts/${id}`),
  create: (data: any) => api.post('/accounts', data),
  update: (id: string, data: any) => api.patch(`/accounts/${id}`, data),
  delete: (id: string) => api.delete(`/accounts/${id}`),
  updateSession: (id: string, sessionString: string) =>
    api.post(`/accounts/${id}/session`, { sessionString }),
  reportHealth: (id: string, healthScore: number, remark?: string) =>
    api.post(`/accounts/${id}/health`, { healthScore, remark }),
  heartbeat: (id: string) => api.post(`/accounts/${id}/heartbeat`),
  import: (accounts: any[]) => api.post('/accounts/import', { accounts }),
  healthStats: () => api.get('/accounts/health-stats'),
  // BindWizard endpoints
  bindInit: (id: string, phone: string) =>
    api.post(`/accounts/${id}/bind/init`, { phone }),
  bindVerify: (id: string, code: string, password?: string) =>
    api.post(`/accounts/${id}/bind/verify`, password ? { code, password } : { code }),
  bindCancel: (id: string) => api.post(`/accounts/${id}/bind/cancel`),
};

export const warmupApi = {
  start:   (id: string) => api.post(`/accounts/${id}/warmup/start`),
  advance: (id: string) => api.post(`/accounts/${id}/warmup/advance`),
  status:  (id: string) => api.get(`/accounts/${id}/warmup`),
  pause:   (id: string) => api.post(`/accounts/${id}/warmup/pause`),
  resume:  (id: string) => api.post(`/accounts/${id}/warmup/resume`),
};

export const campaignsApi = {
  list: (params?: any) => api.get('/campaigns', { params }),
  get: (id: string) => api.get(`/campaigns/${id}`),
  create: (data: any) => api.post('/campaigns', data),
  update: (id: string, data: any) => api.patch(`/campaigns/${id}`, data),
  delete: (id: string) => api.delete(`/campaigns/${id}`),
  send: (id: string) => api.post(`/campaigns/${id}/send`),
  listTasks: (id: string) => api.get(`/campaigns/${id}/tasks`),
  retryFailed: (id: string) => api.post(`/campaigns/${id}/retry-failed`),
  capacityCheck: (params: {
    targetCount?: number;
    pacePreset?: string;
    customerGroupIds?: string[];
    extraTargets?: string[];
  }) => api.get('/campaigns/capacity-check', {
    params: {
      targetCount: params.targetCount,
      pacePreset: params.pacePreset,
      customerGroupIds: params.customerGroupIds?.join(','),
      extraTargets: params.extraTargets?.join(','),
    },
  }),
  previewDispatch: (data: {
    customerGroupIds?: string[];
    targets?: string[];
    pacePreset?: string;
    accountSourceMode?: string;
    adAccountIds?: string[];
    scheduleMode?: string;
  }) => api.post('/campaigns/dispatch-preview', data, { timeout: 15000 }),
};

export const customerGroupsApi = {
  list: (tenantId?: string) => api.get('/customer-groups', { params: { tenantId } }),
  get: (id: string) => api.get(`/customer-groups/${id}`),
  create: (data: any) => api.post('/customer-groups', data),
  update: (id: string, data: any) => api.patch(`/customer-groups/${id}`, data),
  delete: (id: string) => api.delete(`/customer-groups/${id}`),
  appendMembers: (id: string, items: Array<any>) =>
    api.post(`/customer-groups/${id}/append-members`, { items }),
  removeMember: (id: string, value: string) =>
    api.delete(`/customer-groups/${id}/members/${encodeURIComponent(value)}`),
  // 候选池相关
  candidatePreview: (params: any) =>
    api.get('/customer-groups/candidate-preview', { params }),
  listHuntTasks: (tenantId: string) =>
    api.get('/customer-groups/hunt-tasks', { params: { tenantId } }),
  createFromCandidates: (data: any) =>
    api.post('/customer-groups/from-candidates', data),
  createFromCandidateIds: (data: { tenantId: string; name: string; description?: string; candidateIds: string[] }) =>
    api.post('/customer-groups/from-candidate-ids', data),
};

export const adTemplatesApi = {
  list: (tenantId?: string) => api.get('/ad-templates', { params: { tenantId } }),
  get: (id: string) => api.get(`/ad-templates/${id}`),
  create: (data: any) => api.post('/ad-templates', data),
  update: (id: string, data: any) => api.patch(`/ad-templates/${id}`, data),
  delete: (id: string) => api.delete(`/ad-templates/${id}`),
  // AI 生成变体一般要 15-30 秒，给 90 秒缓冲
  generateVariants: (id: string) => api.post(`/ad-templates/${id}/generate-variants`, {}, { timeout: 90000 }),
};

export const greetingTemplatesApi = {
  list: (tenantId?: string) => api.get('/greeting-templates', { params: { tenantId } }),
  get: (id: string) => api.get(`/greeting-templates/${id}`),
  create: (data: any) => api.post('/greeting-templates', data),
  update: (id: string, data: any) => api.patch(`/greeting-templates/${id}`, data),
  delete: (id: string) => api.delete(`/greeting-templates/${id}`),
  score: (id: string) => api.post(`/greeting-templates/${id}/score`, {}, { timeout: 30000 }),
  generateVariants: (id: string) => api.post(`/greeting-templates/${id}/generate-variants`, {}, { timeout: 90000 }),
  seedDefaults: (tenantId: string) => api.post(`/greeting-templates/seed-defaults`, {}, { params: { tenantId } }),
};

export const takeoverApi = {
  upload: (leadId: string, file: File, onProgress?: (pct: number) => void) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/takeover/leads/${leadId}/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
      onUploadProgress: onProgress
        ? (e) => {
            if (e.total) onProgress(Math.round((e.loaded / e.total) * 100));
          }
        : undefined,
    });
  },
};

export const leadsApi = {
  list: (params?: any) => api.get('/leads', { params }),
  get: (id: string) => api.get(`/leads/${id}`),
  create: (data: any) => api.post('/leads', data),
  delete: (id: string) => api.delete(`/leads/${id}`),
  assign: (id: string, csAccountId: string) =>
    api.post(`/leads/${id}/assign`, { csAccountId }),
  addNote: (id: string, note: string) =>
    api.post(`/leads/${id}/note`, { note }),
  reply: (id: string, text: string) =>
    api.post(`/leads/${id}/reply`, { text }),
  takeOver: (id: string, operator?: string) =>
    api.post(`/leads/${id}/take`, operator ? { operator } : {}),
  release: (id: string) => api.post(`/leads/${id}/release`),
  setState: (id: string, state: 'ai' | 'human' | 'closed' | 'dnr') =>
    api.post(`/leads/${id}/state`, { state }),
};

export const authApi = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  me: () => api.get('/auth/me'),
  changePassword: (oldPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { oldPassword, newPassword }),
};

export const licensesApi = {
  list: () => api.get('/licenses'),
  issue: (data: { plan?: string; notes?: string }) => api.post('/licenses/issue', data),
  activate: (key: string, tenantName?: string, machineId?: string) =>
    api.post('/licenses/activate', { key, tenantName, machineId }),
  status: () => api.get('/licenses/status'),
  revoke: (id: string) => api.post(`/licenses/${id}/revoke`),
};

export const discoveredGroupsApi = {
  list: (params?: { tenantId?: string; status?: string; minQuality?: number; keyword?: string; limit?: number }) =>
    api.get('/discovered-groups', { params }),
  stats: (tenantId?: string) =>
    api.get('/discovered-groups/stats', { params: tenantId ? { tenantId } : {} }),
  queueScrape: (id: string, accountId: string) =>
    api.post(`/discovered-groups/${id}/queue-scrape`, { accountId }),
  ignore: (id: string) => api.post(`/discovered-groups/${id}/ignore`),
  restore: (id: string) => api.post(`/discovered-groups/${id}/restore`),
  bulkIgnore: (ids: string[]) => api.post('/discovered-groups/bulk-ignore', { ids }),
  remove: (id: string) => api.delete(`/discovered-groups/${id}`),
};

export const tenantsApi = {
  list: () => api.get('/tenants'),
  get: (id: string) => api.get(`/tenants/${id}`),
  getDefault: () => api.get('/tenants/default'),
  listBots: (tenantId: string) => api.get(`/tenants/${tenantId}/bots`),
  registerBot: (tenantId: string, token: string) =>
    api.post(`/tenants/${tenantId}/bots`, { token }),
  updateBot: (tenantId: string, botId: string, data: { isActive?: boolean; botUsername?: string }) =>
    api.patch(`/tenants/${tenantId}/bots/${botId}`, data),
  deleteBot: (tenantId: string, botId: string) =>
    api.delete(`/tenants/${tenantId}/bots/${botId}`),
  startBot: (tenantId: string, botId: string) =>
    api.post(`/tenants/${tenantId}/bots/${botId}/start`),
  stopBot: (tenantId: string, botId: string) =>
    api.post(`/tenants/${tenantId}/bots/${botId}/stop`),
  webhookInfo: (tenantId: string, botId: string) =>
    api.get(`/tenants/${tenantId}/bots/${botId}/webhook-info`),
  clearWebhook: (tenantId: string, botId: string) =>
    api.post(`/tenants/${tenantId}/bots/${botId}/clear-webhook`),
  getSettings: (tenantId: string) => api.get(`/tenants/${tenantId}/settings`),
  updateSettings: (tenantId: string, data: any) =>
    api.patch(`/tenants/${tenantId}/settings`, data),
  testAi: (tenantId: string) => api.post(`/tenants/${tenantId}/settings/test-ai`, {}, { timeout: 30000 }),
  testNotifyAgent: (tenantId: string, chatId: string, name?: string) =>
    api.post(`/tenants/${tenantId}/settings/test-notify-agent`, { chatId, name }, { timeout: 15000 }),
};

export const knowledgeApi = {
  listKbs: (params?: { type?: string; enabled?: boolean }) =>
    api.get('/knowledge/kbs', { params }),
  getKb: (id: string) => api.get(`/knowledge/kbs/${id}`),
  createKb: (data: any) => api.post('/knowledge/kbs', data),
  updateKb: (id: string, data: any) => api.patch(`/knowledge/kbs/${id}`, data),
  deleteKb: (id: string) => api.delete(`/knowledge/kbs/${id}`),

  listFaqs: (params?: { kbId?: string; enabled?: boolean }) =>
    api.get('/knowledge/faqs', { params }),
  getFaq: (id: string) => api.get(`/knowledge/faqs/${id}`),
  createFaq: (data: any) => api.post('/knowledge/faqs', data),
  updateFaq: (id: string, data: any) => api.patch(`/knowledge/faqs/${id}`, data),
  deleteFaq: (id: string) => api.delete(`/knowledge/faqs/${id}`),
  bulkImport: (kbId: string, items: Array<{ question: string; answer: string; tags?: string[] }>) =>
    api.post('/knowledge/faqs/bulk-import', { kbId, items }),
  search: (query: string, kbId?: string) =>
    api.post('/knowledge/faqs/search', { query, kbId }),

  listSources: (kbId: string) => api.get(`/knowledge/kbs/${kbId}/sources`),
  uploadSource: (kbId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/knowledge/kbs/${kbId}/sources`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
  },
  deleteSource: (kbId: string, srcId: string) =>
    api.delete(`/knowledge/kbs/${kbId}/sources/${srcId}`),
  generateProductProfile: (data: { productName: string; price?: string; rawText: string }) =>
    api.post('/knowledge/ai-generate-product-profile', data, { timeout: 120000 }),
  extractUrl: (url: string) => api.post('/knowledge/extract-url', { url }, { timeout: 15000 }),

  listProtected: (kbId: string) => api.get(`/knowledge/kbs/${kbId}/protected`),
  addProtected: (kbId: string, entityType: string, value: string) =>
    api.post(`/knowledge/kbs/${kbId}/protected`, { entityType, value }),
  deleteProtected: (kbId: string, entId: string) =>
    api.delete(`/knowledge/kbs/${kbId}/protected/${entId}`),

  generateFaqs: (kbId: string, count?: number) =>
    api.post(`/knowledge/kbs/${kbId}/generate-faqs`, count ? { count } : {}, { timeout: 120000 }),
  backfillVariants: (kbId: string, force?: boolean) =>
    api.post(`/knowledge/kbs/${kbId}/backfill-variants`, { force }, { timeout: 180000 }),

  // 通用 FAQ（客户闲聊场景，挂在 company KB 下）
  listGeneralFaqs: (tenantId: string) =>
    api.get('/knowledge/general-faqs', { params: { tenantId } }),
  ensureCompanyKb: (tenantId: string) =>
    api.post('/knowledge/general-faqs/ensure-kb', { tenantId }),
  generateGeneralChatFaqs: (tenantId: string, count?: number) =>
    api.post('/knowledge/general-faqs/ai-generate', { tenantId, count }, { timeout: 120000 }),
};

export const aiApi = {
  info: () => api.get('/ai/info'),
  reply: (data: any) => api.post('/ai/reply', data),
  faq: (data: any) => api.post('/ai/faq', data),
  clearConversation: (chatId: string) => api.delete(`/ai/conversation/${chatId}`),
};

export const assetsApi = {
  list: (params?: { category?: string; enabled?: boolean; source?: string; poolName?: string }) =>
    api.get('/assets', { params }),
  pools: () => api.get('/assets/pools'),
  upload: (file: File, opts: { category?: string; description?: string; tags?: string } = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    if (opts.category) fd.append('category', opts.category);
    if (opts.description) fd.append('description', opts.description);
    if (opts.tags) fd.append('tags', opts.tags);
    return api.post('/assets/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
  },
  createSnippet: (text: string, tags?: string[], description?: string) =>
    api.post('/assets/text-snippet', { text, tags, description }),
  /** 浏览器 <img/audio/video src> 用：把 jwt token 拼到 query 里走 ?t= 通道。 */
  contentUrl: (id: string) => {
    const tok = (typeof localStorage !== 'undefined' ? localStorage.getItem('telehubx:token') : null) ?? '';
    return `/api/v1/assets/${id}/file${tok ? `?t=${encodeURIComponent(tok)}` : ''}`;
  },
  update: (id: string, data: any) => api.patch(`/assets/${id}`, data),
  delete: (id: string) => api.delete(`/assets/${id}`),
};

export const chatScriptsApi = {
  list: (params?: { type?: string; status?: string }) => api.get('/chat-scripts', { params }),
  get: (id: string) => api.get(`/chat-scripts/${id}`),
  pickRandom: (params?: { packId?: string; category?: string; type?: string }) =>
    api.get('/chat-scripts/random', { params }),
  delete: (id: string) => api.delete(`/chat-scripts/${id}`),
  listPacks: () => api.get('/chat-scripts/packs'),
  deletePack: (packId: string) => api.delete(`/chat-scripts/packs/${packId}`),
  uploadPack: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/chat-scripts/packs/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
  },
  create: (data: any) => api.post('/chat-scripts', data),
  update: (id: string, data: any) => api.patch(`/chat-scripts/${id}`, data),
};

export const testGroupsApi = {
  list: (params?: { source?: string; executionGroupId?: string }) =>
    api.get('/test-groups', { params }),
  create: (data: any) => api.post('/test-groups', data),
  update: (id: string, data: any) => api.patch(`/test-groups/${id}`, data),
  delete: (id: string) => api.delete(`/test-groups/${id}`),
};

export const tasksApi = {
  list: (params?: { status?: string; type?: string; tenantId?: string }) =>
    api.get('/tasks', { params }),
  get: (id: string) => api.get(`/tasks/${id}`),
  create: (data: any) => api.post('/tasks', data),
  update: (id: string, data: any) => api.patch(`/tasks/${id}`, data),
  pause: (id: string) => api.post(`/tasks/${id}/pause`),
  resume: (id: string) => api.post(`/tasks/${id}/resume`),
  retry: (id: string) => api.post(`/tasks/${id}/retry`),
  reactivate: (id: string) => api.post(`/tasks/${id}/reactivate`),
  cancel: (id: string) => api.post(`/tasks/${id}/cancel`),
  children: (id: string) => api.get(`/tasks/${id}/children`),
  cancelAll: () => api.post('/tasks/cancel-all'),
  runNow: (id: string) => api.post(`/tasks/${id}/run-now`),
  delete: (id: string) => api.delete(`/tasks/${id}`),
  stats: (tenantId?: string) => api.get('/tasks/stats', { params: tenantId ? { tenantId } : {} }),
};

export const executionGroupsApi = {
  list: (tenantId?: string) => api.get('/execution-groups', { params: tenantId ? { tenantId } : {} }),
  listUngrouped: (tenantId?: string) => api.get('/execution-groups/ungrouped', { params: tenantId ? { tenantId } : {} }),
  update: (id: string, data: { name?: string; notes?: string }) =>
    api.patch(`/execution-groups/${id}`, data),
  assignMembers: (id: string, accountIds: string[]) =>
    api.post(`/execution-groups/${id}/members`, { accountIds }),
  assignAccount: (accountId: string, groupId: string | null) =>
    api.post(`/execution-groups/accounts/${accountId}/assign`, { groupId }),
  reconcile: (count: number, tenantId?: string) =>
    api.post('/execution-groups/reconcile', { count }, { params: tenantId ? { tenantId } : {} }),
  autoSchedule: (tenantId?: string) =>
    api.post('/execution-groups/auto-schedule', {}, { params: tenantId ? { tenantId } : {} }),
};

export const proxiesApi = {
  list: (params?: { status?: string }) => api.get('/proxies', { params }),
  get: (id: string) => api.get(`/proxies/${id}`),
  create: (data: any) => api.post('/proxies', data),
  update: (id: string, data: any) => api.patch(`/proxies/${id}`, data),
  delete: (id: string) => api.delete(`/proxies/${id}`),
  test: (id: string) => api.post(`/proxies/${id}/test`, {}, { timeout: 30000 }),
};

export const slotsApi = {
  list: () => api.get('/slots'),
  get: (id: string) => api.get(`/slots/${id}`),
  reset: (id: string) => api.post(`/slots/${id}/reset`),
  delete: (id: string) => api.delete(`/slots/${id}`),
};

interface DashboardOverview {
  totalAccounts: number;
  onlineAccounts: number;
  avgHealthScore: number;
  activeCampaigns: number;
}

const FALLBACK_OVERVIEW: DashboardOverview = {
  totalAccounts: 0,
  onlineAccounts: 0,
  avgHealthScore: 0,
  activeCampaigns: 0,
};

async function fetchOverview(): Promise<DashboardOverview> {
  try {
    const [statsRes, runningRes] = await Promise.all([
      api.get('/accounts/health-stats'),
      api.get('/campaigns', { params: { status: 'running' } }),
    ]);
    const stats = statsRes.data ?? {};
    const running = Array.isArray(runningRes.data) ? runningRes.data.length : 0;
    return {
      totalAccounts: stats.total ?? 0,
      onlineAccounts: stats.byStatus?.online ?? 0,
      avgHealthScore: stats.avgHealthScore ?? 0,
      activeCampaigns: running,
    };
  } catch {
    return FALLBACK_OVERVIEW;
  }
}

export const leadCandidatesApi = {
  list: (params?: { tenantId: string; status?: string; huntTaskId?: string }) =>
    api.get('/lead-candidates', { params }),
  pending: (tenantId: string, limit = 50) =>
    api.get('/lead-candidates/pending', { params: { tenantId, limit } }),
  stats: (tenantId: string) =>
    api.get('/lead-candidates/stats', { params: { tenantId } }),
  huntSources: (huntTaskId: string) =>
    api.get('/lead-candidates/hunt-sources', { params: { huntTaskId } }),
  get: (id: string) => api.get(`/lead-candidates/${id}`),
  remove: (id: string) => api.delete(`/lead-candidates/${id}`),
};

export const platformConfigApi = {
  listAiProviders: () => api.get('/platform-config/ai'),
  createAiProvider: (data: any) => api.post('/platform-config/ai', data),
  updateAiProvider: (id: string, data: any) => api.patch(`/platform-config/ai/${id}`, data),
  deleteAiProvider: (id: string) => api.delete(`/platform-config/ai/${id}`),
  testAiProvider: (id: string) => api.post(`/platform-config/ai/${id}/test`, {}, { timeout: 30000 }),
  getVariantPrompt: () => api.get('/platform-config/ai/settings/variant-prompt'),
  setVariantPrompt: (value: string) => api.put('/platform-config/ai/settings/variant-prompt', { value }),
  resetVariantPrompt: () => api.post('/platform-config/ai/settings/variant-prompt/reset'),
  getGlobalPersona: () => api.get('/platform-config/ai/settings/global-persona'),
  setGlobalPersona: (value: string) => api.put('/platform-config/ai/settings/global-persona', { value }),
  resetGlobalPersona: () => api.post('/platform-config/ai/settings/global-persona/reset'),
  getAdFaq: () => api.get('/platform-config/ai/settings/ad-faq'),
  setAdFaq: (data: { groupFaq?: string; privateDivert?: string }) =>
    api.put('/platform-config/ai/settings/ad-faq', data),
  resetAdFaq: () => api.post('/platform-config/ai/settings/ad-faq/reset'),
  getIndustryPrompts: () => api.get('/platform-config/ai/settings/industry-prompts'),
  setIndustryPrompts: (prompts: Record<string, string>) =>
    api.put('/platform-config/ai/settings/industry-prompts', { prompts }),
  resetIndustryPrompts: () => api.post('/platform-config/ai/settings/industry-prompts/reset'),
  getHandoffNotice: () => api.get('/platform-config/ai/settings/handoff-notice'),
  setHandoffNotice: (value: string) => api.put('/platform-config/ai/settings/handoff-notice', { value }),
  resetHandoffNotice: () => api.post('/platform-config/ai/settings/handoff-notice/reset'),
};

export const statsApi = {
  get: () => api.get('/accounts/health-stats').catch(() => ({
    data: FALLBACK_OVERVIEW,
  })),
  overview: fetchOverview,
};

export default api;
