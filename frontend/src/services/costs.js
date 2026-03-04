import api from './api';

export const costsService = {
  getCosts: async (skip = 0, limit = 2000, filters = {}) => {
    const params = { skip, limit };
    if (filters.service)    params.service    = filters.service;
    if (filters.project)    params.project    = filters.project;
    if (filters.start_date) params.start_date = filters.start_date;
    if (filters.end_date)   params.end_date   = filters.end_date;
    const res = await api.get('/costs/', { params, timeout: 30000 });
    return Array.isArray(res.data) ? res.data : [];
  },
  getTotalCost:        async (s, e) => (await api.get('/costs/stats/total', { params: { start_date: s, end_date: e } })).data,
  getSummaryByService: async ()     => (await api.get('/costs/summary/service')).data,
  getSummaryByProject: async ()     => (await api.get('/costs/summary/project')).data,
  createCost:          async (d)    => (await api.post('/costs/', d)).data,
  updateCost:          async (id,d) => (await api.put(`/costs/${id}`, d)).data,
  deleteCost:          async (id)   => await api.delete(`/costs/${id}`),
};