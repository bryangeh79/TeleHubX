import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const message = error.response?.data?.error || error.message || 'Unknown error';
    console.error('[API Error]', message);
    return Promise.reject(error);
  },
);

export default api;

// Account API
export const accountsApi = {
  list: (params?: any) => api.get('/accounts', { params }),
  getById: (id: string) => api.get(`/accounts/${id}`),
  create: (data: any) => api.post('/accounts', data),
  update: (id: string, data: any) => api.patch(`/accounts/${id}`, data),
  delete: (id: string) => api.delete(`/accounts/${id}`),
  bind: (id: string, session: string) => api.post(`/accounts/${id}/session`, { session }),
};

// Health API
export const healthApi = {
  check: () => api.get('/health'),
};
