import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Upload, Link, FileText, CheckCircle, XCircle, Clock,
  Trash2, Play, RefreshCw, Info, Zap, Key, Globe,
  ChevronDown, ChevronRight, Eye, EyeOff, DollarSign,
  TrendingUp, TrendingDown, Database, AlertCircle, Server,
  Cpu, HardDrive, MemoryStick, Activity, BarChart2,
  Lightbulb,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import Layout from '../Layout/Layout';
import { filesService } from '../../services/files';
import { costsService } from '../../services/costs';
import api from '../../services/api';
import toast from 'react-hot-toast';

// ─── helpers ──────────────────────────────────────────────────────────
const fmtSize = b =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;
const fmtDate = d =>
  d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const fmt2 = v =>
  Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtTs = iso => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const extractInvoiceMonth = (file, costsData) => {
  const mkResult = d => ({
    label: MONTHS_FR[d.getMonth()] + ' ' + d.getFullYear(),
    short: MONTHS_FR[d.getMonth()].slice(0,3) + ' ' + String(d.getFullYear()).slice(2),
    date: d,
  });
  if (file.invoice_date) {
    const d = new Date(file.invoice_date);
    if (!isNaN(d)) return mkResult(d);
  }
  if (costsData) {
    const dates = (costsData.dates || []).map(x => new Date(x)).filter(d => !isNaN(d));
    if (dates.length > 0) return mkResult(dates[0]);
  }
  if (file.created_at) {
    const d = new Date(file.created_at);
    if (!isNaN(d)) return mkResult(d);
  }
  return null;
};

const STATUS_CFG = {
  PENDING:   { label: 'En attente', color: '#f59e0b', bg: '#fffbeb', border: '#fcd34d', icon: Clock },
  PARSING:   { label: 'En cours',   color: '#2563eb', bg: '#eff6ff', border: '#93c5fd', icon: RefreshCw },
  SUCCESS:   { label: 'Succès',     color: '#16a34a', bg: '#f0fdf4', border: '#86efac', icon: CheckCircle },
  DONE:      { label: 'Succès',     color: '#16a34a', bg: '#f0fdf4', border: '#86efac', icon: CheckCircle },
  COMPLETED: { label: 'Succès',     color: '#16a34a', bg: '#f0fdf4', border: '#86efac', icon: CheckCircle },
  PARSED:    { label: 'Succès',     color: '#16a34a', bg: '#f0fdf4', border: '#86efac', icon: CheckCircle },
  FAILED:    { label: 'Échec',      color: '#dc2626', bg: '#fff5f5', border: '#fca5a5', icon: XCircle },
  ERROR:     { label: 'Échec',      color: '#dc2626', bg: '#fff5f5', border: '#fca5a5', icon: XCircle },
};

const normalizeStatus = s => {
  if (!s) return 'PENDING';
  const raw = String(s).includes('.') ? String(s).split('.').pop() : String(s);
  const up = raw.toUpperCase().trim();
  if (STATUS_CFG[up]) return up;
  if (up.includes('SUCCESS') || up.includes('DONE') || up.includes('COMPLET') || up.includes('PARSED')) return 'SUCCESS';
  if (up.includes('FAIL') || up.includes('ERROR')) return 'FAILED';
  if (up.includes('PARS') || up.includes('PROCESS') || up.includes('RUNNING')) return 'PARSING';
  return 'PENDING';
};

// ─── Sources API préconfigurées ───────────────────────────────────────
const API_PRESETS = [
  {
    id: 'ovh',
    name: 'OVHcloud',
    icon: '🔷',
    color: '#00b3ff',
    urlPlaceholder: 'https://eu.api.ovh.com/1.0/me/bill',
    authType: 'ovh_keys',
    docsUrl: 'https://api.ovh.com/console/',
    description: 'OVHcloud — Factures, Public Cloud, consommation',
    endpoints: [
      { label: 'Factures',            value: 'https://eu.api.ovh.com/1.0/me/bill' },
      { label: 'Public Cloud Budget', value: 'https://eu.api.ovh.com/1.0/cloud/project/{projectId}/bill' },
      { label: 'Public Cloud Usage',  value: 'https://eu.api.ovh.com/1.0/cloud/project/{projectId}/usage/current' },
      { label: 'Consommation totale', value: 'https://eu.api.ovh.com/1.0/me/consumption' },
    ],
    fields: [
      { key: 'app_key',      label: 'Application Key',    type: 'text',     placeholder: 'xxxxxxxxxxx',            hint: 'Générer sur eu.api.ovh.com/createToken' },
      { key: 'app_secret',   label: 'Application Secret', type: 'password', placeholder: 'yyyyyyyyyyyyyyyyyyyy',    hint: '' },
      { key: 'consumer_key', label: 'Consumer Key',       type: 'password', placeholder: 'zzzzzzzzzzzzzzzzzzzzzz', hint: '' },
      { key: 'project_id',   label: 'Project ID (Cloud)', type: 'text',     placeholder: 'abc123def456...',         hint: 'Optionnel — requis pour endpoints Public Cloud' },
    ],
  },
  {
    id: 'aws',
    name: 'AWS',
    icon: '🟠',
    color: '#f97316',
    urlPlaceholder: 'https://ce.us-east-1.amazonaws.com',
    authType: 'aws_keys',
    docsUrl: 'https://docs.aws.amazon.com/cost-management/latest/APIReference/',
    description: 'AWS Cost Explorer — Coûts et usage',
    endpoints: [
      { label: 'Cost Explorer', value: 'https://ce.us-east-1.amazonaws.com' },
    ],
    fields: [
      { key: 'access_key', label: 'Access Key ID',     type: 'text',     placeholder: 'AKIAIOSFODNN7EXAMPLE', hint: '' },
      { key: 'secret_key', label: 'Secret Access Key', type: 'password', placeholder: 'wJalrXUtnFEMI/K7...',  hint: '' },
      { key: 'region',     label: 'Région',            type: 'text',     placeholder: 'eu-west-1',             hint: '' },
    ],
  },
  {
    id: 'azure',
    name: 'Azure',
    icon: '🔵',
    color: '#2563eb',
    urlPlaceholder: 'https://management.azure.com/subscriptions/{id}/providers/Microsoft.CostManagement/query',
    authType: 'bearer',
    docsUrl: 'https://learn.microsoft.com/en-us/rest/api/cost-management/',
    description: 'Azure Cost Management — Analyse des coûts',
    endpoints: [
      { label: 'Cost Management', value: 'https://management.azure.com/subscriptions/{id}/providers/Microsoft.CostManagement/query' },
    ],
    fields: [
      { key: 'subscription_id', label: 'Subscription ID', type: 'text',     placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', hint: '' },
      { key: 'tenant_id',       label: 'Tenant ID',       type: 'text',     placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', hint: '' },
      { key: 'client_id',       label: 'Client ID',       type: 'text',     placeholder: 'xxxxxxxx-xxxx-...',                    hint: '' },
      { key: 'client_secret',   label: 'Client Secret',   type: 'password', placeholder: 'votre_secret',                         hint: '' },
    ],
  },
  {
    id: 'gcp',
    name: 'GCP',
    icon: '🔴',
    color: '#ef4444',
    urlPlaceholder: 'https://cloudbilling.googleapis.com/v1/billingAccounts/{id}',
    authType: 'api_key',
    docsUrl: 'https://cloud.google.com/billing/docs/reference/rest',
    description: 'Google Cloud Billing API',
    endpoints: [
      { label: 'Cloud Billing', value: 'https://cloudbilling.googleapis.com/v1/billingAccounts/{id}' },
    ],
    fields: [
      { key: 'project_id', label: 'Project ID', type: 'text',     placeholder: 'my-gcp-project', hint: '' },
      { key: 'api_key',    label: 'API Key',     type: 'password', placeholder: 'AIzaSy...',       hint: '' },
    ],
  },
  {
    id: 'custom',
    name: 'Custom',
    icon: '⚙️',
    color: '#8b5cf6',
    urlPlaceholder: 'https://votre-api.com/v1/costs',
    authType: 'custom',
    docsUrl: null,
    description: 'Toute API REST personnalisée',
    endpoints: [],
    fields: [
      { key: 'auth_header', label: 'Header Auth', type: 'text',     placeholder: 'Authorization',      hint: '' },
      { key: 'auth_value',  label: 'Valeur Auth',  type: 'password', placeholder: 'Bearer token123...', hint: '' },
    ],
  },
];

// ══════════════════════════════════════════════════════════════════════
// ── INLINE RESOURCE MONITORING PANEL (OVH only) ──────────────────────
// ══════════════════════════════════════════════════════════════════════

// Detect server type from name
function detectType(name = '') {
  if (/DEDICATED|DATABASE|EG-|ADVANCE|RISE|BIG-|SP-|HG-|SCALE-|KS-|SYS-|DEDIBOX|SERVER/i.test(name))
    return 'Dedicated';
  return 'VPS';
}

// FinOps status logic
function calcStatus(avgCpu, peakCpu) {
  if (avgCpu < 10 && peakCpu < 20) return 'underutilized';
  if (avgCpu > 75 || peakCpu > 90) return 'critical';
  return 'optimized';
}

const RESOURCE_STATUS = {
  optimized:    { color: '#16a34a', bg: '#f0fdf4', label: 'Optimisé',     icon: CheckCircle },
  underutilized:{ color: '#d97706', bg: '#fffbeb', label: 'Sous-utilisé', icon: AlertCircle },
  critical:     { color: '#dc2626', bg: '#fff5f5', label: 'Critique',     icon: AlertCircle },
};

// Mini usage bar
function MiniBar({ value, max = 100, color }) {
  const pct = Math.min((value / max) * 100, 100);
  const c = value < 10 ? '#d97706' : value > 85 ? '#dc2626' : color;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 100 }}>
      <div style={{ flex: 1, height: 5, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: c, borderRadius: 99, transition: 'width .5s ease' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: c, minWidth: 34, textAlign: 'right' }}>
        {value.toFixed(1)}{max === 100 ? '%' : ' G'}
      </span>
    </div>
  );
}

