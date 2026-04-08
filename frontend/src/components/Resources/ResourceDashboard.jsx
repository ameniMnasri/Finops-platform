// ResourceDashboard.jsx — Real API data (no Math.random)
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Server, Search, RefreshCw, BarChart2, Zap, Activity, TrendingUp,
  ChevronUp, ChevronDown, Cpu, HardDrive, MemoryStick,
  AlertTriangle, AlertCircle, CheckCircle,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import Header  from '../Layout/Header';
import Sidebar from '../Layout/Sidebar';
import { costsService } from '../../services/costs';
import api from '../../services/api';

const fmt2 = v =>
  Number(v || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// ─── Category detection ────────────────────────────────────────────────────
function detectServerCategory(name) {
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

function calculateStatus(avgCpu, peakCpu) {
  if (avgCpu < 10 && peakCpu < 20) return 'underutilized';
  if (avgCpu > 75 || peakCpu > 90) return 'critical';
  return 'optimized';
}

// ─── Real API service ──────────────────────────────────────────────────────
const resourcesService = {
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
};

// ─── Merge costs + real summaries into server list ─────────────────────────
function buildServerList(costsData, summaries) {
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
      id:           cost?.id || `srv-${name.replace(/\s+/g, '-')}`,
      name,
      type:         detectServerCategory(name),
      monthlyCost:  Number(cost?.amount || 0),
      reference:    cost?.reference || cost?.resource_id || cost?.external_id || '—',
      specs:        cost?.specs || '—',
      avgCpu, peakCpu, avgRam, peakRam, avgDisk, peakDisk,
      records:      metric?.total_records ?? 0,
      hasRealData:  !!metric && (metric.total_records ?? 0) > 0,
      status:       calculateStatus(avgCpu, peakCpu),
    });
  });

  return servers;
}

function generateSummary(servers) {
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

// ─── SummaryCard ───────────────────────────────────────────────────────────
function SummaryCard({ label, value, sub, color, bg, icon: Icon, trend }) {
  return (
    <div
      style={{ flex: '1 1 160px', background: bg, border: `1px solid ${color}33`, borderRadius: 16, padding: '20px 22px', display: 'flex', alignItems: 'flex-start', gap: 14, boxShadow: `0 2px 8px ${color}10`, transition: 'transform .15s, box-shadow .15s' }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 24px ${color}25`; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)';    e.currentTarget.style.boxShadow = `0 2px 8px ${color}10`; }}
    >
      <div style={{ width: 44, height: 44, borderRadius: 12, background: color, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 12px ${color}55` }}>
        <Icon size={20} color="white" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>{label}</p>
        <p style={{ fontSize: 24, fontWeight: 900, color: '#0f172a', lineHeight: 1, letterSpacing: '-0.5px', marginBottom: 4 }}>{value}</p>
        {sub && <p style={{ fontSize: 11, color: '#64748b' }}>{sub}</p>}
        {trend !== undefined && (
          <p style={{ fontSize: 11, color: trend > 0 ? '#dc2626' : '#16a34a', fontWeight: 600, marginTop: 4 }}>
            {trend > 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
          </p>
        )}
      </div>
    </div>
  );
}

// ─── CpuBar ────────────────────────────────────────────────────────────────
function CpuBar({ value, peak }) {
  const color = value < 10 ? '#f59e0b' : value > 85 ? '#dc2626' : '#16a34a';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 120 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ fontWeight: 700, color }}>{value.toFixed(1)}%</span>
        <span style={{ color: '#94a3b8', fontSize: 11 }}>peak {peak.toFixed(1)}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: '#f1f5f9', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 99, width: `${Math.min(value, 100)}%`, background: color, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}

// ─── NoDataBadge ───────────────────────────────────────────────────────────
function NoDataBadge() {
  return (
    <span
      title="Aucune donnée dans la base. Vérifiez l'ingestion OVH."
      style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: '#f1f5f9', color: '#94a3b8', border: '1px dashed #cbd5e1' }}
    >
      Pas de données
    </span>
  );
}

