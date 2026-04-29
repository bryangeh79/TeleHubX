import axios from 'axios';

const BASE = '/api/v1';

const api = axios.create({
  baseURL: BASE,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
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
};

export const warmupApi = {
  start:   (id: string) => api.post(`/accounts/${id}/warmup/start`),
  advance: (id: string) => api.post(`/accounts/${id}/warmup/advance`),
  status:  (id: string) => api.get(`/accounts/${id}/warmup`),
  pause:   (id: string) => api.post(`/accounts/${id}/warmup/pause`),
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
  assign: (id: string, csAccountId: string) =>
    api.post(`/leads/${id}/assign`, { csAccountId }),
  addNote: (id: string, note: string) =>
    api.post(`/leads/${id}/note`, { note }),
  reply: (id: string, text: string) =>
    api.post(`/leads/${id}/reply`, { text }),
};

export const aiApi = {
  reply: (data: any) => api.post('/ai/reply', data),
  faq: (data: any) => api.post('/ai/faq', data),
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
