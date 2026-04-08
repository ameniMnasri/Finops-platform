import api from './api';

export const resourcesService = {
  /**
   * Import OVH server metrics (CPU, RAM, Disk) into the database.
   * @param {object} credentials - { app_key, app_secret, consumer_key }
   */
  importOVHMetrics: async (credentials) => {
    const res = await api.post('/resources/import-ovh-metrics', credentials, { timeout: 120000 });
    return res.data;
  },

  /**
   * List stored resource metrics (optionally filtered).
   */
  listMetrics: async (params = {}) => {
    const res = await api.get('/resources/metrics', { params, timeout: 30000 });
    return res.data;
  },

  /**
   * Get the latest metric record for each server.
   */
  getLatestMetrics: async () => {
    const res = await api.get('/resources/metrics/latest', { timeout: 30000 });
    return res.data;
  },

  /**
   * Get historical metrics for a specific server.
   * @param {string} serverName
   * @param {number} days
   */
  getServerHistory: async (serverName, days = 7) => {
    const res = await api.get(`/resources/metrics/history/${encodeURIComponent(serverName)}`, {
      params: { days },
      timeout: 30000,
    });
    return res.data;
  },
};
