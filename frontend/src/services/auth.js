import api from './api';

export const authService = {
  register: async (email, fullName, password) => {
    const res = await api.post('/auth/register', { email, full_name: fullName, password });
    return res.data;
  },
  login: async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    return res.data;
  },
};