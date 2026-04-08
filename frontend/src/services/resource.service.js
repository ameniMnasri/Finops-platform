import api from './api';

// ─── API service ────────────────────────────────────────────────────────────

export const resourcesService = {
  /**
   * GET /resources/servers/summary/all
   * Returns avg+peak for every server in one request.
   */
  getAllServersSummary: async (startDate, endDate) => {
    const params = {};
    if (startDate) params.start_date = startDate;
    if (endDate)   params.end_date   = endDate;
    const res = await api.get('/resources/servers/summary/all', { params });
    return Array.isArray(res.data) ? res.data : [];
  },

  /**
   * GET /resources/servers/{server_name}/metrics
   * Returns time-series snapshots for one server (last N days).
   */
  getServerTimeSeries: async (serverName, days = 7) => {
    const endDate   = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const fmt = d => d.toISOString().split('T')[0];
    const res = await api.get(
      `/resources/servers/${encodeURIComponent(serverName)}/metrics`,
      { params: { start_date: fmt(startDate), end_date: fmt(endDate), limit: 500 } },
    );
    return Array.isArray(res.data?.items) ? res.data.items : [];
  },

  /**
   * GET /resources/stats/average
   * Fleet-wide average stats (optional, non-critical).
   */
  getAverageStats: async () => {
    const res = await api.get('/resources/stats/average');
    return res.data;
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function detectServerCategory(name) {
  if (!name) return 'VPS';
  const n = name.toUpperCase();
  if (
    n.includes('DEDICATED') || n.includes('DATABASE') ||
    n.includes('EG-')       || n.includes('ADVANCE')  ||
    n.includes('RISE')      || n.includes('BIG-')      ||
    n.includes('SP-')       || n.includes('HG-')       ||
    n.includes('SCALE-')    || n.includes('HGR-')      ||
    n.includes('KS-')       || n.includes('SYS-')      ||
    n.includes('HOST-')     || n.includes('DEDIBOX')   ||
    n.includes('PROD-DEDICATED') || n.includes('SERVER')
  ) return 'Dedicated';
  return 'VPS';
}

export function calculateStatus(avgCpu, peakCpu) {
  if (avgCpu < 10 && peakCpu < 20) return 'underutilized';
  if (avgCpu > 75 || peakCpu > 90) return 'critical';
  return 'optimized';
}

/**
 * Merge costs data with resource summaries into a unified server list.
 * @param {Array} costsData  - raw cost records from costsService.getCosts()
 * @param {Array} summaries  - server summaries from resourcesService.getAllServersSummary()
 * @returns {Array} enriched server objects
 */
export function buildServerList(costsData, summaries) {
  const metricMap = {};
  (summaries || []).forEach(s => {
    metricMap[(s.server_name || '').trim().toLowerCase()] = s;
  });

  const costMap = {};
  (costsData || []).forEach(c => {
    if (!c.service_name || Number(c.amount || 0) <= 0) return;
    const key = c.service_name.trim();
    if (!costMap[key] || Number(c.amount) > Number(costMap[key].amount)) {
      costMap[key] = c;
    }
  });

  const allNames = new Set([
    ...Object.keys(costMap),
    ...(summaries || []).map(s => (s.server_name || '').trim()),
  ]);

  const servers = [];
  allNames.forEach(name => {
    if (!name) return;
    const cost   = costMap[name];
    const metric = metricMap[name.toLowerCase()];

    const avgCpu   = metric?.avg_cpu   ?? 0;
    const peakCpu  = metric?.peak_cpu  ?? 0;
    const avgRam   = metric?.avg_ram   ?? 0;
    const peakRam  = metric?.peak_ram  ?? 0;
    const avgDisk  = metric?.avg_disk  ?? 0;
    const peakDisk = metric?.peak_disk ?? 0;

    servers.push({
      id:          cost?.id || `srv-${name.replace(/\s+/g, '-')}`,
      name,
      type:        detectServerCategory(name),
      monthlyCost: Number(cost?.amount || 0),
      reference:   cost?.reference || cost?.resource_id || cost?.external_id || '—',
      specs:       cost?.specs || '—',
      avgCpu, peakCpu, avgRam, peakRam, avgDisk, peakDisk,
      records:     metric?.total_records ?? 0,
      hasRealData: !!metric && (metric.total_records ?? 0) > 0,
      status:      calculateStatus(avgCpu, peakCpu),
    });
  });

  return servers;
}

/**
 * Compute fleet-wide summary stats from a server list.
 * @param {Array} servers
 * @returns {Object} summary object
 */
export function generateSummary(servers) {
  const real = servers.filter(s => s.hasRealData);
  return {
    total:         servers.length,
    optimized:     servers.filter(s => s.status === 'optimized').length,
    underutilized: servers.filter(s => s.status === 'underutilized').length,
    critical:      servers.filter(s => s.status === 'critical').length,
    avgCpu:   real.length > 0 ? real.reduce((s, x) => s + x.avgCpu,  0) / real.length : 0,
    avgRam:   real.length > 0 ? real.reduce((s, x) => s + x.avgRam,  0) / real.length : 0,
    avgDisk:  real.length > 0 ? real.reduce((s, x) => s + x.avgDisk, 0) / real.length : 0,
    totalCost: servers.reduce((s, x) => s + x.monthlyCost, 0),
  };
}