// Status badge
function ResBadge({ status }) {
  const cfg = RESOURCE_STATUS[status] || RESOURCE_STATUS.optimized;
  const Icon = cfg.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700,
      background: cfg.bg, color: cfg.color,
    }}>
      <Icon size={10} /> {cfg.label}
    </span>
  );
}

// Compact chart tooltip
function ResTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#0f172a', color: '#fff', borderRadius: 8, padding: '8px 12px',
      fontSize: 11, boxShadow: '0 4px 16px rgba(0,0,0,.3)',
    }}>
      <p style={{ opacity: .6, marginBottom: 4 }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ fontWeight: 700, color: p.color }}>
          {Number(p.value).toFixed(1)}{unit}
        </p>
      ))}
    </div>
  );
}

// Mini line chart
function MiniChart({ data, metricKey, color, unit, label, threshold }) {
  const pts = useMemo(() => {
    if (!data?.length) return [];
    const step = Math.max(1, Math.floor(data.length / 48));
    return data.filter((_, i) => i % step === 0).map(d => ({
      t: fmtTs(d.recorded_at || d.timestamp),
      v: Number(d[metricKey] || 0),
    }));
  }, [data, metricKey]);

  return (
    <div style={{ background: 'white', borderRadius: 12, padding: '14px 12px 8px', border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
        <span style={{ fontSize: 11, fontWeight: 800, color: '#374151' }}>{label}</span>
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={pts} margin={{ top: 2, right: 4, bottom: 0, left: -28 }}>
          <CartesianGrid strokeDasharray="2 2" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="t" tick={false} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false}
            tickFormatter={v => `${v}${unit}`} />
          <Tooltip content={<ResTooltip unit={unit} />} />
          {threshold && <ReferenceLine y={threshold} stroke="#fca5a5" strokeDasharray="3 3" />}
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
            dot={false} activeDot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── The main inline resource panel ───────────────────────────────────
function OVHResourcePanel() {
  const [servers,       setServers]       = useState([]);
  const [avgStats,      setAvgStats]      = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [resTab,        setResTab]        = useState('table');   // table | charts | insights
  const [selectedSrv,   setSelectedSrv]   = useState(null);
  const [timeSeries,    setTimeSeries]    = useState([]);
  const [loadingChart,  setLoadingChart]  = useState(false);
  const [search,        setSearch]        = useState('');
  const [statusFilter,  setStatusFilter]  = useState('all');

  // Load server summaries
  const loadServers = useCallback(async () => {
    setLoading(true);
    try {
      // GET /api/v1/resources/servers/summary/all
      const res = await api.get('/resources/servers/summary/all');
      const raw = Array.isArray(res.data) ? res.data : [];
      const enriched = raw.map(s => ({
        ...s,
        server_type:  detectType(s.server_name),
        status:       calcStatus(s.avg_cpu || 0, s.peak_cpu || 0),
      }));
      setServers(enriched);
      if (enriched.length && !selectedSrv) setSelectedSrv(enriched[0]);

      // Also fetch fleet-wide averages
      try {
        const avg = await api.get('/resources/stats/average');
        setAvgStats(avg.data);
      } catch { /* non-critical */ }
    } catch {
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, [selectedSrv]);

  // Load time-series for selected server
  const loadTimeSeries = useCallback(async (srv) => {
    if (!srv) return;
    setLoadingChart(true);
    try {
      const end   = new Date().toISOString().split('T')[0];
      const start = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      const res = await api.get(`/resources/servers/${encodeURIComponent(srv.server_name)}/metrics`, {
        params: { start_date: start, end_date: end, limit: 300 },
      });
      setTimeSeries(res.data?.items || []);
    } catch {
      setTimeSeries([]);
    } finally {
      setLoadingChart(false);
    }
  }, []);

  useEffect(() => { loadServers(); }, []);
  useEffect(() => {
    if (selectedSrv && resTab === 'charts') loadTimeSeries(selectedSrv);
  }, [selectedSrv, resTab, loadTimeSeries]);

  // Filtered servers
  const filtered = useMemo(() => {
    return servers.filter(s => {
      const matchSearch = !search || s.server_name.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'all' || s.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [servers, search, statusFilter]);

  const underutilized = servers.filter(s => s.status === 'underutilized');
  const critical      = servers.filter(s => s.status === 'critical');

  // ── KPI summary ────────────────────────────────────────────────
  const fleetAvgCpu  = avgStats?.avg_cpu_usage  ?? (servers.length ? servers.reduce((a,s)=>a+s.avg_cpu,0)/servers.length : 0);
  const fleetAvgRam  = avgStats?.avg_ram_usage  ?? (servers.length ? servers.reduce((a,s)=>a+s.avg_ram,0)/servers.length : 0);
  const fleetAvgDisk = avgStats?.avg_disk_usage ?? (servers.length ? servers.reduce((a,s)=>a+s.avg_disk,0)/servers.length : 0);

  // ── Sub-tab buttons ────────────────────────────────────────────
  const subTabs = [
    { id: 'table',    label: 'Serveurs',       icon: Server },
    { id: 'charts',   label: 'Graphiques',     icon: Activity },
    { id: 'insights', label: 'Optimisations',  icon: Lightbulb },
  ];

  return (
    <div style={{
      background: '#f8fafc', border: '1.5px solid #86efac',
      borderRadius: 16, overflow: 'hidden', marginTop: 0,
    }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1B5E46 0%, #15803d 100%)',
        padding: '16px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <BarChart2 size={18} color="white" />
          </div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 800, color: 'white', marginBottom: 1 }}>
              Métriques Ressources OVH
            </p>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,.7)' }}>
              CPU · RAM · Disque — {servers.length} serveur{servers.length !== 1 ? 's' : ''} surveillés
            </p>
          </div>
        </div>
        <button onClick={loadServers} style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '6px 14px', borderRadius: 8,
          background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.3)',
          color: 'white', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          Actualiser
        </button>
      </div>

      {/* KPI strip */}
      {servers.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px,1fr))',
          gap: 1, background: '#e2e8f0', borderBottom: '1px solid #e2e8f0',
        }}>
          {[
            { label: 'CPU Moyen',     val: `${fleetAvgCpu.toFixed(1)}%`,  icon: Cpu,        color: '#2563eb', bg: 'white' },
            { label: 'RAM Moyenne',   val: `${fleetAvgRam.toFixed(1)} GB`, icon: MemoryStick,color: '#7c3aed', bg: 'white' },
            { label: 'Disque Moyen',  val: `${fleetAvgDisk.toFixed(1)} GB`,icon: HardDrive,  color: '#ea580c', bg: 'white' },
            { label: 'Sous-utilisés', val: underutilized.length,            icon: TrendingDown,color: '#d97706', bg: '#fffbeb' },
            { label: 'Critiques',     val: critical.length,                 icon: TrendingUp,  color: '#dc2626', bg: '#fff5f5' },
          ].map(k => (
            <div key={k.label} style={{
              background: k.bg, padding: '12px 14px',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <k.icon size={14} color={k.color} style={{ flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em' }}>{k.label}</p>
                <p style={{ fontSize: 16, fontWeight: 900, color: k.color, lineHeight: 1 }}>{k.val}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sub-tab bar */}
      <div style={{
        display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0',
        background: 'white',
      }}>
        {subTabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setResTab(id)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '10px 18px', border: 'none', borderBottom: `2.5px solid ${resTab === id ? '#1B5E46' : 'transparent'}`,
            background: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 12, fontWeight: resTab === id ? 800 : 500,
            color: resTab === id ? '#1B5E46' : '#94a3b8',
            transition: 'all .15s',
          }}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '16px' }}>

        {/* ── TABLE TAB ── */}
        {resTab === 'table' && (
          <div>
            {/* Search + filter row */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: '1 1 160px' }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 12 }}>🔍</span>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Filtrer par nom…"
                  style={{
                    width: '100%', padding: '7px 10px 7px 28px',
                    borderRadius: 8, border: '1.5px solid #e2e8f0',
                    fontSize: 12, fontFamily: 'inherit', color: '#0f172a',
                    background: 'white', boxSizing: 'border-box', outline: 'none',
                  }}
                />
              </div>
              {['all', 'optimized', 'underutilized', 'critical'].map(s => {
                const labels = { all: 'Tous', optimized: '✅ Optimisé', underutilized: '⚠️ Sous-utilisé', critical: '🔴 Critique' };
                const colors = { all: '#2563eb', optimized: '#16a34a', underutilized: '#d97706', critical: '#dc2626' };
                const bgs    = { all: '#eff6ff', optimized: '#f0fdf4', underutilized: '#fffbeb', critical: '#fff5f5' };
                return (
                  <button key={s} onClick={() => setStatusFilter(s)} style={{
                    padding: '6px 12px', borderRadius: 8, border: `1.5px solid ${statusFilter===s ? colors[s] : '#e2e8f0'}`,
                    background: statusFilter===s ? bgs[s] : 'white',
                    color: statusFilter===s ? colors[s] : '#64748b',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    {labels[s]}
                  </button>
                );
              })}
            </div>

            {loading ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
                <RefreshCw size={22} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px', display: 'block', opacity: .4 }} />
                <p style={{ fontSize: 12 }}>Chargement des métriques…</p>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
                <Server size={32} style={{ margin: '0 auto 10px', display: 'block', opacity: .2 }} />
                <p style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>
                  {servers.length === 0
                    ? 'Aucun relevé de métriques. Connectez OVH et lancez une collecte.'
                    : 'Aucun serveur ne correspond aux filtres.'}
                </p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      {['Serveur', 'Type', 'CPU Moy', 'CPU Pic', 'RAM Moy', 'Disque Moy', 'Statut', ''].map(h => (
                        <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s, i) => {
                      const isSel = selectedSrv?.server_name === s.server_name;
                      return (
                        <tr key={s.server_name} style={{
                          background: isSel ? '#f0fdf4' : i%2===0 ? 'white' : '#fafafa',
                          borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
                          transition: 'background .1s',
                        }}
                          onClick={() => { setSelectedSrv(s); setResTab('charts'); }}
                          onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = '#f0f9ff'; }}
                          onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = i%2===0 ? 'white' : '#fafafa'; }}
                        >
                          <td style={{ padding: '10px 12px', fontWeight: 700, color: '#0f172a', maxWidth: 180 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Server size={12} color="#2563eb" style={{ flexShrink: 0 }} />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {s.server_name}
                              </span>
                            </div>
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <span style={{
                              padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                              background: s.server_type === 'Dedicated' ? '#f3eeff' : '#eff6ff',
                              color:      s.server_type === 'Dedicated' ? '#7c3aed' : '#2563eb',
                            }}>{s.server_type}</span>
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <MiniBar value={s.avg_cpu || 0} max={100} color="#2563eb" />
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <MiniBar value={s.peak_cpu || 0} max={100} color="#dc2626" />
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <MiniBar value={s.avg_ram || 0} max={64} color="#7c3aed" />
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <MiniBar value={s.avg_disk || 0} max={1024} color="#ea580c" />
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <ResBadge status={s.status} />
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <button
                              onClick={e => { e.stopPropagation(); setSelectedSrv(s); setResTab('charts'); }}
                              style={{
                                padding: '4px 10px', borderRadius: 7,
                                border: '1.5px solid #e2e8f0', background: 'white',
                                color: '#2563eb', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                              }}
                            >
                              Graphique →
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── CHARTS TAB ── */}
        {resTab === 'charts' && (
          <div>
            {/* Server picker */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <select
                value={selectedSrv?.server_name || ''}
                onChange={e => {
                  const found = servers.find(s => s.server_name === e.target.value);
                  if (found) setSelectedSrv(found);
                }}
                style={{
                  flex: '1 1 200px', padding: '8px 12px', borderRadius: 9,
                  border: '1.5px solid #e2e8f0', fontSize: 12, fontFamily: 'inherit',
                  color: '#0f172a', background: 'white', cursor: 'pointer', outline: 'none',
                }}
              >
                {servers.map(s => (
                  <option key={s.server_name} value={s.server_name}>
                    {s.server_name} ({s.server_type})
                  </option>
                ))}
              </select>
              {selectedSrv && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <ResBadge status={selectedSrv.status} />
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    CPU moy: <strong>{(selectedSrv.avg_cpu||0).toFixed(1)}%</strong>
                    {' '}· Pic: <strong>{(selectedSrv.peak_cpu||0).toFixed(1)}%</strong>
                    {' '}· RAM: <strong>{(selectedSrv.avg_ram||0).toFixed(1)} GB</strong>
                  </span>
                </div>
              )}
            </div>

            {!selectedSrv ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
                <BarChart2 size={32} style={{ margin: '0 auto 10px', display: 'block', opacity: .2 }} />
                <p style={{ fontSize: 12 }}>Sélectionnez un serveur pour voir ses métriques</p>
              </div>
            ) : loadingChart ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
                <RefreshCw size={22} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px', display: 'block', opacity: .4 }} />
                <p style={{ fontSize: 12 }}>Chargement des données…</p>
              </div>
            ) : timeSeries.length === 0 ? (
              <div style={{
                padding: '20px', background: '#fffbeb', border: '1px solid #fcd34d',
                borderRadius: 10, textAlign: 'center',
              }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>
                  Aucune donnée de série temporelle disponible
                </p>
                <p style={{ fontSize: 11, color: '#b45309' }}>
                  Configurez le collecteur OVH pour enregistrer les métriques automatiquement.
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px,1fr))', gap: 10 }}>
                <MiniChart data={timeSeries} metricKey="cpu_usage"  color="#2563eb" unit="%" label="CPU Usage (%)" threshold={85} />
                <MiniChart data={timeSeries} metricKey="ram_usage"  color="#7c3aed" unit=" GB" label="RAM Usage (GB)" />
                <MiniChart data={timeSeries} metricKey="disk_usage" color="#ea580c" unit=" GB" label="Disque Usage (GB)" />
              </div>
            )}
          </div>
        )}

        {/* ── INSIGHTS TAB ── */}
        {resTab === 'insights' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Status summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
              {[
                { label: 'Optimisés',     count: servers.filter(s=>s.status==='optimized').length,     color: '#16a34a', bg: '#f0fdf4', icon: CheckCircle },
                { label: 'Sous-utilisés', count: servers.filter(s=>s.status==='underutilized').length, color: '#d97706', bg: '#fffbeb', icon: AlertCircle },
                { label: 'Critiques',     count: servers.filter(s=>s.status==='critical').length,      color: '#dc2626', bg: '#fff5f5', icon: AlertCircle },
              ].map(({ label, count, color, bg, icon: Icon }) => (
                <div key={label} style={{
                  background: bg, border: `1px solid ${color}25`,
                  borderRadius: 10, padding: '12px', textAlign: 'center',
                }}>
                  <Icon size={18} color={color} style={{ margin: '0 auto 6px', display: 'block' }} />
                  <p style={{ fontSize: 22, fontWeight: 900, color, lineHeight: 1 }}>{count}</p>
                  <p style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginTop: 3 }}>{label}</p>
                </div>
              ))}
            </div>

            {/* Underutilized */}
            {underutilized.length > 0 && (
              <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid #fcd34d', display: 'flex', alignItems: 'center', gap: 7 }}>
                  <TrendingDown size={14} color="#d97706" />
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#92400e' }}>
                    Serveurs sous-utilisés — downsize recommandé
                  </span>
                </div>
                <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {underutilized.map(s => (
                    <div key={s.server_name} style={{
                      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                      padding: '8px 10px', background: 'white', borderRadius: 8, border: '1px solid #fde68a',
                    }}>
                      <Server size={12} color="#d97706" style={{ flexShrink: 0 }} />
                      <span style={{ fontWeight: 700, fontSize: 12, color: '#0f172a', flex: 1 }}>{s.server_name}</span>
                      <span style={{ fontSize: 11, color: '#64748b' }}>
                        CPU moy: <strong>{(s.avg_cpu||0).toFixed(1)}%</strong> · Pic: <strong>{(s.peak_cpu||0).toFixed(1)}%</strong>
                      </span>
                      <span style={{
                        padding: '3px 9px', borderRadius: 7, background: '#d97706', color: 'white',
                        fontSize: 10, fontWeight: 700,
                      }}>↓ Downsize</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Critical */}
            {critical.length > 0 && (
              <div style={{ background: '#fff5f5', border: '1px solid #fca5a5', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid #fca5a5', display: 'flex', alignItems: 'center', gap: 7 }}>
                  <TrendingUp size={14} color="#dc2626" />
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#991b1b' }}>
                    Serveurs en surcharge — risque de dégradation
                  </span>
                </div>
                <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {critical.map(s => (
                    <div key={s.server_name} style={{
                      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                      padding: '8px 10px', background: 'white', borderRadius: 8, border: '1px solid #fca5a5',
                    }}>
                      <Server size={12} color="#dc2626" style={{ flexShrink: 0 }} />
                      <span style={{ fontWeight: 700, fontSize: 12, color: '#0f172a', flex: 1 }}>{s.server_name}</span>
                      <span style={{ fontSize: 11, color: '#64748b' }}>
                        CPU moy: <strong>{(s.avg_cpu||0).toFixed(1)}%</strong> · Pic: <strong>{(s.peak_cpu||0).toFixed(1)}%</strong>
                      </span>
                      <span style={{
                        padding: '3px 9px', borderRadius: 7, background: '#dc2626', color: 'white',
                        fontSize: 10, fontWeight: 700,
                      }}>⚠ Upscale</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Decision rules */}
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' }}>
              <p style={{ fontSize: 11, fontWeight: 800, color: '#374151', marginBottom: 8 }}>Règles de décision FinOps</p>
              {[
                { c: '#16a34a', line: 'CPU moy 10–75% et pic < 90%  →  Optimisé' },
                { c: '#d97706', line: 'CPU moy < 10% et pic < 20%   →  Sous-utilisé — downsize recommandé' },
                { c: '#dc2626', line: 'CPU moy > 75% ou pic > 90%   →  Critique — upscale urgente' },
              ].map(({ c, line }) => (
                <div key={line} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: '#64748b' }}>{line}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ── Shared small components ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

function StatusBadge({ status }) {
  const key = normalizeStatus(status);
  const c = STATUS_CFG[key];
  const Icon = c.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, fontWeight: 700, color: c.color,
      background: c.bg, padding: '4px 10px', borderRadius: 99,
      border: `1px solid ${c.border}`,
    }}>
      <Icon size={11} /> {c.label}
    </span>
  );
}

function CostBadge({ file, info }) {
  const hasTTC   = file?.invoice_total_ttc != null && file.invoice_total_ttc > 0;
  const hasHT    = file?.invoice_total_ht  != null && file.invoice_total_ht  > 0;
  const hasLines = info?.total > 0;

  if (!hasTTC && !hasHT && !hasLines) {
    return <span style={{ color: '#cbd5e1', fontSize: 13 }}>—</span>;
  }

  const htAmt  = hasHT ? file.invoice_total_ht : hasLines ? info.total : null;
  const ttcAmt = hasTTC ? file.invoice_total_ttc : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {htAmt != null && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 900, color: '#0f172a', letterSpacing: '-0.5px', lineHeight: 1 }}>
            {fmt2(htAmt)}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>€</span>
          <span style={{ fontSize: 9, fontWeight: 800, color: '#0369a1', background: '#e0f2fe', padding: '1px 5px', borderRadius: 4 }}>
            HT
          </span>
        </div>
      )}
      {ttcAmt != null && (
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
          {fmt2(ttcAmt)} € <span style={{ fontSize: 9, fontWeight: 700, color: '#16a34a', background: '#dcfce7', padding: '1px 4px', borderRadius: 3 }}>TTC</span>
        </span>
      )}
      {hasLines && (
        <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 3 }}>
          <Database size={9} />
          {info.count} ligne{info.count > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

function Tab({ active, onClick, icon: Icon, label, color = '#1B5E46' }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '14px 28px', border: 'none',
      borderBottom: active ? `3px solid ${color}` : '3px solid transparent',
      background: 'none', cursor: 'pointer', fontFamily: 'inherit',
      fontSize: 14, fontWeight: active ? 800 : 500,
      color: active ? color : '#94a3b8', transition: 'all .15s',
    }}>
      <Icon size={16} /> {label}
    </button>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, hint }) {
  const [show, setShow] = useState(false);
  const isPass = type === 'password';
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 5 }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type={isPass && !show ? 'password' : 'text'}
          value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            width: '100%', padding: `10px ${isPass ? '38px' : '12px'} 10px 12px`,
            borderRadius: 10, border: '1.5px solid #e2e8f0',
            fontSize: 13, fontFamily: 'inherit', color: '#0f172a',
            background: 'white', boxSizing: 'border-box', outline: 'none',
            transition: 'border-color .15s',
          }}
          onFocus={e => { e.target.style.borderColor = '#1B5E46'; }}
          onBlur={e  => { e.target.style.borderColor = '#e2e8f0'; }}
        />
        {isPass && (
          <button onClick={() => setShow(s => !s)} type="button" style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, lineHeight: 1,
          }}>
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
      </div>
      {hint && <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{hint}</p>}
    </div>
  );
}

function PresetCard({ preset, selected, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '14px 18px', borderRadius: 14,
      border: `2px solid ${selected ? preset.color : '#e2e8f0'}`,
      background: selected ? preset.color + '10' : 'white',
      cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
      transition: 'all .15s', flex: 1, minWidth: 130,
      boxShadow: selected ? `0 0 0 3px ${preset.color}22` : 'none',
    }}>
      <span style={{ fontSize: 26, lineHeight: 1 }}>{preset.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: selected ? preset.color : '#374151', marginBottom: 2 }}>
          {preset.name}
        </p>
        <p style={{ fontSize: 10, color: '#94a3b8' }}>
          {preset.authType === 'ovh_keys' ? 'App Key + Secret + Consumer'
            : preset.authType === 'aws_keys' ? 'Access Keys'
            : preset.authType === 'bearer'   ? 'OAuth 2.0'
            : preset.authType === 'api_key'  ? 'API Key'
            : 'Custom Headers'}
        </p>
      </div>
      {selected && <CheckCircle size={16} color={preset.color} style={{ flexShrink: 0 }} />}
    </button>
  );
}

function StepLabel({ num, text }) {
  return (
    <p style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        width: 24, height: 24, borderRadius: 99, background: '#1B5E46', color: 'white',
        fontSize: 12, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {num}
      </span>
      {text}
    </p>
  );
}

function SummaryCard({ label, value, sub, color, bg, icon: Icon }) {
  return (
    <div style={{
      flex: 1, minWidth: 140,
      background: bg, border: `1px solid ${color}33`,
      borderRadius: 16, padding: '16px 20px',
      display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 12,
        background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon size={18} color="white" />
      </div>
      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 2 }}>
          {label}
        </p>
        <p style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', lineHeight: 1, letterSpacing: '-0.5px' }}>
          {value}
        </p>
        {sub && <p style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>{sub}</p>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ── MAIN FILES COMPONENT ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════
export default function Files() {
  const [tab,       setTab]       = useState('file');
  const [files,     setFiles]     = useState([]);
  const [fileCosts, setFileCosts] = useState({ byId: {}, byName: {} });
  const [loading,   setLoading]   = useState(true);
  const [dragging,  setDragging]  = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parsing,   setParsing]   = useState({});
  const fileRef = useRef();

  // API tab state
  const [selectedPreset, setSelectedPreset] = useState('ovh');
  const [apiUrl,         setApiUrl]         = useState('https://eu.api.ovh.com/1.0/me/bill');
  const [apiFields,      setApiFields]      = useState({});
  const [httpMethod,     setHttpMethod]     = useState('GET');
  const [startDate,      setStartDate]      = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0];
  });
  const [endDate,        setEndDate]        = useState(new Date().toISOString().split('T')[0]);
  const [extraHeaders,   setExtraHeaders]   = useState('');
  const [showAdvanced,   setShowAdvanced]   = useState(false);
  const [testing,        setTesting]        = useState(false);
  const [importing,      setImporting]      = useState(false);
  const [testResult,     setTestResult]     = useState(null);
  const [importResult,   setImportResult]   = useState(null);
  const [importingRes,   setImportingRes]   = useState(false);
  const [importResResult,setImportResResult]= useState(null);

  const preset = API_PRESETS.find(p => p.id === selectedPreset);

  const loadFiles = useCallback(async () => {
    try {
      setLoading(true);
      const data = await filesService.getFiles();
      setFiles(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Erreur chargement fichiers');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFileCosts = useCallback(async () => {
    try {
      const data = await costsService.getCosts(0, 10000);
      const costs = Array.isArray(data) ? data : [];
      const byId  = {};
      const byName = {};
      costs.forEach(c => {
        const amount = Number(c.amount || 0);
        const dateVal = c.cost_date || c.invoice_date || c.date || null;
        const fid = c.file_id ?? c.source_file_id ?? null;
        if (fid != null) {
          if (!byId[fid]) byId[fid] = { total: 0, count: 0, dates: [] };
          byId[fid].total += amount; byId[fid].count += 1;
          if (dateVal && !byId[fid].dates.includes(dateVal)) byId[fid].dates.push(dateVal);
        }
        const fname = c.filename || c.source_file || c.source || null;
        if (fname) {
          const k = fname.toLowerCase();
          if (!byName[k]) byName[k] = { total: 0, count: 0, dates: [] };
          byName[k].total += amount; byName[k].count += 1;
          if (dateVal && !byName[k].dates.includes(dateVal)) byName[k].dates.push(dateVal);
        }
      });
      setFileCosts({ byId, byName });
    } catch { /* silencieux */ }
  }, []);

  const getCostInfo = useCallback((f) => {
    if (!fileCosts.byId && !fileCosts.byName) return null;
    const byId = fileCosts.byId || {};
    const byName = fileCosts.byName || {};
    const infoById = byId[f.id] || null;
    if (infoById && infoById.total > 0) return infoById;
    const fnKey = (f.filename || '').toLowerCase();
    const infoByName = byName[fnKey] || null;
    if (infoByName && infoByName.total > 0) return infoByName;
    return null;
  }, [fileCosts]);

  useEffect(() => { loadFiles(); loadFileCosts(); }, [loadFiles, loadFileCosts]);

  const handleUpload = async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv', 'pdf'].includes(ext)) {
      toast.error(`Format non supporté : .${ext}`); return;
    }
    try {
      setUploading(true);
      toast.loading('Upload en cours...', { id: 'upload' });
      const res = await filesService.uploadFile(file);
      toast.success(`✅ "${res.filename}" uploadé !`, { id: 'upload' });
      await loadFiles();
    } catch (e) {
      toast.error('Erreur: ' + (e?.response?.data?.detail || e.message), { id: 'upload' });
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = e => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]);
  };

  const handleParse = async (id) => {
    try {
      setParsing(p => ({ ...p, [id]: true }));
      toast.loading('Parsing...', { id: `parse-${id}` });
      const res = await filesService.parseFile(id);
      toast.success(`✅ ${res.costs_created} coûts importés`, { id: `parse-${id}` });
      await loadFiles(); await loadFileCosts();
    } catch {
      toast.error('Erreur parsing', { id: `parse-${id}` });
    } finally {
      setParsing(p => ({ ...p, [id]: false }));
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Supprimer "${name}" ?`)) return;
    try {
      await filesService.deleteFile(id);
      toast.success('Fichier supprimé');
      setFiles(f => f.filter(x => x.id !== id));
      await loadFileCosts();
    } catch {
      toast.error('Erreur suppression');
    }
  };

  const switchPreset = (id) => {
    const p = API_PRESETS.find(x => x.id === id);
    setSelectedPreset(id);
    setApiFields({});
    setApiUrl(p?.endpoints?.[0]?.value || p?.urlPlaceholder || '');
    setTestResult(null);
    setImportResult(null);
  };

  const handleTest = async () => {
    if (!apiUrl) { toast.error('URL requise'); return; }
    try {
      setTesting(true); setTestResult(null);
      toast.loading('Test de connexion...', { id: 'test' });
      let parsedHeaders = {};
      try { if (extraHeaders.trim()) parsedHeaders = JSON.parse(extraHeaders); } catch {}
      await api.post('/files/test-connection', {
        source_name: preset.name, costs: [], metadata: { test: true },
        auth_fields: apiFields, url: apiUrl, method: httpMethod,
        start_date: startDate, end_date: endDate, extra_headers: parsedHeaders,
      });
      setTestResult({ success: true, message: 'Endpoint accessible', records: 0 });
      toast.success('Connexion réussie !', { id: 'test' });
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message;
      setTestResult({ success: false, message: msg });
      toast.error('Connexion échouée', { id: 'test' });
    } finally {
      setTesting(false);
    }
  };

  const handleApiImport = async () => {
    if (!apiUrl) { toast.error('URL requise'); return; }
    try {
      setImporting(true); setImportResult(null);
      toast.loading('Import en cours...', { id: 'api-import' });
      let parsedHeaders = {};
      try { if (extraHeaders.trim()) parsedHeaders = JSON.parse(extraHeaders); } catch {}
      const res = await api.post('/files/fetch-and-import', {
        source_name: preset.name, costs: [],
        metadata: { url: apiUrl, auth_type: preset.authType, start_date: startDate, end_date: endDate, extra_headers: parsedHeaders, method: httpMethod },
        auth_fields: apiFields,
      });
      setImportResult(res.data);
      toast.success(`✅ ${res.data.costs_created} coûts importés !`, { id: 'api-import' });
      await loadFiles(); await loadFileCosts();
    } catch (e) {
      toast.error('Erreur: ' + (e?.response?.data?.detail || e.message), { id: 'api-import' });
    } finally {
      setImporting(false);
    }
  };

  const handleImportOvhResources = async () => {
    if (!apiFields.app_key || !apiFields.app_secret || !apiFields.consumer_key) {
      toast.error('Application Key, Application Secret et Consumer Key requis');
      return;
    }
    try {
      setImportingRes(true); setImportResResult(null);
      toast.loading('Import ressources OVH en cours...', { id: 'ovh-res-import' });
      const res = await api.post('/files/import-ovh-resources', {
        app_key:      apiFields.app_key,
        app_secret:   apiFields.app_secret,
        consumer_key: apiFields.consumer_key,
      });
      setImportResResult(res.data);
      toast.success(
        `✅ ${res.data.metrics_created} métrique(s) OVH importée(s) !`,
        { id: 'ovh-res-import' },
      );
    } catch (e) {
      toast.error(
        'Erreur ressources OVH: ' + (e?.response?.data?.detail || e.message),
        { id: 'ovh-res-import' },
      );
    } finally {
      setImportingRes(false);
    }
  };

  // Computed stats
  const getFileHT = f => {
    if (f.invoice_total_ht != null && f.invoice_total_ht > 0) return f.invoice_total_ht;
    const info = getCostInfo(f);
    return info ? info.total : 0;
  };
  const totalCostAll = files.reduce((s, f) => s + getFileHT(f), 0);
  const totalIsTTC   = false;
  const parsedCount  = files.filter(f => normalizeStatus(f.parse_status) === 'SUCCESS').length;
  const pendingCount = files.filter(f => normalizeStatus(f.parse_status) !== 'SUCCESS').length;

  // ─── RENDER ────────────────────────────────────────────────────
  return (
    <Layout>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        .spin { animation: spin 1s linear infinite; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: translateY(0) } }
        .fade-in { animation: fadeIn 0.25s ease forwards; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: '#0f172a', letterSpacing: '-0.5px' }}>
            Importer des données
          </h1>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 3 }}>
            Upload de fichiers ou connexion directe à une API cloud
          </p>
        </div>
        <button onClick={() => { loadFiles(); loadFileCosts(); }} style={{
          display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px',
          background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 11,
          fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: '#374151',
        }}>
          <RefreshCw size={14} /> Actualiser
        </button>
      </div>

      {/* ── KPI Summary ── */}
      {files.length > 0 && (
        <div className="fade-in" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
          <SummaryCard
            label="Coût total" value={`${fmt2(totalCostAll)} €`}
            sub={`${totalIsTTC ? 'TTC exact' : 'HT · TVA non incluse'} · ${parsedCount} fichier${parsedCount !== 1 ? 's' : ''} parsé${parsedCount !== 1 ? 's' : ''}`}
            color="#1B5E46" bg="#f0fdf4" icon={DollarSign}
          />
          <SummaryCard
            label="Fichiers importés" value={files.length}
            sub={`${pendingCount} en attente de parsing`}
            color="#2563eb" bg="#eff6ff" icon={FileText}
          />
          <SummaryCard
            label="Parsés avec succès" value={parsedCount}
            sub={pendingCount > 0 ? `${pendingCount} restant${pendingCount > 1 ? 's' : ''}` : 'Tous traités ✓'}
            color="#16a34a" bg="#f0fdf4" icon={CheckCircle}
          />
          {pendingCount > 0 && (
            <SummaryCard
              label="En attente" value={pendingCount}
              sub="Cliquez Parser pour extraire"
              color="#f59e0b" bg="#fffbeb" icon={Clock}
            />
          )}
        </div>
      )}

      {/* ── Card principale ── */}
      <div style={{
        background: 'white', borderRadius: 20,
        border: '1px solid #e8edf5', boxShadow: '0 2px 12px rgba(0,0,0,.05)',
        overflow: 'hidden', marginBottom: 24,
      }}>
        {/* Onglets */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e8edf5', paddingLeft: 8 }}>
          <Tab active={tab === 'file'} onClick={() => setTab('file')} icon={Upload} label="Upload fichier" color="#1B5E46" />
          <Tab active={tab === 'api'}  onClick={() => setTab('api')}  icon={Link}   label="Connexion API"  color="#00b3ff" />
        </div>

        {/* ════════════ ONGLET FICHIER ════════════ */}
        {tab === 'file' && (
          <div style={{ padding: '32px 32px 28px' }}>
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2.5px dashed ${dragging ? '#1B5E46' : '#cbd5e1'}`,
                borderRadius: 18, padding: '56px 24px', textAlign: 'center',
                cursor: 'pointer', background: dragging ? '#f0fdf4' : '#fafbfc',
                transition: 'all .2s', marginBottom: 8,
              }}
            >
              <div style={{
                width: 68, height: 68, borderRadius: 20,
                background: dragging ? '#1B5E46' : '#f1f5f9',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 18px', transition: 'all .2s',
              }}>
                <Upload size={30} color={dragging ? 'white' : '#94a3b8'} />
              </div>
              <p style={{ fontSize: 17, fontWeight: 700, color: dragging ? '#1B5E46' : '#374151', marginBottom: 8 }}>
                {uploading ? '⏳ Upload en cours...' : dragging ? '📂 Déposez ici !' : 'Glissez-déposez un fichier'}
              </p>
              <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 20 }}>ou cliquez pour parcourir</p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                {[
                  { e: 'xlsx / xls', i: '📊', l: 'Excel' },
                  { e: 'csv',        i: '📋', l: 'CSV' },
                  { e: 'pdf',        i: '📄', l: 'PDF' },
                ].map(f => (
                  <span key={f.e} style={{
                    fontSize: 12, fontWeight: 600, color: '#64748b',
                    background: 'white', border: '1px solid #e2e8f0',
                    borderRadius: 9, padding: '5px 14px',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}>
                    {f.i} {f.l} <span style={{ color: '#cbd5e1', fontWeight: 400 }}>({f.e})</span>
                  </span>
                ))}
              </div>
              <p style={{ fontSize: 11, color: '#cbd5e1', marginTop: 14 }}>Taille max : 50 MB</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf" style={{ display: 'none' }}
                onChange={e => { if (e.target.files[0]) handleUpload(e.target.files[0]); e.target.value = ''; }} />
            </div>
          </div>
        )}

        {/* ════════════ ONGLET API ════════════ */}
        {tab === 'api' && (
          <div style={{ padding: '28px 32px 28px' }}>

            {/* Bannière info */}
            <div style={{
              background: '#e0f2fe', border: '1px solid #7dd3fc',
              borderRadius: 14, padding: '14px 18px',
              display: 'flex', gap: 12, marginBottom: 28,
            }}>
              <Globe size={18} color="#0284c7" style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#0369a1', marginBottom: 3 }}>
                  Connexion directe à votre API cloud
                </p>
                <p style={{ fontSize: 12, color: '#0284c7', lineHeight: 1.6 }}>
                  Connectez votre plateforme FinOps à OVHcloud, AWS, Azure, GCP ou toute API REST.
                  Le système récupère vos coûts directement depuis la source.
                </p>
              </div>
            </div>

            {/* Étape 1 */}
            <div style={{ marginBottom: 28 }}>
              <StepLabel num="1" text="Choisir la source" />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {API_PRESETS.map(p => (
                  <PresetCard key={p.id} preset={p} selected={selectedPreset === p.id} onClick={() => switchPreset(p.id)} />
                ))}
              </div>
            </div>

            {/* Étape 2 */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <StepLabel num="2" text="Configurer la connexion" />
                {preset?.docsUrl && (
                  <a href={preset.docsUrl} target="_blank" rel="noreferrer"
                    style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>
                    <Info size={13} /> Documentation
                  </a>
                )}
              </div>

              <div style={{ background: '#f8fafc', borderRadius: 16, padding: '22px', border: '1px solid #e2e8f0' }}>
                {preset?.description && (
                  <p style={{
                    fontSize: 12, color: '#64748b', marginBottom: 18,
                    padding: '9px 13px', background: 'white', borderRadius: 9,
                    border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span style={{ fontSize: 16 }}>{preset.icon}</span> {preset.description}
                  </p>
                )}

                {preset?.endpoints?.length > 0 && (
                  <div style={{ marginBottom: 18 }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 8 }}>
                      Endpoints disponibles
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {preset.endpoints.map(ep => {
                        const isActive = apiUrl === ep.value;
                        return (
                          <button key={ep.value} onClick={() => setApiUrl(ep.value)} style={{
                            padding: '7px 14px', borderRadius: 9, fontFamily: 'inherit',
                            border: `1.5px solid ${isActive ? preset.color : '#e2e8f0'}`,
                            background: isActive ? preset.color + '12' : 'white',
                            color: isActive ? preset.color : '#374151',
                            fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .15s',
                          }}>
                            {isActive && '✓ '}{ep.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div style={{ marginBottom: 18 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>
                    URL de l'API <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select value={httpMethod} onChange={e => setHttpMethod(e.target.value)} style={{
                      padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e2e8f0',
                      fontSize: 13, fontFamily: 'inherit', color: '#374151',
                      background: 'white', cursor: 'pointer', flexShrink: 0,
                    }}>
                      <option>GET</option><option>POST</option>
                    </select>
                    <input
                      value={apiUrl} onChange={e => setApiUrl(e.target.value)}
                      placeholder={preset?.urlPlaceholder || 'https://...'}
                      style={{
                        flex: 1, padding: '10px 14px', borderRadius: 10,
                        border: `1.5px solid ${apiUrl ? preset?.color || '#1B5E46' : '#e2e8f0'}`,
                        fontSize: 13, fontFamily: 'inherit', color: '#0f172a',
                        background: 'white', outline: 'none', transition: 'border-color .15s',
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: 14, marginBottom: 14 }}>
                  {preset?.fields.map(f => (
                    <Field
                      key={f.key} label={f.label} type={f.type}
                      placeholder={f.placeholder} hint={f.hint}
                      value={apiFields[f.key] || ''}
                      onChange={v => setApiFields(prev => ({ ...prev, [f.key]: v }))}
                    />
                  ))}
                </div>

                {/* ── OVH-specific block ── */}
                {selectedPreset === 'ovh' && (
                  <>
                    {/* Token generation link */}
                    <div style={{
                      padding: '12px 16px', background: '#e0f2fe', borderRadius: 11,
                      border: '1px solid #7dd3fc', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14,
                    }}>
                      <span style={{ fontSize: 22 }}>🔷</span>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 12, fontWeight: 700, color: '#0369a1', marginBottom: 2 }}>
                          Générer vos clés OVHcloud
                        </p>
                        <p style={{ fontSize: 11, color: '#0284c7' }}>
                          Application Key, Application Secret et Consumer Key nécessaires.
                        </p>
                      </div>
                      <a href="https://eu.api.ovh.com/createToken" target="_blank" rel="noreferrer"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                          background: '#0284c7', color: 'white', borderRadius: 9,
                          fontSize: 12, fontWeight: 700, textDecoration: 'none', flexShrink: 0, whiteSpace: 'nowrap',
                        }}>
                        <Key size={13} /> Créer un token
                      </a>
                    </div>

                    {/* ══ INLINE RESOURCE MONITORING PANEL ══ */}
                    <OVHResourcePanel />

                    {/* ══ IMPORT RESOURCES BUTTON ══ */}
                    <div style={{
                      marginTop: 14, padding: '14px 16px',
                      background: '#f0fdf4', border: '1.5px solid #86efac',
                      borderRadius: 12,
                    }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: '#15803d', marginBottom: 8 }}>
                        🖥️ Importer les métriques de vos serveurs (CPU / RAM / Disque)
                      </p>
                      <p style={{ fontSize: 11, color: '#166534', marginBottom: 12 }}>
                        Récupère les données de monitoring de tous vos VPS et serveurs dédiés OVHcloud.
                      </p>
                      <button
                        onClick={handleImportOvhResources}
                        disabled={importingRes}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '10px 20px', borderRadius: 10,
                          background: importingRes ? '#94a3b8' : '#15803d',
                          color: 'white', border: 'none',
                          fontWeight: 700, fontSize: 13,
                          cursor: importingRes ? 'not-allowed' : 'pointer',
                          fontFamily: 'inherit',
                          boxShadow: importingRes ? 'none' : '0 4px 12px rgba(21,128,61,.3)',
                          transition: 'all .15s',
                        }}
                      >
                        <Server
                          size={15}
                          aria-label={importingRes ? 'Import en cours' : 'Importer les ressources OVHcloud'}
                          style={{ animation: importingRes ? 'spin 1s linear infinite' : 'none' }}
                        />
                        {importingRes ? 'Import en cours…' : 'Importer les ressources OVHcloud'}
                      </button>

                      {importResResult && (
                        <div style={{
                          marginTop: 12, padding: '10px 14px',
                          background: 'white', borderRadius: 9,
                          border: '1px solid #bbf7d0', fontSize: 12,
                        }}>
                          <p style={{ fontWeight: 700, color: '#15803d', marginBottom: 6 }}>
                            ✅ {importResResult.message}
                          </p>
                          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                            <span style={{ color: '#374151' }}>Récupérés : <strong>{importResResult.total_fetched}</strong></span>
                            <span style={{ color: '#16a34a' }}>Importés : <strong>{importResResult.metrics_created}</strong></span>
                            {importResResult.metrics_skipped > 0 && (
                              <span style={{ color: '#d97706' }}>Ignorés : <strong>{importResResult.metrics_skipped}</strong></span>
                            )}
                          </div>
                          {importResResult.errors?.length > 0 && (
                            <div style={{ marginTop: 6, color: '#dc2626', fontSize: 11 }}>
                              {importResResult.errors.map((err, i) => <p key={i}>{err}</p>)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}

                <button onClick={() => setShowAdvanced(s => !s)} style={{
                  display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
                  cursor: 'pointer', fontSize: 12, color: '#64748b', fontFamily: 'inherit', fontWeight: 600,
                  padding: 0, marginTop: selectedPreset === 'ovh' ? 14 : 0,
                }}>
                  {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Options avancées (dates, headers)
                </button>

                {showAdvanced && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 5 }}>Date début</label>
                      <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', color: '#0f172a', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 5 }}>Date fin</label>
                      <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', color: '#0f172a', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ gridColumn: '1/-1' }}>
                      <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 5 }}>
                        Headers additionnels (JSON)
                      </label>
                      <input value={extraHeaders} onChange={e => setExtraHeaders(e.target.value)}
                        placeholder='{"X-Custom-Header": "value"}'
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e2e8f0', fontSize: 12, fontFamily: 'monospace', color: '#0f172a', boxSizing: 'border-box', outline: 'none' }} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Étape 3 */}
            <div style={{ marginBottom: 20 }}>
              <StepLabel num="3" text="Tester & Importer" />
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button onClick={handleTest} disabled={testing || !apiUrl} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '12px 24px',
                  background: testing || !apiUrl ? '#f1f5f9' : 'white',
                  color:      testing || !apiUrl ? '#94a3b8' : '#1B5E46',
                  border: `1.5px solid ${testing || !apiUrl ? '#e2e8f0' : '#1B5E46'}`,
                  borderRadius: 12, fontWeight: 700, fontSize: 14,
                  cursor: testing || !apiUrl ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', transition: 'all .15s',
                }}>
                  <Zap size={16} className={testing ? 'spin' : ''} color={testing || !apiUrl ? '#94a3b8' : '#1B5E46'} />
                  {testing ? 'Test en cours...' : 'Tester la connexion'}
                </button>

                <button onClick={handleApiImport} disabled={importing || !apiUrl} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '12px 28px',
                  background: importing || !apiUrl ? '#94a3b8' : '#00b3ff',
                  color: 'white', border: 'none', borderRadius: 12,
                  fontWeight: 700, fontSize: 14,
                  cursor: importing || !apiUrl ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  boxShadow: importing || !apiUrl ? 'none' : '0 4px 14px rgba(0,179,255,.3)',
                  transition: 'all .15s',
                }}>
                  <Link size={16} className={importing ? 'spin' : ''} />
                  {importing ? 'Import en cours...' : 'Importer les données'}
                </button>
              </div>
            </div>

            {testResult && (
              <div className="fade-in" style={{
                background: testResult.success ? '#f0fdf4' : '#fff5f5',
                border: `1px solid ${testResult.success ? '#86efac' : '#fca5a5'}`,
                borderRadius: 14, padding: '16px 20px', marginBottom: 16,
                display: 'flex', alignItems: 'flex-start', gap: 12,
              }}>
                {testResult.success
                  ? <CheckCircle size={20} color="#16a34a" style={{ flexShrink: 0 }} />
                  : <XCircle    size={20} color="#dc2626" style={{ flexShrink: 0 }} />}
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: testResult.success ? '#15803d' : '#991b1b', marginBottom: 4 }}>
                    {testResult.success ? '✅ Connexion réussie' : '❌ Connexion échouée'}
                  </p>
                  <p style={{ fontSize: 12, color: testResult.success ? '#16a34a' : '#dc2626' }}>{testResult.message}</p>
                  {testResult.records !== undefined && (
                    <p style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                      🔍 <strong>{testResult.records}</strong> enregistrements trouvés
                    </p>
                  )}
                </div>
              </div>
            )}

            {importResult && (
              <div className="fade-in" style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 14, padding: '18px 20px' }}>
                <p style={{ fontSize: 14, fontWeight: 800, color: '#15803d', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={18} color="#16a34a" />
                  Import terminé — {importResult.source_name}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: importResult.errors?.length ? 14 : 0 }}>
                  {[
                    { label: 'Récupérés', value: importResult.total_sent,    color: '#374151' },
                    { label: 'Importés',  value: importResult.costs_created, color: '#16a34a' },
                    { label: 'Ignorés',   value: importResult.costs_skipped, color: importResult.costs_skipped > 0 ? '#d97706' : '#94a3b8' },
                  ].map(s => (
                    <div key={s.label} style={{ background: 'white', borderRadius: 10, padding: '12px', textAlign: 'center', border: '1px solid #dcfce7' }}>
                      <p style={{ fontSize: 26, fontWeight: 900, color: s.color, lineHeight: 1 }}>{s.value}</p>
                      <p style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginTop: 4 }}>{s.label}</p>
                    </div>
                  ))}
                </div>
                {importResult.errors?.length > 0 && (
                  <div style={{ background: '#fff7ed', borderRadius: 10, padding: '10px 14px', border: '1px solid #fed7aa' }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: '#c2410c', marginBottom: 6 }}>
                      ⚠️ {importResult.errors.length} erreur(s)
                    </p>
                    {importResult.errors.map((e, i) => (
                      <p key={i} style={{ fontSize: 11, color: '#7c2d12', marginBottom: 2 }}>• {e}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ════════════ LISTE FICHIERS ════════════ */}
      <div style={{
        background: 'white', borderRadius: 20,
        border: '1px solid #e8edf5', boxShadow: '0 2px 12px rgba(0,0,0,.05)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid #f1f5f9',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Fichiers importés</h2>
            <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
              {files.length} fichier{files.length !== 1 ? 's' : ''}
              {parsedCount > 0 && ` · ${parsedCount} parsé${parsedCount > 1 ? 's' : ''}`}
              {totalCostAll > 0 && ` · ${fmt2(totalCostAll)} € ${totalIsTTC ? 'TTC' : 'HT'} extraits`}
            </p>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>
            <RefreshCw size={28} style={{ opacity: .3, margin: '0 auto 10px', display: 'block' }} className="spin" />
            <p style={{ fontSize: 13 }}>Chargement…</p>
          </div>
        ) : files.length === 0 ? (
          <div style={{ padding: '64px 24px', textAlign: 'center' }}>
            <div style={{
              width: 72, height: 72, borderRadius: 20, background: '#f1f5f9',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 18px',
            }}>
              <FileText size={32} color="#cbd5e1" />
            </div>
            <p style={{ fontSize: 16, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
              Aucun fichier importé
            </p>
            <p style={{ fontSize: 13, color: '#94a3b8' }}>
              Utilisez l'onglet "Upload fichier" ou "Connexion API" pour importer vos données
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #f1f5f9' }}>
                  {['Fichier', 'Format', 'Taille', 'Mois facture', 'Coût extrait', 'Date', 'Actions'].map(h => (
                    <th key={h} style={{
                      padding: '12px 16px', textAlign: 'left',
                      fontSize: 11, fontWeight: 800, color: '#94a3b8',
                      textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {files.map((f, idx) => {
                  const st = normalizeStatus(f.parse_status);
                  const isPending = st !== 'SUCCESS';
                  const costInfo  = getCostInfo(f);
                  const hasCost   = costInfo && costInfo.total > 0;
                  return (
                    <tr key={f.id} style={{
                      background: idx % 2 === 0 ? 'white' : '#fafbfc',
                      borderBottom: '1px solid #f1f5f9',
                      transition: 'background .1s',
                    }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#f0f9ff'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = idx%2===0?'white':'#fafbfc'; }}
                    >
                      {/* FICHIER */}
                      <td style={{ padding: '14px 16px', minWidth: 200 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <FileText size={17} color="#94a3b8" />
                          </div>
                          <div>
                            <span style={{
                              fontSize: 13, fontWeight: 600, color: '#0f172a',
                              maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap', display: 'block',
                            }} title={f.filename}>
                              {f.filename}
                            </span>
                            <StatusBadge status={f.parse_status} />
                          </div>
                        </div>
                      </td>

                      {/* FORMAT */}
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, color: '#2563eb',
                          background: '#eff6ff', padding: '3px 8px',
                          borderRadius: 6, textTransform: 'uppercase',
                        }}>{f.file_format}</span>
                      </td>

                      {/* TAILLE */}
                      <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                        {fmtSize(f.file_size_bytes)}
                      </td>

                      {/* MOIS */}
                      <td style={{ padding: '14px 16px' }}>
                        {(() => {
                          const m = extractInvoiceMonth(f, costInfo);
                          if (!m) return <span style={{ color: '#cbd5e1', fontSize: 13 }}>—</span>;
                          return (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                              fontSize: 12, fontWeight: 700, color: '#2563eb',
                              background: '#eff6ff', padding: '5px 12px', borderRadius: 10,
                              border: '1px solid #bfdbfe',
                            }}>
                              📅 {m.label}
                            </span>
                          );
                        })()}
                      </td>

                      {/* COÛT */}
                      <td style={{ padding: '14px 16px', minWidth: 130 }}>
                        {hasCost ? (
                          <CostBadge file={f} info={costInfo} />
                        ) : isPending ? (
                          <button
                            onClick={() => handleParse(f.id)}
                            disabled={!!parsing[f.id]}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              fontSize: 11, fontWeight: 700,
                              color: '#f59e0b', background: '#fffbeb',
                              border: '1px solid #fcd34d', borderRadius: 8,
                              padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >
                            <Play size={10} /> Parser
                          </button>
                        ) : (
                          <span style={{ fontSize: 11, color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <AlertCircle size={11} /> Aucun coût
                          </span>
                        )}
                      </td>

                      {/* DATE */}
                      <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                        {fmtDate(f.created_at)}
                      </td>

                      {/* ACTIONS */}
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {normalizeStatus(f.parse_status) !== 'SUCCESS' && (
                            <button
                              onClick={() => handleParse(f.id)}
                              disabled={!!parsing[f.id]}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 5,
                                padding: '6px 14px',
                                background: parsing[f.id] ? '#f8fafc' : '#f0fdf4',
                                border: `1px solid ${parsing[f.id] ? '#e2e8f0' : '#86efac'}`,
                                borderRadius: 8,
                                cursor: parsing[f.id] ? 'not-allowed' : 'pointer',
                                fontSize: 12, fontWeight: 700,
                                color: parsing[f.id] ? '#94a3b8' : '#16a34a',
                                fontFamily: 'inherit', opacity: parsing[f.id] ? .6 : 1, transition: 'all .15s',
                              }}
                            >
                              {parsing[f.id] ? <RefreshCw size={12} className="spin" /> : <Play size={12} />}
                              {parsing[f.id] ? 'Parsing...' : 'Parser'}
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(f.id, f.filename)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 5,
                              padding: '6px 12px',
                              background: '#fff5f5', border: '1px solid #fca5a5',
                              borderRadius: 8, cursor: 'pointer',
                              fontSize: 12, fontWeight: 700, color: '#dc2626', fontFamily: 'inherit',
                              transition: 'all .15s',
                            }}
                          >
                            <Trash2 size={12} /> Suppr.
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {totalCostAll > 0 && (
                <tfoot>
                  <tr style={{ background: '#f0fdf4', borderTop: '2px solid #bbf7d0' }}>
                    <td colSpan={4} style={{ padding: '12px 16px', fontSize: 12, fontWeight: 800, color: '#1B5E46', textAlign: 'right' }}>
                      TOTAL EXTRAIT
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 16, fontWeight: 900, color: '#1B5E46', letterSpacing: '-0.5px' }}>
                        {fmt2(totalCostAll)} € {totalIsTTC ? 'TTC' : 'HT'}
                      </span>
                    </td>
                    <td colSpan={2} style={{ padding: '12px 16px', fontSize: 11, color: '#64748b' }}>
                      {files.reduce((s, f) => { const info = getCostInfo(f); return s + (info ? info.count : 0); }, 0)} lignes de coût
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
