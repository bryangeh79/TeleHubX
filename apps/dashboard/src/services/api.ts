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

export const tenantsApi = {
  list: () => api.get('/tenants'),
  get: (id: string) => api.get(`/tenants/${id}`),
  getDefault: () => api.get('/tenants/default'),
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
};

export const aiApi = {
  info: () => api.get('/ai/info'),
  reply: (data: any) => api.post('/ai/reply', data),
  faq: (data: any) => api.post('/ai/faq', data),
  clearConversation: (chatId: string) => api.delete(`/ai/conversation/${chatId}`),
};

export const proxiesApi = {
  list: (params?: { status?: string }) => api.get('/proxies', { params }),
  get: (id: string) => api.get(`/proxies/${id}`),
  create: (data: any) => api.post('/proxies', data),
  update: (id: string, data: any) => api.patch(`/proxies/${id}`, data),
  delete: (id: string) => api.delete(`/proxies/${id}`),
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

export const statsApi = {
  get: () => api.get('/accounts/health-stats').catch(() => ({
    data: FALLBACK_OVERVIEW,
  })),
  overview: fetchOverview,
};

export default api;
