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
  start: (id: string) => api.post(`/accounts/warmup/start`, { accountId: id }),
  status: (id: string) => api.get(`/accounts/warmup/${id}`),
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
  assign: (id: string, csAccountId: string) =>
    api.post(`/leads/${id}/assign`, { csAccountId }),
  addNote: (id: string, note: string) =>
    api.post(`/leads/${id}/note`, { note }),
};

export const aiApi = {
  reply: (data: any) => api.post('/ai/reply', data),
  faq: (data: any) => api.post('/ai/faq', data),
};

export const statsApi = {
  get: () => api.get('/accounts/health-stats').catch(() => ({
    data: { total: 0, online: 0, avgHealth: 0, activeCampaigns: 0 },
  })),
};

export default api;