// ─── ServerTable ───────────────────────────────────────────────────────────
function ServerTable({ servers = [], loading, onServerSelect }) {
  const [sortKey, setSortKey] = useState('monthlyCost');
  const [sortDir, setSortDir] = useState('desc');

  const handleSort = key => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sorted = [...servers].sort((a, b) => {
    const v = sortDir === 'asc' ? 1 : -1;
    return (a[sortKey] > b[sortKey] ? 1 : -1) * v;
  });

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <ChevronUp size={12} style={{ opacity: 0.3 }} />;
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  };

  const STATUS_MAP = {
    optimized:     { label: 'Optimisé',     color: '#16a34a', bg: '#dcfce7', border: '#86efac' },
    underutilized: { label: 'Sous-utilisé', color: '#d97706', bg: '#fef3c7', border: '#fcd34d' },
    critical:      { label: 'Critique',     color: '#dc2626', bg: '#fee2e2', border: '#fca5a5' },
  };

  const RECOMMENDATION_MAP = {
    optimized:     { icon: '✅', text: 'Usage équilibré' },
    underutilized: { icon: '💡', text: 'Envisager un downsize' },
    critical:      { icon: '⚠️', text: 'Envisager un upsize' },
  };

  const thStyle = col => ({
    padding: '14px 20px', textAlign: 'left', fontSize: 11, fontWeight: 800,
    color: sortKey === col ? '#1B5E46' : '#94a3b8',
    textTransform: 'uppercase', letterSpacing: '.08em',
    cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
  });

  return (
    <div style={{ overflowX: 'auto', background: 'white' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '2px solid #f1f5f9' }}>
            <th style={thStyle('name')}      onClick={() => handleSort('name')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Server size={13} /> Serveur <SortIcon col="name" /></div>
            </th>
            <th style={{ ...thStyle('type'),      cursor: 'default' }}>Type</th>
            <th style={{ ...thStyle('reference'), cursor: 'default' }}>Référence</th>
            <th style={thStyle('avgCpu')}    onClick={() => handleSort('avgCpu')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Cpu size={13} /> CPU moy. <SortIcon col="avgCpu" /></div>
            </th>
            <th style={thStyle('avgRam')}    onClick={() => handleSort('avgRam')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><MemoryStick size={13} /> RAM moy. <SortIcon col="avgRam" /></div>
            </th>
            <th style={thStyle('avgDisk')}   onClick={() => handleSort('avgDisk')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><HardDrive size={13} /> Disque moy. <SortIcon col="avgDisk" /></div>
            </th>
            <th style={thStyle('monthlyCost')} onClick={() => handleSort('monthlyCost')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>💰 Coût/mois <SortIcon col="monthlyCost" /></div>
            </th>
            <th style={{ ...thStyle('status'), cursor: 'default' }}>Statut</th>
            <th style={{ ...thStyle('status'), cursor: 'default', minWidth: 220 }}>Recommandation</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={9} style={{ padding: 60, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
                <div style={{ display: 'inline-block', width: 24, height: 24, border: '3px solid #e2e8f0', borderTopColor: '#1B5E46', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <p style={{ marginTop: 12 }}>Chargement des serveurs...</p>
              </td>
            </tr>
          )}
          {!loading && sorted.length === 0 && (
            <tr>
              <td colSpan={9} style={{ padding: 60, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
                <Server size={48} style={{ opacity: 0.2, margin: '0 auto 16px', display: 'block' }} />
                Aucun serveur trouvé
              </td>
            </tr>
          )}
          {!loading && sorted.map((s, i) => {
            const statusCfg = STATUS_MAP[s.status] || STATUS_MAP.optimized;
            const rec       = RECOMMENDATION_MAP[s.status] || RECOMMENDATION_MAP.optimized;
            return (
              <tr
                key={s.id}
                onClick={() => onServerSelect?.(s)}
                style={{ borderTop: '1px solid #f8fafc', background: i % 2 === 0 ? '#fff' : '#fafafa', transition: 'background .1s', cursor: onServerSelect ? 'pointer' : 'default' }}
                onMouseEnter={e => onServerSelect && (e.currentTarget.style.background = '#eff6ff')}
                onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafafa')}
              >
                {/* SERVER NAME */}
                <td style={{ padding: '18px 20px' }}>
                  <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 14, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.name}>{s.name}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                    {s.records > 0 ? `${s.records} enregistrement${s.records !== 1 ? 's' : ''}` : 'Aucune donnée'}
                  </div>
                </td>

                {/* TYPE */}
                <td style={{ padding: '18px 20px' }}>
                  <span style={{ padding: '4px 12px', borderRadius: 9999, fontSize: 11, fontWeight: 700, background: s.type === 'VPS' ? '#F3E8FF' : '#EFF6FF', color: s.type === 'VPS' ? '#7C3AED' : '#2563EB' }}>
                    {s.type === 'VPS' ? '🖥️ VPS' : '🗄️ Dédié'}
                  </span>
                </td>

                {/* REFERENCE */}
                <td style={{ padding: '18px 20px' }}>
                  {s.reference && s.reference !== '—' ? (
                    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, fontFamily: 'monospace', background: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.reference}>
                      {s.reference}
                    </span>
                  ) : <span style={{ fontSize: 12, color: '#cbd5e1' }}>—</span>}
                </td>

                {/* CPU */}
                <td style={{ padding: '18px 20px' }}>
                  {s.hasRealData ? <CpuBar value={s.avgCpu} peak={s.peakCpu} /> : <NoDataBadge />}
                </td>

                {/* RAM */}
                <td style={{ padding: '18px 20px', fontWeight: 700, color: '#0f172a' }}>
                  {s.hasRealData ? (
                    <>
                      {s.avgRam.toFixed(1)} <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>GB</span>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>peak {s.peakRam.toFixed(1)} GB</div>
                    </>
                  ) : <NoDataBadge />}
                </td>

                {/* DISK */}
                <td style={{ padding: '18px 20px', fontWeight: 700, color: '#0f172a' }}>
                  {s.hasRealData ? (
                    <>
                      {s.avgDisk.toFixed(1)} <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>GB</span>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>peak {s.peakDisk.toFixed(1)} GB</div>
                    </>
                  ) : <NoDataBadge />}
                </td>

                {/* COST */}
                <td style={{ padding: '18px 20px' }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: '#1B5E46' }}>{fmt2(s.monthlyCost)} €</span>
                </td>

                {/* STATUS */}
                <td style={{ padding: '18px 20px' }}>
                  {s.hasRealData ? (
                    <span style={{ display: 'inline-block', padding: '5px 14px', borderRadius: 9999, fontSize: 11, fontWeight: 700, color: statusCfg.color, background: statusCfg.bg, border: `1px solid ${statusCfg.border}` }}>
                      {statusCfg.label}
                    </span>
                  ) : (
                    <span style={{ display: 'inline-block', padding: '5px 14px', borderRadius: 9999, fontSize: 11, fontWeight: 700, color: '#94a3b8', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                      Inconnu
                    </span>
                  )}
                </td>

                {/* RECOMMENDATION */}
                <td style={{ padding: '18px 20px', fontSize: 13, color: '#374151' }}>
                  {s.hasRealData ? `${rec.icon} ${rec.text}` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── ResourceChart ─────────────────────────────────────────────────────────
function ResourceChart({ data = [], metricKey, label, unit, color }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ background: '#fff', borderRadius: 20, border: '1px solid #e2e8f0', padding: '24px 28px', height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 32 }}>📉</span>
        <span>Aucune donnée disponible</span>
        <span style={{ fontSize: 11 }}>Vérifiez l'ingestion OVH dans votre backend</span>
      </div>
    );
  }

  const maxValue = Math.max(...data.map(d => d[metricKey] || 0));
  const avgValue = data.reduce((s, d) => s + (d[metricKey] || 0), 0) / data.length;

  const CustomTooltip = ({ active, payload, label: lbl }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: '10px 16px', fontSize: 12, color: '#f8fafc' }}>
        <p style={{ color: '#94a3b8', marginBottom: 6, fontSize: 11 }}>{new Date(lbl).toLocaleString('fr-FR')}</p>
        {payload.map((p, idx) => <p key={idx} style={{ color: p.color, fontWeight: 700 }}>{p.name}: {p.value.toFixed(1)}{unit}</p>)}
      </div>
    );
  };

  return (
    <div style={{ background: '#fff', borderRadius: 20, border: '1px solid #e2e8f0', padding: '24px 28px', boxShadow: '0 4px 20px rgba(0,0,0,.05)' }}>
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', marginBottom: 2 }}>{label}</h3>
        <p style={{ fontSize: 12, color: '#94a3b8' }}>
          Max: <span style={{ fontWeight: 700, color }}>{maxValue.toFixed(1)}{unit}</span>
          {' • '}
          Avg: <span style={{ fontWeight: 700, color }}>{avgValue.toFixed(1)}{unit}</span>
        </p>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="timestamp" tickFormatter={v => new Date(v).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}${unit}`} />
          <Tooltip content={<CustomTooltip />} />
          <Line type="monotone" dataKey={metricKey} stroke={color} strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 0, fill: color }} name={label} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── InsightCard ───────────────────────────────────────────────────────────
function InsightCard({ type, title, description, action }) {
  const config = {
    warning:  { bg: '#fffbeb', border: '#fcd34d', icon: AlertTriangle, color: '#f59e0b' },
    critical: { bg: '#fff5f5', border: '#fca5a5', icon: AlertCircle,   color: '#dc2626' },
    success:  { bg: '#f0fdf4', border: '#86efac', icon: CheckCircle,   color: '#16a34a' },
  };
  const cfg = config[type] || config.success;
  const Icon = cfg.icon;
  return (
    <div style={{ background: cfg.bg, border: `1.5px solid ${cfg.border}`, borderRadius: 12, padding: '16px 18px', display: 'flex', gap: 12, marginBottom: 12 }}>
      <Icon size={20} color={cfg.color} style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13, fontWeight: 800, color: cfg.color, marginBottom: 4 }}>{title}</p>
        <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5, marginBottom: 8 }}>{description}</p>
        {action && <button style={{ fontSize: 11, fontWeight: 700, color: cfg.color, background: 'white', border: `1px solid ${cfg.border}`, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>{action}</button>}
      </div>
    </div>
  );
}

// ─── Insights ──────────────────────────────────────────────────────────────
function Insights({ servers = [] }) {
  const realServers = servers.filter(s => s.hasRealData);

  if (servers.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8', background: '#fff', borderRadius: 20, border: '1px solid #e2e8f0' }}>
        <Zap size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
        <p>Aucune donnée pour générer des insights</p>
      </div>
    );
  }

  if (realServers.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8', background: '#fff', borderRadius: 20, border: '1px solid #e2e8f0' }}>
        <AlertTriangle size={32} style={{ marginBottom: 12, opacity: 0.4, color: '#f59e0b' }} />
        <p style={{ fontWeight: 700, color: '#374151', marginBottom: 8 }}>Aucune métrique réelle disponible</p>
        <p style={{ fontSize: 13 }}>
          Les serveurs sont listés depuis les coûts, mais aucune donnée CPU/RAM/Disk n'a été ingérée.<br />
          Vérifiez votre job d'ingestion OVH (<code>POST /resources/</code>).
        </p>
      </div>
    );
  }

  const underCount = realServers.filter(s => s.status === 'underutilized').length;
  const critCount  = realServers.filter(s => s.status === 'critical').length;
  const optimCount = realServers.filter(s => s.status === 'optimized').length;
  const estimatedSavings = underCount * 40;

  const insights = [];
  realServers.forEach(s => {
    if (s.avgCpu < 10)
      insights.push({ type: 'warning',  title: `${s.name} est fortement sous-utilisé`,    description: `CPU moyen à ${s.avgCpu.toFixed(1)}% — downsize recommandé pour réduire les coûts.`,        action: 'Envisager un downsize' });
    else if (s.peakCpu > 85)
      insights.push({ type: 'critical', title: `${s.name} atteint des pics critiques`,     description: `Peak CPU à ${s.peakCpu.toFixed(1)}% — risque de dégradation des performances.`,            action: 'Envisager un upsize'   });
    else
      insights.push({ type: 'success',  title: `${s.name} — usage équilibré`,              description: `CPU moyen à ${s.avgCpu.toFixed(1)}% (peak ${s.peakCpu.toFixed(1)}%) — configuration optimale.` });
  });

  insights.sort((a, b) => ({ critical: 0, warning: 1, success: 2 }[a.type] - { critical: 0, warning: 1, success: 2 }[b.type]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', borderRadius: 20, padding: '24px 28px', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Zap size={20} color="#fbbf24" />
            <span style={{ fontSize: 16, fontWeight: 800, color: '#f8fafc' }}>FinOps Intelligence</span>
          </div>
          <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>
            Analyse de {realServers.length} serveur{realServers.length !== 1 ? 's' : ''} avec données réelles —{' '}
            {optimCount} optimisé{optimCount !== 1 ? 's' : ''},{' '}
            {underCount} sous-utilisé{underCount !== 1 ? 's' : ''},{' '}
            {critCount} critique{critCount !== 1 ? 's' : ''}.
          </p>
        </div>
        {underCount > 0 && (
          <div style={{ background: '#1B5E4622', border: '1px solid #1B5E4655', borderRadius: 14, padding: '16px 20px', textAlign: 'center' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#4ade80', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>Économies potentielles</p>
            <p style={{ fontSize: 26, fontWeight: 900, color: '#4ade80', letterSpacing: '-1px' }}>~{estimatedSavings} €</p>
            <p style={{ fontSize: 11, color: '#86efac' }}>/ mois estimé</p>
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
        {insights.map((ins, i) => <InsightCard key={i} {...ins} />)}
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────
export default function ResourceDashboard() {
  const [activeTab,      setActiveTab]      = useState('servers');
  const [servers,        setServers]        = useState([]);
  const [selectedServer, setSelectedServer] = useState(null);
  const [search,         setSearch]         = useState('');
  const [typeFilter,     setTypeFilter]     = useState('all');
  const [statusFilter,   setStatusFilter]   = useState('all');
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState(null);
  const [chartsLoading,  setChartsLoading]  = useState(false);
  const [timeSeriesData, setTimeSeriesData] = useState([]);
  const cacheRef = useRef({});

  // ── Load server list ─────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      cacheRef.current = {}; // clear time-series cache on refresh

      const [costsResult, summariesResult] = await Promise.allSettled([
        costsService.getCosts(0, 5000),
        resourcesService.getAllServersSummary(),
      ]);

      const costs     = costsResult.status     === 'fulfilled' ? (costsResult.value     ?? []) : [];
      const summaries = summariesResult.status === 'fulfilled' ? (summariesResult.value ?? []) : [];

      if (summariesResult.status === 'rejected') {
        console.warn('Resource summaries endpoint unavailable:', summariesResult.reason);
      }

      const serverList = buildServerList(costs, summaries);
      setServers(serverList);
      if (serverList.length > 0 && !selectedServer) {
        setSelectedServer(serverList[0]);
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
      setError('Impossible de charger les données. Vérifiez votre connexion API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Load time-series when server/tab changes ─────────────────────────────
  useEffect(() => {
    if (!selectedServer || activeTab !== 'charts') return;

    const load = async () => {
      const key = selectedServer.name;
      if (cacheRef.current[key]) {
        setTimeSeriesData(cacheRef.current[key]);
        return;
      }
      try {
        setChartsLoading(true);
        const raw = await resourcesService.getServerTimeSeries(selectedServer.name, 7);
        const data = (raw || [])
          .map(d => ({
            timestamp:  d.recorded_at || d.timestamp,
            cpu_usage:  parseFloat(d.cpu_usage  || 0),
            ram_usage:  parseFloat(d.ram_usage  || 0),
            disk_usage: parseFloat(d.disk_usage || 0),
          }))
          .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        cacheRef.current[key] = data;
        setTimeSeriesData(data);
      } catch (err) {
        console.error('Time series error:', err);
        setTimeSeriesData([]);
      } finally {
        setChartsLoading(false);
      }
    };

    load();
  }, [selectedServer?.name, activeTab]);

  // ── Filtering ────────────────────────────────────────────────────────────
  const filteredServers = servers.filter(s => {
    const q = search.toLowerCase();
    return (
      (s.name.toLowerCase().includes(q) || (s.reference || '').toLowerCase().includes(q)) &&
      (typeFilter   === 'all' || s.type   === typeFilter) &&
      (statusFilter === 'all' || s.status === statusFilter)
    );
  });

  const summary = generateSummary(filteredServers);

  const tabs = [
    { id: 'servers',  label: 'Serveurs',       icon: Server,    desc: 'Liste complète'  },
    { id: 'charts',   label: 'Métriques',       icon: BarChart2, desc: 'Time-series'     },
    { id: 'insights', label: 'Insights FinOps', icon: Zap,       desc: 'Recommandations' },
  ];

  const handleServerSelect = server => {
    setSelectedServer(server);
    setActiveTab('charts');
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F8FAFC' }}>
      <Sidebar />

      <div style={{ flex: 1, marginLeft: '260px', padding: '28px 32px' }}>
        <Header />

        {/* Page header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
            <div>
              <h1 style={{ fontSize: 32, fontWeight: 900, color: '#0F172A', letterSpacing: '-1px', marginBottom: 6 }}>📊 Resource Dashboard</h1>
              <p style={{ color: '#64748B', fontSize: 15 }}>FinOps – Server Optimization • VPS &amp; Dedicated • Cost control &amp; rightsizing</p>
            </div>
            <button disabled={loading} onClick={loadData}
              style={{ padding: '12px 24px', background: loading ? '#f1f5f9' : '#1B5E46', color: loading ? '#94a3b8' : 'white', border: 'none', borderRadius: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 14 }}>
              <RefreshCw size={16} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              {loading ? 'Chargement...' : 'Rafraîchir'}
            </button>
          </div>

          {/* Error banner */}
          {error && (
            <div style={{ background: '#fff5f5', border: '1.5px solid #fca5a5', borderRadius: 12, padding: '14px 18px', color: '#dc2626', fontSize: 13, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={18} /> {error}
            </div>
          )}

          {/* Summary cards */}
          {filteredServers.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 8 }}>
              <SummaryCard label="Coût Total" value={`${fmt2(summary.totalCost)} €`} sub={`${filteredServers.length} serveur${filteredServers.length !== 1 ? 's' : ''}`} color="#1B5E46" bg="#f0fdf4" icon={TrendingUp} />
              <SummaryCard label="CPU Moyen"  value={summary.avgCpu.toFixed(1)}       sub="%"  color="#2563eb" bg="#eff6ff" icon={Zap}      />
              <SummaryCard label="RAM Moyen"  value={summary.avgRam.toFixed(1)}       sub="GB" color="#8b5cf6" bg="#f5f3ff" icon={Activity} />
              <SummaryCard label="Optimisés"  value={summary.optimized} sub={`/${summary.total}`} color="#16a34a" bg="#f0fdf4" icon={Server}
                trend={summary.total > 0 ? (summary.optimized / summary.total) * 100 : 0}
              />
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '2px solid #E2E8F0', overflowX: 'auto', paddingBottom: 4 }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{ padding: '14px 24px', borderRadius: '12px 12px 0 0', fontWeight: 700, fontSize: 14, background: activeTab === tab.id ? '#FFFFFF' : 'transparent', border: activeTab === tab.id ? '2px solid #1B5E46' : '2px solid transparent', color: activeTab === tab.id ? '#1B5E46' : '#64748B', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s', whiteSpace: 'nowrap' }}>
              <tab.icon size={18} /> {tab.label}
            </button>
          ))}
        </div>

        {/* SERVERS TAB */}
        {activeTab === 'servers' && (
          <div style={{ background: '#FFFFFF', borderRadius: 20, border: '1px solid #E2E8F0', boxShadow: '0 10px 30px rgba(0,0,0,0.06)', overflow: 'hidden', animation: 'fadeIn .3s ease' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              {/* Search */}
              <div style={{ position: 'relative', flex: 1, maxWidth: 420, minWidth: 200 }}>
                <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                <input type="text" placeholder="Rechercher un serveur ou une référence..." value={search} onChange={e => setSearch(e.target.value)}
                  style={{ width: '100%', padding: '12px 14px 12px 48px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 14, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', transition: 'border-color .15s' }}
                  onFocus={e => (e.target.style.borderColor = '#1B5E46')}
                  onBlur={e  => (e.target.style.borderColor = '#E2E8F0')}
                />
              </div>

              {/* Type filter */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['all', 'VPS', 'Dedicated'].map(t => (
                  <button key={t} onClick={() => setTypeFilter(t)}
                    style={{ padding: '10px 18px', borderRadius: 9999, fontWeight: 700, fontSize: 13, background: typeFilter === t ? (t === 'VPS' ? '#F3E8FF' : '#EFF6FF') : '#F8FAFC', color: typeFilter === t ? (t === 'VPS' ? '#7C3AED' : '#2563EB') : '#64748B', border: typeFilter === t ? `2px solid ${t === 'VPS' ? '#c4b5fd' : '#93c5fd'}` : '1px solid #E2E8F0', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {t === 'all' ? 'Tous' : t === 'VPS' ? '🖥️ VPS' : '🗄️ Dédiés'}
                  </button>
                ))}
              </div>

              {/* Status filter */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['all', 'optimized', 'underutilized', 'critical'].map(s => {
                  const lbl = s === 'all' ? 'Tous' : s === 'optimized' ? '✅ Optimisé' : s === 'underutilized' ? '⚠️ Sous-utilisé' : '🔴 Critique';
                  const on  = statusFilter === s;
                  return (
                    <button key={s} onClick={() => setStatusFilter(s)}
                      style={{ padding: '8px 14px', borderRadius: 9999, fontWeight: 700, fontSize: 12, background: on ? '#f0fdf4' : '#f8fafc', color: on ? '#16a34a' : '#64748b', border: on ? '1.5px solid #86efac' : '1px solid #e2e8f0', cursor: 'pointer', fontFamily: 'inherit' }}>
                      {lbl}
                    </button>
                  );
                })}
              </div>

              <div style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: '#64748B' }}>
                {filteredServers.length} serveur{filteredServers.length !== 1 ? 's' : ''}
              </div>
            </div>

            <ServerTable servers={filteredServers} loading={loading} onServerSelect={handleServerSelect} />
          </div>
        )}

        {/* CHARTS TAB */}
        {activeTab === 'charts' && (
          <div style={{ animation: 'fadeIn .3s ease' }}>
            {selectedServer ? (
              <>
                <div style={{ background: 'white', borderRadius: 16, padding: '20px 24px', marginBottom: 20, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', marginBottom: 6 }}>{selectedServer.name}</h2>
                    <p style={{ fontSize: 12, color: '#94a3b8' }}>
                      {selectedServer.hasRealData
                        ? `CPU avg: ${selectedServer.avgCpu.toFixed(1)}% | Peak: ${selectedServer.peakCpu.toFixed(1)}% | RAM avg: ${selectedServer.avgRam.toFixed(1)} GB`
                        : "Aucune métrique disponible — vérifiez l'ingestion OVH"}
                    </p>
                  </div>
                  <select value={selectedServer.name}
                    onChange={e => { const srv = servers.find(s => s.name === e.target.value); if (srv) setSelectedServer(srv); }}
                    style={{ padding: '10px 16px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', background: 'white', color: '#0f172a' }}>
                    {servers.map(s => <option key={s.name} value={s.name}>{s.name} ({s.type})</option>)}
                  </select>
                </div>

                {chartsLoading ? (
                  <div style={{ background: 'white', borderRadius: 16, padding: 80, textAlign: 'center', color: '#94a3b8' }}>
                    <RefreshCw size={32} style={{ opacity: 0.3, margin: '0 auto 12px', display: 'block', animation: 'spin 2s linear infinite' }} />
                    Chargement des métriques...
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: 16 }}>
                    <ResourceChart data={timeSeriesData} metricKey="cpu_usage"  label="CPU Usage"  unit="%" color="#2563eb" />
                    <ResourceChart data={timeSeriesData} metricKey="ram_usage"  label="RAM Usage"  unit="GB" color="#8b5cf6" />
                    <ResourceChart data={timeSeriesData} metricKey="disk_usage" label="Disk Usage" unit="GB" color="#f97316" />
                  </div>
                )}
              </>
            ) : (
              <div style={{ background: 'white', borderRadius: 16, padding: 80, textAlign: 'center', color: '#94a3b8' }}>
                <BarChart2 size={48} style={{ opacity: 0.2, margin: '0 auto 16px', display: 'block' }} />
                <p style={{ fontSize: 15, fontWeight: 700, color: '#374151' }}>Sélectionnez un serveur pour voir les métriques</p>
              </div>
            )}
          </div>
        )}

        {/* INSIGHTS TAB */}
        {activeTab === 'insights' && (
          <div style={{ animation: 'fadeIn .3s ease' }}>
            <Insights servers={filteredServers} />
          </div>
        )}

        <style>{`
          @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
          @keyframes spin   { from { transform:rotate(0deg); }             to   { transform:rotate(360deg); }          }
        `}</style>
      </div>
    </div>
  );
}
