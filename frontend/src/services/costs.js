const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000/api/v1';

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const costsService = {
  getCosts: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/costs${qs ? `?${qs}` : ''}`);
  },
  getAnalytics: () => apiFetch('/costs/analytics'),
};
