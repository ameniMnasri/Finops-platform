// ResourceDashboard.jsx — Enhanced FinOps Dashboard with Rightsizing + Dates
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Server, Search, RefreshCw, Zap, Activity,
  ChevronUp, ChevronDown, Cpu, HardDrive, MemoryStick,
  AlertTriangle, AlertCircle, CheckCircle, DollarSign,
  TrendingDown, TrendingUp, Layers, Eye, Target, Calendar,
  ArrowDownCircle, ArrowUpCircle, Clock, Repeat,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, PieChart, Pie,
} from 'recharts';
import Header  from '../Layout/Header';
import Sidebar from '../Layout/Sidebar';
import api from '../../services/api';

// ─── Category detection ────────────────────────────────────────────────────
function detectServerCategory(name) {
  if (!name) return 'VPS';
  const n = name.toUpperCase();
  if (/^NS\d+\.(IP-[\d-]+\.(EU|NET)|OVH\.NET)$/i.test(name)) return 'Dedicated';
  if (/^VPS/i.test(name)) return 'VPS';
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
  if (avgCpu === null || peakCpu === null) return 'underutilized';
  if (avgCpu < 10 && peakCpu < 20) return 'underutilized';
  if (avgCpu > 75 || peakCpu > 90) return 'critical';
  return 'optimized';
}

// ─── Fuzzy key for cost matching ──────────────────────────────────────────
function fuzzyKey(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
}

// ─── Rightsizing logic ─────────────────────────────────────────────────────
// Returns a concrete rightsizing recommendation with tier suggestion and savings
function computeRightsizing(server) {
  const { avgCpu, peakCpu, avgRam, peakRam, invoiceRamGb, avgDisk, invoiceDiskGb, monthlyCost, status, type } = server;

  // OVH VPS tiers (RAM GB → typical monthly €)
  const VPS_TIERS = [
    { ram: 2,   disk: 20,  price: 3.99,  label: 'VPS Starter 2GB' },
    { ram: 4,   disk: 40,  price: 7.49,  label: 'VPS Value 4GB' },
    { ram: 8,   disk: 80,  price: 13.99, label: 'VPS Essential 8GB' },
    { ram: 16,  disk: 160, price: 26.99, label: 'VPS Comfort 16GB' },
    { ram: 32,  disk: 320, price: 52.99, label: 'VPS Elite 32GB' },
  ];

  const DEDICATED_TIERS = [
    { ram: 16,  price: 45,  label: 'KS-1 / Kimsufi 16GB' },
    { ram: 32,  price: 70,  label: 'RISE-1 32GB' },
    { ram: 64,  price: 110, label: 'ADVANCE-1 64GB' },
    { ram: 128, price: 170, label: 'ADVANCE-4 128GB' },
    { ram: 256, price: 280, label: 'SCALE-3 256GB' },
  ];

  const tiers = type === 'VPS' ? VPS_TIERS : DEDICATED_TIERS;
  const currentRam = invoiceRamGb || peakRam || 0;
  const currentDisk = invoiceDiskGb || peakRam || 0;

  let recommendation = null;
  let savingsEst = null;
  let targetLabel = null;
  let targetRam = null;
  let reason = null;

  if (status === 'underutilized' && currentRam > 0) {
    // Find the smallest tier that still covers actual usage (with 20% headroom)
    const neededRam = Math.max((avgRam || 0) * 1.2, (peakRam || 0) * 1.1, 2);
    const neededDisk = Math.max((avgDisk || 0) * 1.15, 20);
    const suitable = tiers.filter(t => t.ram >= neededRam && (t.disk === undefined || t.disk >= neededDisk));
    const best = suitable.length > 0 ? suitable[0] : null;

    if (best && best.ram < currentRam) {
      targetLabel = best.label;
      targetRam = best.ram;
      if (monthlyCost && best.price) {
        savingsEst = Math.max(0, monthlyCost - best.price);
      }
      reason = `CPU moy ${avgCpu !== null ? avgCpu.toFixed(1) + '%' : 'N/A'}, RAM utilisée ${avgRam > 0 ? avgRam.toFixed(1) + ' GB' : 'N/A'} sur ${currentRam} GB provisionné`;
      recommendation = 'downsize';
    }
  } else if (status === 'critical') {
    const neededRam = (peakRam || currentRam) * 1.5;
    const suitable = tiers.filter(t => t.ram >= neededRam);
    const best = suitable.length > 0 ? suitable[0] : null;
    if (best) {
      targetLabel = best.label;
      targetRam = best.ram;
      if (monthlyCost && best.price) {
        savingsEst = best.price - monthlyCost; // cost increase
      }
      reason = `CPU picm ${peakCpu !== null ? peakCpu.toFixed(1) + '%' : 'N/A'} — risque de saturation`;
      recommendation = 'upsize';
    }
  }

  return { recommendation, targetLabel, targetRam, savingsEst, reason, currentRam };
}

// ─── Real API service ──────────────────────────────────────────────────────
const resourcesService = {
  getAllServersSummary: async (startDate, endDate) => {
    const params = {};
    if (startDate) params.start_date = startDate;
    if (endDate)   params.end_date   = endDate;
    const res = await api.get('/resources/servers/summary/all', { params });
    return Array.isArray(res.data) ? res.data : [];
  },
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

// ─── Costs API ────────────────────────────────────────────────────────────
const costsService = {
  getAllCosts: async () => {
    const res = await api.get('/costs', { params: { skip: 0, limit: 5000 } });
    return Array.isArray(res.data) ? res.data : [];
  },
};

// ─── OVHcloud service info API ────────────────────────────────────────────
// Fetches creation/expiration dates from OVHcloud API via your backend proxy
const ovhService = {
  getServerInfo: async (serverName) => {
    try {
      // Tries /ovh/server/:name — your backend should proxy OVH GET /vps/{serviceName} or /dedicated/server/{serviceName}
      const res = await api.get(`/ovh/server/${encodeURIComponent(serverName)}`);
      return res.data || null;
    } catch {
      return null;
    }
  },
  // Batch fetch for all servers (optional endpoint)
  getAllServersInfo: async () => {
    try {
      const res = await api.get('/ovh/servers/info');
      return Array.isArray(res.data) ? res.data : [];
    } catch {
      return [];
    }
  },
};

// ─── Build server list ────────────────────────────────────────────────────
function buildServerList(summaries) {
  return (summaries || [])
    .filter(s => s.server_name)
    .map(s => {
      const avgCpu   = s.avg_cpu  ?? null;
      const peakCpu  = s.peak_cpu ?? null;
      const avgRam   = s.avg_ram  ?? 0;
      const peakRam  = s.peak_ram ?? 0;
      const avgDisk  = s.avg_disk ?? 0;
      const peakDisk = s.peak_disk ?? 0;
      const apiType = (s.server_type || '').toUpperCase();
      const type = apiType === 'DEDICATED' ? 'Dedicated'
                 : apiType === 'VPS'       ? 'VPS'
                 : detectServerCategory(s.server_name);
      // OVH lifecycle dates — already stored in DB during /import-ovh-metrics
      // summary API returns them directly: no separate OVH API call needed
      const creationDate   = s.creation_date   ? new Date(s.creation_date)   : null;
      const expirationDate = s.expiration_date ? new Date(s.expiration_date) : null;

      return {
        id:             `srv-${s.server_name.replace(/\s+/g, '-')}`,
        name:           s.server_name,
        type,
        avgCpu, peakCpu, avgRam, peakRam, avgDisk, peakDisk,
        records:        s.total_records ?? 0,
        hasRealData:    (s.total_records ?? 0) > 0,
        ramSource:      s.ram_source       || 'none',
        diskSource:     s.disk_source      || 'none',
        invoiceRamGb:   s.invoice_ram_gb   ?? null,
        invoiceDiskGb:  s.invoice_disk_gb  ?? null,
        cpuCores:       s.cpu_cores        ?? null,
        cpuSource:      s.cpu_source       || 'none',
        ovhState:       s.ovh_state        ?? null,
        ovhOffer:       s.ovh_offer        ?? null,
        status:         calculateStatus(avgCpu, peakCpu),
        // ── OVH real dates (from /serviceInfos, persisted during OVH import) ──
        creationDate,
        renewalDate:      expirationDate,   // OVH "expiration" = renewal deadline
        expirationDate,
        // invoice dates enriched later in enrichServersWithCosts
        firstInvoiceDate: null,
        lastInvoiceDate:  null,
      };
    });
}

// ─── Build cost map: reference → monthly cost + dates ─────────────────────
function buildCostMap(costs) {
  const refMap = {};
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  costs.forEach(c => {
    const ref = (c.reference || c.resource_id || c.external_id || '').replace(/\s+/g, '');
    if (!ref) return;
    const fk = fuzzyKey(ref);
    if (!fk) return;
    const amount = Number(c.amount || 0);
    if (!refMap[fk]) refMap[fk] = {
      total: 0, monthly: {}, displayRef: ref,
      allDates: [],
      creationDate: c.creation_date || null,
      renewalDate:  c.renewal_date  || c.expiration_date || null,
    };
    refMap[fk].total += amount;

    // Collect all invoice dates
    if (c.cost_date) {
      const d = new Date(c.cost_date);
      if (!isNaN(d)) {
        refMap[fk].allDates.push(d);
        const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        refMap[fk].monthly[month] = (refMap[fk].monthly[month] || 0) + amount;
      }
    }

    // Prefer explicit creation/renewal dates from cost record if available
    if (!refMap[fk].creationDate && (c.creation_date || c.service_start_date)) {
      refMap[fk].creationDate = c.creation_date || c.service_start_date;
    }
    if (!refMap[fk].renewalDate && (c.renewal_date || c.expiration_date || c.next_billing_date)) {
      refMap[fk].renewalDate = c.renewal_date || c.expiration_date || c.next_billing_date;
    }
  });

  const result = {};
  for (const [fk, data] of Object.entries(refMap)) {
    const months = Object.entries(data.monthly).sort(([a], [b]) => b.localeCompare(a));
    const latestMonthCost = months.length > 0 ? months[0][1] : data.total;
    const latestMonth     = months.length > 0 ? months[0][0] : null;

    // Derive first/last invoice date from collected dates
    const sortedDates = data.allDates.sort((a, b) => a - b);
    const firstInvoice = sortedDates.length > 0 ? sortedDates[0]  : null;
    const lastInvoice  = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : null;

    result[fk] = {
      monthlyAmount:    latestMonthCost,
      totalAmount:      data.total,
      latestMonth,
      displayRef:       data.displayRef,
      creationDate:     data.creationDate,
      renewalDate:      data.renewalDate,
      firstInvoiceDate: firstInvoice,
      lastInvoiceDate:  lastInvoice,
    };
  }
  return result;
}

// ─── Attach costs + dates to servers ──────────────────────────────────────
function enrichServersWithCosts(servers, costMap) {
  return servers.map(srv => {
    const fk = fuzzyKey(srv.name);
    const costData = costMap[fk] || null;
    return {
      ...srv,
      monthlyCost:      costData?.monthlyAmount    ?? null,
      totalCost:        costData?.totalAmount      ?? null,
      costMonth:        costData?.latestMonth      ?? null,
      // Only use invoice dates as fallback — never overwrite real OVH dates
      creationDate:     srv.creationDate     || costData?.creationDate     || null,
      renewalDate:      srv.renewalDate      || costData?.renewalDate      || null,
      firstInvoiceDate: costData?.firstInvoiceDate ?? null,
      lastInvoiceDate:  costData?.lastInvoiceDate  ?? null,
    };
  });
}

// ─── Attach OVH info (creation/expiration) to servers ─────────────────────
function enrichServersWithOvhInfo(servers, ovhInfoList) {
  if (!ovhInfoList || ovhInfoList.length === 0) return servers;
  const ovhMap = {};
  ovhInfoList.forEach(info => {
    const key = fuzzyKey(info.serviceName || info.name || '');
    if (key) ovhMap[key] = info;
  });

  return servers.map(srv => {
    const key = fuzzyKey(srv.name);
    const ovh = ovhMap[key] || null;
    if (!ovh) return srv;

    // OVH API fields: creation → 'creationDate', expiration → 'expiration' or 'renewalDate'
    return {
      ...srv,
      creationDate:   srv.creationDate   || ovh.creationDate   || ovh.creation_date   || null,
      renewalDate:    srv.renewalDate    || ovh.expiration      || ovh.renewalDate     || ovh.renewal_date     || null,
      expirationDate: ovh.expiration     || ovh.expirationDate  || null,
      ovhState:       ovh.state          || null,
      ovhOffer:       ovh.offer          || ovh.currentRange    || null,
    };
  });
}

// ─── Generate summary stats ────────────────────────────────────────────────
function generateSummary(servers) {
  const real = servers.filter(s => s.hasRealData);
  const withRam  = servers.filter(s => s.avgRam  > 0);
  const withDisk = servers.filter(s => s.avgDisk > 0);
  const withCost = servers.filter(s => s.monthlyCost !== null);
  return {
    total:         servers.length,
    optimized:     servers.filter(s => s.status === 'optimized').length,
    underutilized: servers.filter(s => s.status === 'underutilized').length,
    critical:      servers.filter(s => s.status === 'critical').length,
    avgCpu:  (() => { const c = real.filter(x => x.avgCpu !== null); return c.length > 0 ? c.reduce((s,x) => s + x.avgCpu, 0) / c.length : null; })(),
    avgRam:  withRam.length  > 0 ? withRam.reduce((s,x)  => s + x.avgRam,  0) / withRam.length  : 0,
    avgDisk: withDisk.length > 0 ? withDisk.reduce((s,x) => s + x.avgDisk, 0) / withDisk.length : 0,
    totalMonthlyCost: withCost.reduce((s, x) => s + (x.monthlyCost || 0), 0),
    serversWithCost:  withCost.length,
  };
}

// ─── Formatters ────────────────────────────────────────────────────────────
const fmtEuro = v => Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = d => {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date)) return '—';
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtDateShort = d => {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date)) return '—';
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
};
const daysUntil = d => {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date)) return null;
  return Math.ceil((date - new Date()) / (1000 * 60 * 60 * 24));
};

// ─── Design tokens ─────────────────────────────────────────────────────────
const T = {
  green:    '#0E7A50',
  greenBg:  '#ECFDF5',
  blue:     '#1D4ED8',
  blueBg:   '#EFF6FF',
  purple:   '#7C3AED',
  purpleBg: '#F5F3FF',
  amber:    '#B45309',
  amberBg:  '#FFFBEB',
  red:      '#DC2626',
  redBg:    '#FEF2F2',
  slate:    '#0F172A',
  muted:    '#64748B',
  border:   '#E2E8F0',
  bg:       '#F8FAFC',
};

// ─── SummaryCard ───────────────────────────────────────────────────────────
function SummaryCard({ label, value, sub, accentColor, bgColor, icon: Icon, trend, badge }) {
  return (
    <div style={{
      flex: '1 1 180px',
      background: 'white',
      border: `1px solid ${T.border}`,
      borderRadius: 16,
      padding: '20px 22px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 14,
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      position: 'relative',
      overflow: 'hidden',
      transition: 'transform .15s, box-shadow .15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 24px rgba(0,0,0,0.10)`; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)'; }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accentColor, borderRadius: '16px 16px 0 0' }} />
      <div style={{ position: 'absolute', right: -20, bottom: -20, width: 90, height: 90, borderRadius: '50%', background: bgColor, opacity: 0.8 }} />
      <div style={{ width: 44, height: 44, borderRadius: 12, background: accentColor, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 12px ${accentColor}55`, position: 'relative' }}>
        <Icon size={20} color="white" />
      </div>
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <p style={{ fontSize: 10, fontWeight: 800, color: T.muted, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 4 }}>{label}</p>
        <p style={{ fontSize: 26, fontWeight: 900, color: T.slate, lineHeight: 1, letterSpacing: '-0.5px', marginBottom: 4 }}>{value}</p>
        {sub && <p style={{ fontSize: 11, color: T.muted }}>{sub}</p>}
        {badge && <span style={{ display: 'inline-block', marginTop: 6, padding: '2px 8px', borderRadius: 99, background: bgColor, color: accentColor, fontSize: 10, fontWeight: 700, border: `1px solid ${accentColor}33` }}>{badge}</span>}
        {trend !== undefined && (
          <p style={{ fontSize: 11, color: trend > 0 ? T.red : T.green, fontWeight: 700, marginTop: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
            {trend > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {Math.abs(trend).toFixed(1)}%
          </p>
        )}
      </div>
    </div>
  );
}

// ─── CpuBar ────────────────────────────────────────────────────────────────
function CpuBar({ value, peak, cpuCores, cpuSource }) {
  if (value === null || value === undefined) {
    if (cpuCores && cpuSource === 'hw_specs') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: T.blueBg, color: T.blue, border: `1px solid #93c5fd` }}>
            🖥️ {cpuCores}c
          </span>
          <span style={{ fontSize: 10, color: '#94a3b8' }}>cores (hw-spec)</span>
        </div>
      );
    }
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: '#f1f5f9', color: '#94a3b8', border: '1px dashed #cbd5e1' }}>
        N/A
      </span>
    );
  }
  const color = value < 10 ? '#f59e0b' : value > 85 ? T.red : '#16a34a';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ fontWeight: 800, color }}>{value.toFixed(1)}%</span>
        <span style={{ color: '#94a3b8', fontSize: 11 }}>pk {peak !== null ? peak.toFixed(1) + '%' : 'N/A'}</span>
      </div>
      <div style={{ height: 5, borderRadius: 99, background: '#f1f5f9', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 99, width: `${Math.min(value, 100)}%`, background: color, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}

// ─── CostCell ────────────────────────────────────────────────────────────
function CostCell({ monthlyCost, status }) {
  if (monthlyCost === null || monthlyCost === undefined) {
    return <span style={{ fontSize: 11, color: '#cbd5e1', fontStyle: 'italic' }}>—</span>;
  }
  const isWasteful = status === 'underutilized';
  const isCritical = status === 'critical';
  const textColor = isCritical ? T.red : isWasteful ? T.amber : T.green;
  const bgColor   = isCritical ? T.redBg : isWasteful ? T.amberBg : T.greenBg;
  const borderColor = isCritical ? '#fca5a5' : isWasteful ? '#fcd34d' : '#6ee7b7';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8, fontSize: 13, fontWeight: 800, color: textColor, background: bgColor, border: `1px solid ${borderColor}`, whiteSpace: 'nowrap' }}>
        {fmtEuro(monthlyCost)} €
      </span>
      {isWasteful && <span style={{ fontSize: 10, color: T.amber, fontWeight: 600, paddingLeft: 2 }}>⚠ coût gaspillé</span>}
    </div>
  );
}

// ─── NoDataBadge ──────────────────────────────────────────────────────────
function NoDataBadge() {
  return <span style={{ fontSize: 11, color: '#94a3b8', background: '#f8fafc', padding: '2px 8px', borderRadius: 6, border: '1px dashed #e2e8f0' }}>—</span>;
}

// ─── DateCell — shows creation + renewal dates ─────────────────────────────
function DateCell({ server }) {
  const { creationDate, renewalDate, expirationDate, firstInvoiceDate, lastInvoiceDate, ovhState } = server;

  // Priority: OVH API real date > invoice-derived date
  const effectiveCreation = creationDate || firstInvoiceDate;
  const effectiveRenewal  = renewalDate  || expirationDate;
  const isOvhDate         = !!creationDate;   // true = from OVH /serviceInfos, not an invoice estimate

  const daysLeft = daysUntil(effectiveRenewal);
  const renewalColor = daysLeft !== null
    ? daysLeft < 7  ? T.red
    : daysLeft < 30 ? T.amber
    : T.green
    : T.muted;

  if (!effectiveCreation && !effectiveRenewal) {
    return <span style={{ fontSize: 11, color: '#cbd5e1', fontStyle: 'italic' }}>—</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {effectiveCreation && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Calendar size={10} color="#94a3b8" />
          <span style={{ fontSize: 10, color: '#94a3b8' }}>Créé</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.slate }}>{fmtDateShort(effectiveCreation)}</span>
          {isOvhDate ? (
            <span style={{ fontSize: 9, color: '#0073d1', fontWeight: 700, background: '#e0f2fe', padding: '1px 4px', borderRadius: 3 }} title="Date exacte OVH API">OVH</span>
          ) : (
            <span style={{ fontSize: 9, color: '#cbd5e1' }} title="Date déduite de la première facture">≈facture</span>
          )}
        </div>
      )}
      {effectiveRenewal && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Repeat size={10} color={renewalColor} />
          <span style={{ fontSize: 10, color: '#94a3b8' }}>Renouv.</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: renewalColor }}>{fmtDateShort(effectiveRenewal)}</span>
          {daysLeft !== null && (
            <span style={{ fontSize: 9, fontWeight: 700, color: renewalColor, background: renewalColor + '15', padding: '1px 5px', borderRadius: 4 }}>
              {daysLeft > 0 ? `J-${daysLeft}` : `Expiré`}
            </span>
          )}
        </div>
      )}
      {ovhState && ovhState !== 'ok' && (
        <span style={{ fontSize: 9, color: T.amber, fontWeight: 700 }}>⚠ {ovhState}</span>
      )}
    </div>
  );
}

// ─── RightsizingCell — concrete recommendation ─────────────────────────────
function RightsizingCell({ server }) {
  const rs = computeRightsizing(server);

  if (!rs.recommendation) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 99, fontSize: 12, fontWeight: 700, background: T.greenBg, color: T.green, border: '1px solid #6ee7b7' }}>
        ✓ Optimal
      </span>
    );
  }

  if (rs.recommendation === 'downsize') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 99, fontSize: 12, fontWeight: 700, background: T.amberBg, color: T.amber, border: '1px solid #fcd34d', whiteSpace: 'nowrap' }}>
          <ArrowDownCircle size={13} /> Downsize
        </span>
        {rs.targetLabel && (
          <span style={{ fontSize: 10, color: T.amber, fontWeight: 600, paddingLeft: 2 }}>→ {rs.targetLabel}</span>
        )}
        {rs.savingsEst > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, color: T.green, background: T.greenBg, border: '1px solid #6ee7b7', borderRadius: 6, padding: '1px 6px', display: 'inline-block' }}>
            💰 Éco. ~{fmtEuro(rs.savingsEst)} €/mois
          </span>
        )}
        {rs.reason && (
          <span style={{ fontSize: 9, color: '#94a3b8', maxWidth: 180, lineHeight: 1.3, display: 'block' }}>{rs.reason}</span>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 99, fontSize: 12, fontWeight: 700, background: T.redBg, color: T.red, border: '1px solid #fca5a5', whiteSpace: 'nowrap' }}>
        <ArrowUpCircle size={13} /> Upsize requis
      </span>
      {rs.targetLabel && (
        <span style={{ fontSize: 10, color: T.red, fontWeight: 600, paddingLeft: 2 }}>→ {rs.targetLabel}</span>
      )}
      {rs.reason && (
        <span style={{ fontSize: 9, color: '#94a3b8', maxWidth: 180, lineHeight: 1.3, display: 'block' }}>{rs.reason}</span>
      )}
    </div>
  );
}

// ─── ServerTable ──────────────────────────────────────────────────────────
function ServerTable({ servers, loading, onServerSelect }) {
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  const handleSort = key => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sorted = useMemo(() => {
    return [...servers].sort((a, b) => {
      let va = a[sortKey] ?? '';
      let vb = b[sortKey] ?? '';
      if (sortKey === 'monthlyCost') { va = va ?? -1; vb = vb ?? -1; }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [servers, sortKey, sortDir]);

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <ChevronUp size={11} style={{ opacity: 0.3 }} />;
    return sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />;
  };

  const thStyle = col => ({
    padding: '13px 12px', textAlign: 'left', fontSize: 10, fontWeight: 800,
    color: sortKey === col ? T.green : '#94a3b8',
    textTransform: 'uppercase', letterSpacing: '.08em',
    cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
    background: '#F8FAFC',
  });

  return (
    <div style={{ overflowX: 'auto', background: 'white' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1560 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #F1F5F9' }}>
            <th style={thStyle('name')} onClick={() => handleSort('name')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Server size={12} /> Serveur <SortIcon col="name" /></div>
            </th>
            <th style={{ ...thStyle('type'), cursor: 'default' }}>Type</th>
            <th style={thStyle('avgCpu')} onClick={() => handleSort('avgCpu')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Cpu size={12} /> CPU moy. <SortIcon col="avgCpu" /></div>
            </th>
            <th style={thStyle('avgRam')} onClick={() => handleSort('avgRam')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><MemoryStick size={12} /> RAM moy. <SortIcon col="avgRam" /></div>
            </th>
            <th style={thStyle('avgDisk')} onClick={() => handleSort('avgDisk')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><HardDrive size={12} /> Disque moy. <SortIcon col="avgDisk" /></div>
            </th>
            <th style={thStyle('monthlyCost')} onClick={() => handleSort('monthlyCost')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><DollarSign size={12} /> Coût / mois <SortIcon col="monthlyCost" /></div>
            </th>
            {/* NEW: Dates column */}
            <th style={{ ...thStyle('creationDate'), cursor: 'default', minWidth: 150 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Calendar size={12} /> Dates</div>
            </th>
            <th style={{ ...thStyle('ramSource'), cursor: 'default', minWidth: 120 }}>Source</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={8} style={{ padding: 60, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
                <div style={{ display: 'inline-block', width: 24, height: 24, border: '3px solid #e2e8f0', borderTopColor: T.green, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <p style={{ marginTop: 12 }}>Chargement des serveurs...</p>
              </td>
            </tr>
          )}
          {!loading && sorted.length === 0 && (
            <tr>
              <td colSpan={8} style={{ padding: 60, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
                <Server size={48} style={{ opacity: 0.15, margin: '0 auto 16px', display: 'block' }} />
                Aucun serveur trouvé
              </td>
            </tr>
          )}
          {!loading && sorted.map((s, i) => {
            const isOdd = i % 2 === 0;
            const rs = computeRightsizing(s);
            return (
              <tr
                key={s.id}
                style={{ borderBottom: '1px solid #F8FAFC', background: isOdd ? 'white' : '#FAFBFC', cursor: 'pointer', transition: 'background .1s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F0FDF8'; }}
                onMouseLeave={e => { e.currentTarget.style.background = isOdd ? 'white' : '#FAFBFC'; }}
                onClick={() => onServerSelect(s)}
              >
                {/* SERVER NAME */}
                <td style={{ padding: '14px 12px' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: T.slate, marginBottom: 2 }}>
                    {s.name.replace(/\.ovh\.net|\.vps\.ovh\.net/gi, '')}
                    <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>.ovh.net</span>
                  </div>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>
                    {s.records > 0 ? `${s.records} enregistrements` : '0 enregistrements'}
                  </span>
                  {s.ovhOffer && (
                    <div style={{ marginTop: 2 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: T.blue, background: T.blueBg, padding: '1px 6px', borderRadius: 4, border: `1px solid #bfdbfe` }}>
                        {s.ovhOffer}
                      </span>
                    </div>
                  )}
                </td>

                {/* TYPE */}
                <td style={{ padding: '14px 12px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: s.type === 'VPS' ? T.purpleBg : T.blueBg, color: s.type === 'VPS' ? T.purple : T.blue, border: `1px solid ${s.type === 'VPS' ? '#c4b5fd' : '#93c5fd'}` }}>
                    {s.type === 'VPS' ? '🖥️' : '🗄️'} {s.type}
                  </span>
                </td>

                {/* CPU */}
                <td style={{ padding: '14px 12px', minWidth: 130 }}>
                  <CpuBar value={s.avgCpu} peak={s.peakCpu} cpuCores={s.cpuCores} cpuSource={s.cpuSource} />
                </td>

                {/* RAM */}
                <td style={{ padding: '14px 12px' }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: T.slate }}>
                    {s.avgRam > 0 ? (
                      <>{s.avgRam.toFixed(1)} <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>GB</span></>
                    ) : <NoDataBadge />}
                  </div>
                  {s.avgRam > 0 && (
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                      {s.ramSource === 'invoice'
                        ? <span style={{ color: T.amber, fontWeight: 600 }}>📄 capacité facture</span>
                        : s.invoiceRamGb
                          ? <>cap <strong style={{ color: T.green }}>{s.invoiceRamGb.toFixed(0)} GB</strong></>
                          : <>cap <strong style={{ color: '#64748b' }}>{s.peakRam.toFixed(0)} GB</strong></>}
                    </div>
                  )}
                </td>

                {/* DISK */}
                <td style={{ padding: '14px 12px' }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: T.slate }}>
                    {s.avgDisk > 0 ? (
                      <>{s.avgDisk.toFixed(1)} <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>GB</span></>
                    ) : <NoDataBadge />}
                  </div>
                  {s.avgDisk > 0 && (
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                      {s.diskSource === 'invoice'
                        ? <span style={{ color: T.amber, fontWeight: 600 }}>📄 capacité facture</span>
                        : s.invoiceDiskGb
                          ? <>cap <strong style={{ color: T.green }}>{s.invoiceDiskGb.toFixed(0)} GB</strong></>
                          : <>cap <strong style={{ color: '#64748b' }}>{s.peakDisk.toFixed(0)} GB</strong></>}
                    </div>
                  )}
                </td>

                {/* COST */}
                <td style={{ padding: '14px 12px', minWidth: 140 }}>
                  <CostCell monthlyCost={s.monthlyCost} status={s.status} />
                </td>

                {/* DATES — NEW */}
                <td style={{ padding: '14px 12px', minWidth: 150 }}>
                  <DateCell server={s} />
                </td>

                {/* SOURCE */}
                <td style={{ padding: '14px 12px' }}>
                  {(() => {
                    const isOvh      = s.hasRealData;
                    const hasInvoice = s.invoiceRamGb !== null || s.invoiceDiskGb !== null;
                    const invoiceOnly= !isOvh && (s.ramSource === 'invoice' || s.diskSource === 'invoice');
                    const isMixed    = isOvh && hasInvoice;
                    const badge = (txt, color, bg, border) => (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, fontSize: 10, fontWeight: 700, background: bg, color, border: `1px solid ${border}`, whiteSpace: 'nowrap' }}>
                        {txt}
                      </span>
                    );
                    if (isMixed) return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {badge('🔷 OVHcloud', '#0073d1', '#e0f2fe', '#7dd3fc')}
                        {badge('📄 Facture', T.amber, T.amberBg, '#fcd34d')}
                      </div>
                    );
                    if (invoiceOnly) return badge('📄 Facture', T.amber, T.amberBg, '#fcd34d');
                    if (isOvh)       return badge('🔷 OVHcloud', '#0073d1', '#e0f2fe', '#7dd3fc');
                    return <span style={{ fontSize: 11, color: '#cbd5e1' }}>—</span>;
                  })()}
                </td>

                {/* RIGHTSIZING — removed */}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── ResourceChart ────────────────────────────────────────────────────────
function ResourceChart({ data, metricKey, label, unit, color }) {
  const chartData = data.map(d => ({
    time: new Date(d.recorded_at).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }),
    value: d[metricKey] ?? 0,
  }));
  return (
    <div style={{ background: 'white', borderRadius: 16, border: `1px solid ${T.border}`, padding: '20px 24px', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
      <h3 style={{ fontSize: 13, fontWeight: 800, color: T.slate, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
        {label} <span style={{ color: T.muted, fontWeight: 400 }}>({unit})</span>
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
          <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#94a3b8' }} />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} unit={` ${unit}`} />
          <Tooltip contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.15)', fontSize: 12 }} />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── RightsizingInsights — dedicated tab panel ────────────────────────────
function RightsizingInsights({ servers }) {
  const rightsizable = useMemo(() => {
    return servers
      .map(s => ({ ...s, _rs: computeRightsizing(s) }))
      .filter(s => s._rs.recommendation !== null)
      .sort((a, b) => (b._rs.savingsEst || 0) - (a._rs.savingsEst || 0));
  }, [servers]);

  const totalSavings = useMemo(
    () => rightsizable.filter(s => s._rs.recommendation === 'downsize').reduce((sum, s) => sum + (s._rs.savingsEst || 0), 0),
    [rightsizable]
  );

  const downsizeList = rightsizable.filter(s => s._rs.recommendation === 'downsize');
  const upsizeList   = rightsizable.filter(s => s._rs.recommendation === 'upsize');

  if (servers.length === 0) {
    return (
      <div style={{ background: 'white', borderRadius: 16, padding: 60, textAlign: 'center', color: '#94a3b8', border: `1px solid ${T.border}` }}>
        <Target size={48} style={{ opacity: 0.2, margin: '0 auto 16px', display: 'block' }} />
        <p style={{ fontSize: 15, fontWeight: 700, color: '#374151' }}>Aucun serveur chargé</p>
      </div>
    );
  }

  const RightsizingRow = ({ s, idx }) => {
    const rs = s._rs;
    const isDown = rs.recommendation === 'downsize';
    const accentColor = isDown ? T.amber : T.red;
    const bg = isDown ? T.amberBg : T.redBg;
    const border = isDown ? '#fcd34d' : '#fca5a5';
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '16px 20px', borderBottom: `1px solid ${T.border}`, background: idx % 2 === 0 ? 'white' : '#FAFBFC' }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', width: 24, paddingTop: 2, textAlign: 'center', flexShrink: 0 }}>{idx + 1}</span>

        {/* Server info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: T.slate }}>
              {s.name.replace(/\.ovh\.net|\.vps\.ovh\.net/gi, '')}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: s.type === 'VPS' ? T.purpleBg : T.blueBg, color: s.type === 'VPS' ? T.purple : T.blue, border: `1px solid ${s.type === 'VPS' ? '#c4b5fd' : '#93c5fd'}` }}>
              {s.type}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: bg, color: accentColor, border: `1px solid ${border}` }}>
              {isDown ? <ArrowDownCircle size={12} /> : <ArrowUpCircle size={12} />}
              {isDown ? 'Downsize' : 'Upsize requis'}
            </span>
          </div>

          {/* Metrics */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: T.muted }}>
              <span style={{ fontWeight: 700, color: T.slate }}>CPU moy:</span> {s.avgCpu !== null ? s.avgCpu.toFixed(1) + '%' : 'N/A'}
              {s.peakCpu !== null && <span style={{ color: '#94a3b8' }}> (pic: {s.peakCpu.toFixed(1)}%)</span>}
            </div>
            <div style={{ fontSize: 11, color: T.muted }}>
              <span style={{ fontWeight: 700, color: T.slate }}>RAM utilisée:</span> {s.avgRam > 0 ? s.avgRam.toFixed(1) + ' GB' : 'N/A'}
              {rs.currentRam > 0 && <span style={{ color: '#94a3b8' }}> / {rs.currentRam} GB provisionnés</span>}
            </div>
            {s.avgDisk > 0 && (
              <div style={{ fontSize: 11, color: T.muted }}>
                <span style={{ fontWeight: 700, color: T.slate }}>Disk:</span> {s.avgDisk.toFixed(1)} GB
              </div>
            )}
          </div>

          {rs.reason && (
            <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>📊 {rs.reason}</div>
          )}
        </div>

        {/* Dates */}
        <div style={{ minWidth: 130, flexShrink: 0 }}>
          <DateCell server={s} />
        </div>

        {/* Recommendation + savings */}
        <div style={{ minWidth: 160, flexShrink: 0, textAlign: 'right' }}>
          {s.monthlyCost !== null && (
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 4 }}>
              Actuel: <strong style={{ color: T.slate }}>{fmtEuro(s.monthlyCost)} €/mois</strong>
            </div>
          )}
          {rs.targetLabel && (
            <div style={{ fontSize: 11, fontWeight: 700, color: isDown ? T.amber : T.red, marginBottom: 4 }}>
              → {rs.targetLabel}
            </div>
          )}
          {rs.savingsEst > 0 && isDown && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 800, color: T.green, background: T.greenBg, border: '1px solid #6ee7b7' }}>
              💰 -{fmtEuro(rs.savingsEst)} €/mois
            </div>
          )}
          {rs.savingsEst > 0 && !isDown && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 800, color: T.red, background: T.redBg, border: '1px solid #fca5a5' }}>
              +{fmtEuro(rs.savingsEst)} €/mois
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Summary banner */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <div style={{ background: T.amberBg, borderRadius: 16, border: `1px solid #fcd34d`, padding: '18px 22px' }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: T.amber, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 8 }}>⬇ Downsizing possible</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: T.amber }}>{downsizeList.length}</div>
          <div style={{ fontSize: 12, color: T.amber, marginTop: 4 }}>serveurs sur-provisionnés</div>
        </div>
        <div style={{ background: T.greenBg, borderRadius: 16, border: `1px solid #6ee7b7`, padding: '18px 22px' }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: T.green, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 8 }}>💰 Économies estimées</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: T.green }}>{fmtEuro(totalSavings)} €</div>
          <div style={{ fontSize: 12, color: T.green, marginTop: 4 }}>par mois si rightsizing appliqué</div>
        </div>
        <div style={{ background: T.redBg, borderRadius: 16, border: `1px solid #fca5a5`, padding: '18px 22px' }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: T.red, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 8 }}>⬆ Upsize requis</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: T.red }}>{upsizeList.length}</div>
          <div style={{ fontSize: 12, color: T.red, marginTop: 4 }}>serveurs en risque de saturation</div>
        </div>
        <div style={{ background: 'white', borderRadius: 16, border: `1px solid ${T.border}`, padding: '18px 22px' }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: T.muted, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 8 }}>✅ Optimisés</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: T.slate }}>{servers.length - rightsizable.length}</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>aucune action requise</div>
        </div>
      </div>

      {/* Downsize recommendations */}
      {downsizeList.length > 0 && (
        <div style={{ background: 'white', borderRadius: 16, border: `1px solid ${T.border}`, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}`, background: T.amberBg, display: 'flex', alignItems: 'center', gap: 10 }}>
            <ArrowDownCircle size={18} color={T.amber} />
            <span style={{ fontSize: 14, fontWeight: 800, color: T.amber }}>Serveurs à réduire (Downsize)</span>
            <span style={{ fontSize: 11, fontWeight: 700, background: T.amber, color: 'white', borderRadius: 99, padding: '2px 8px' }}>{downsizeList.length}</span>
          </div>
          {downsizeList.map((s, i) => <RightsizingRow key={s.id} s={s} idx={i} />)}
        </div>
      )}

      {/* Upsize recommendations */}
      {upsizeList.length > 0 && (
        <div style={{ background: 'white', borderRadius: 16, border: `1px solid #fca5a5`, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid #fca5a5`, background: T.redBg, display: 'flex', alignItems: 'center', gap: 10 }}>
            <ArrowUpCircle size={18} color={T.red} />
            <span style={{ fontSize: 14, fontWeight: 800, color: T.red }}>Serveurs à agrandir (Upsize)</span>
            <span style={{ fontSize: 11, fontWeight: 700, background: T.red, color: 'white', borderRadius: 99, padding: '2px 8px' }}>{upsizeList.length}</span>
          </div>
          {upsizeList.map((s, i) => <RightsizingRow key={s.id} s={s} idx={i} />)}
        </div>
      )}

      {rightsizable.length === 0 && (
        <div style={{ background: 'white', borderRadius: 16, padding: 60, textAlign: 'center', border: `1px solid ${T.border}` }}>
          <CheckCircle size={48} color={T.green} style={{ margin: '0 auto 16px', display: 'block', opacity: 0.5 }} />
          <p style={{ fontSize: 15, fontWeight: 700, color: T.slate }}>Toute la flotte est optimisée 🎉</p>
          <p style={{ fontSize: 13, color: T.muted, marginTop: 8 }}>Aucun serveur ne nécessite de rightsizing pour l'instant</p>
        </div>
      )}
    </div>
  );
}

// ─── RenewalCalendar — servers expiring soon ──────────────────────────────
function RenewalCalendar({ servers }) {
  const upcoming = useMemo(() => {
    return servers
      .map(s => {
        const renewalDate = s.renewalDate || s.expirationDate;
        const days = daysUntil(renewalDate);
        return { ...s, _renewalDate: renewalDate, _daysLeft: days };
      })
      .filter(s => s._renewalDate && s._daysLeft !== null && s._daysLeft <= 90 && s._daysLeft >= -7)
      .sort((a, b) => a._daysLeft - b._daysLeft);
  }, [servers]);

  const noDateServers = servers.filter(s => !s.renewalDate && !s.expirationDate && !s.creationDate && !s.firstInvoiceDate);

  if (upcoming.length === 0 && noDateServers.length === 0) return null;

  return (
    <div style={{ background: 'white', borderRadius: 16, border: `1px solid ${T.border}`, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Clock size={18} color={T.amber} />
        <span style={{ fontSize: 14, fontWeight: 800, color: T.slate }}>Renouvellements à venir (90 jours)</span>
        {upcoming.length > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, background: T.amber, color: 'white', borderRadius: 99, padding: '2px 8px' }}>{upcoming.length}</span>
        )}
      </div>
      {upcoming.length === 0 ? (
        <div style={{ padding: '24px 20px', color: T.muted, fontSize: 13 }}>
          Aucun renouvellement dans les 90 prochains jours avec données disponibles.
          {noDateServers.length > 0 && (
            <span style={{ marginLeft: 8, fontSize: 11, color: '#94a3b8' }}>({noDateServers.length} serveur(s) sans date — configurez l'API OVH pour récupérer les dates automatiquement)</span>
          )}
        </div>
      ) : (
        <div>
          {upcoming.map((s, i) => {
            const days = s._daysLeft;
            const color = days < 0 ? T.red : days < 7 ? T.red : days < 30 ? T.amber : T.green;
            const bg    = days < 0 ? T.redBg : days < 7 ? T.redBg : days < 30 ? T.amberBg : T.greenBg;
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px', borderBottom: i < upcoming.length - 1 ? `1px solid ${T.border}` : 'none', background: i % 2 === 0 ? 'white' : '#FAFBFC' }}>
                <div style={{ width: 52, height: 52, borderRadius: 12, background: bg, border: `2px solid ${color}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 16, fontWeight: 900, color, lineHeight: 1 }}>{Math.abs(days)}</span>
                  <span style={{ fontSize: 8, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '.05em' }}>{days < 0 ? 'expiré' : 'jours'}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: T.slate, marginBottom: 2 }}>
                    {s.name.replace(/\.ovh\.net|\.vps\.ovh\.net/gi, '')}
                  </div>
                  <div style={{ fontSize: 11, color: T.muted }}>
                    Renouvellement: <strong style={{ color }}>{fmtDate(s._renewalDate)}</strong>
                    {s.creationDate && <span style={{ marginLeft: 10, color: '#94a3b8' }}>· Créé le {fmtDate(s.creationDate)}</span>}
                  </div>
                </div>
                {s.monthlyCost !== null && (
                  <div style={{ fontWeight: 800, fontSize: 13, color: T.green, whiteSpace: 'nowrap' }}>
                    {fmtEuro(s.monthlyCost)} €/mois
                  </div>
                )}
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: s.type === 'VPS' ? T.purpleBg : T.blueBg, color: s.type === 'VPS' ? T.purple : T.blue, border: `1px solid ${s.type === 'VPS' ? '#c4b5fd' : '#93c5fd'}`, whiteSpace: 'nowrap' }}>
                  {s.type}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── FinOps Insights ──────────────────────────────────────────────────────
function Insights({ servers }) {
  const withCost = servers.filter(s => s.monthlyCost !== null && s.monthlyCost > 0);
  const wasteful = servers.filter(s => s.status === 'underutilized' && s.monthlyCost !== null);
  const wastefulCost = wasteful.reduce((s, x) => s + (x.monthlyCost || 0), 0);
  const totalCost    = withCost.reduce((s, x) => s + (x.monthlyCost || 0), 0);
  const topCostServers = [...withCost].sort((a, b) => (b.monthlyCost || 0) - (a.monthlyCost || 0)).slice(0, 10);

  const vpsTotal  = withCost.filter(s => s.type === 'VPS').reduce((s, x) => s + (x.monthlyCost || 0), 0);
  const dedTotal  = withCost.filter(s => s.type === 'Dedicated').reduce((s, x) => s + (x.monthlyCost || 0), 0);
  const costByType = [
    { name: 'VPS', value: vpsTotal, color: T.purple },
    { name: 'Dedicated', value: dedTotal, color: T.blue },
  ].filter(x => x.value > 0);
  const COLORS = [T.purple, T.blue, T.green, T.amber, T.red];

  const ramDist = { '≤8 GB': 0, '16 GB': 0, '32 GB': 0, '64 GB': 0, '128+ GB': 0 };
  servers.forEach(s => {
    const r = s.peakRam;
    if (r <= 8) ramDist['≤8 GB']++;
    else if (r <= 16) ramDist['16 GB']++;
    else if (r <= 32) ramDist['32 GB']++;
    else if (r <= 64) ramDist['64 GB']++;
    else ramDist['128+ GB']++;
  });
  const ramChartData = Object.entries(ramDist).map(([k, v]) => ({ name: k, count: v })).filter(x => x.count > 0);

  if (servers.length === 0) {
    return (
      <div style={{ background: 'white', borderRadius: 16, padding: 60, textAlign: 'center', color: '#94a3b8', border: `1px solid ${T.border}` }}>
        <Target size={48} style={{ opacity: 0.2, margin: '0 auto 16px', display: 'block' }} />
        <p style={{ fontSize: 15, fontWeight: 700, color: '#374151' }}>Aucun serveur chargé</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Renewal calendar */}
      <RenewalCalendar servers={servers} />

      {/* FinOps KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <div style={{ background: 'white', borderRadius: 16, border: `1px solid ${T.border}`, padding: '18px 22px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: T.slate }}>{fmtEuro(totalCost)} <span style={{ fontSize: 14, fontWeight: 600, color: T.muted }}>€</span></div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>{withCost.length} serveurs avec coût</div>
        </div>
        <div style={{ background: 'white', borderRadius: 16, border: `1px solid #fcd34d`, padding: '18px 22px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: T.amber, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 10 }}>⚠ Coût gaspillé (downsize)</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: T.amber }}>{fmtEuro(wastefulCost)} <span style={{ fontSize: 14, fontWeight: 600 }}>€</span></div>
          <div style={{ fontSize: 12, color: T.amber, marginTop: 4 }}>{wasteful.length} serveurs · {totalCost > 0 ? ((wastefulCost / totalCost) * 100).toFixed(1) : 0}% du budget</div>
        </div>
        
        <div style={{ background: 'white', borderRadius: 16, border: `1px solid ${T.border}`, padding: '18px 22px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: T.muted, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 10 }}>📊 Coût moyen / serveur</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: T.slate }}>{withCost.length > 0 ? fmtEuro(totalCost / withCost.length) : '—'} <span style={{ fontSize: 14, fontWeight: 600, color: T.muted }}>€</span></div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>Par mois · {servers.length} serveurs au total</div>
        </div>
      </div>

      {/* Top coûts + pie */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16 }}>
        <div style={{ background: 'white', borderRadius: 16, border: `1px solid ${T.border}`, padding: '20px 24px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 800, color: T.slate, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <DollarSign size={16} color={T.green} /> Top 10 serveurs par coût mensuel
          </h3>
          {topCostServers.length === 0 ? (
            <p style={{ color: T.muted, fontSize: 13 }}>Aucune donnée de coût disponible</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {topCostServers.map((s, i) => {
                const pct = totalCost > 0 ? (s.monthlyCost / totalCost) * 100 : 0;
                const barColor = s.status === 'underutilized' ? T.amber : s.status === 'critical' ? T.red : T.green;
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', width: 18, textAlign: 'right' }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: T.slate, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
                          {s.name.replace(/\.ovh\.net|\.vps\.ovh\.net/gi, '')}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 800, color: barColor, whiteSpace: 'nowrap', marginLeft: 8 }}>
                          {fmtEuro(s.monthlyCost)} €
                        </span>
                      </div>
                      <div style={{ height: 5, borderRadius: 99, background: '#F1F5F9', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 99, transition: 'width 0.6s ease' }} />
                      </div>
                    </div>
                    <span style={{ fontSize: 10, color: '#94a3b8', width: 36, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ background: 'white', borderRadius: 16, border: `1px solid ${T.border}`, padding: '20px 24px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: 14, fontWeight: 800, color: T.slate, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Layers size={16} color={T.blue} /> Coût VPS vs Dédié
          </h3>
          {costByType.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={costByType} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                    {costByType.map((entry, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => [`${fmtEuro(v)} €`, 'Coût']} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {costByType.map((d, i) => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS[i] }} />
                      <span style={{ fontSize: 12, color: T.muted }}>{d.name}</span>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 800, color: T.slate }}>{fmtEuro(d.value)} €</span>
                  </div>
                ))}
              </div>
            </>
          ) : <p style={{ color: T.muted, fontSize: 13 }}>Aucune donnée de coût</p>}
        </div>
      </div>

      {/* RAM distribution */}
      <div style={{ background: 'white', borderRadius: 16, border: `1px solid ${T.border}`, padding: '20px 24px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: T.slate, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <MemoryStick size={16} color={T.purple} /> Distribution RAM de la flotte
        </h3>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={ramChartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: T.muted }} />
            <YAxis tick={{ fontSize: 11, fill: T.muted }} allowDecimals={false} />
            <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
            <Bar dataKey="count" name="Serveurs" radius={[6, 6, 0, 0]}>
              {ramChartData.map((_, i) => <Cell key={i} fill={['#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#5b21b6'][i % 5]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Main ResourceDashboard Component ─────────────────────────────────────
export default function ResourceDashboard() {
  const [servers,          setServers]          = useState([]);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState(null);
  const [search,           setSearch]           = useState('');
  const [typeFilter,       setTypeFilter]       = useState('all');
  const [serverNameFilter, setServerNameFilter] = useState(''); // dropdown filter
  const [activeTab,        setActiveTab]        = useState('servers');
  const [datesLoading,     setDatesLoading]     = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch summaries + costs in parallel
      // Dates (creationDate, expirationDate) are embedded in the summary response —
      // they were stored in DB during the last /import-ovh-metrics call.
      const [summaries, costs] = await Promise.all([
        resourcesService.getAllServersSummary(),
        costsService.getAllCosts().catch(() => []),
      ]);

      const rawServers = buildServerList(summaries);   // OVH dates already parsed here
      const costMap    = buildCostMap(costs);
      const withCosts  = enrichServersWithCosts(rawServers, costMap);

      // Try batch OVH info for any servers that still have no dates
      // (e.g. imported before the new columns existed)
      const missingDates = withCosts.filter(s => !s.creationDate && !s.renewalDate);
      let enriched = withCosts;

      if (missingDates.length > 0) {
        const ovhInfoList = await ovhService.getAllServersInfo().catch(() => []);
        enriched = enrichServersWithOvhInfo(withCosts, ovhInfoList);
      }

      setServers(enriched);

      // Progressive per-server fallback only for servers still without dates
      const stillMissing = enriched.filter(s => !s.creationDate && !s.renewalDate);
      if (stillMissing.length > 0) {
        setDatesLoading(true);
        const BATCH = 5;
        let updated = [...enriched];
        for (let i = 0; i < stillMissing.length; i += BATCH) {
          const chunk = stillMissing.slice(i, i + BATCH);
          const results = await Promise.all(
            chunk.map(srv => ovhService.getServerInfo(srv.name).catch(() => null))
          );
          results.forEach((info, idx) => {
            if (!info) return;
            const globalIdx = updated.findIndex(s => s.name === chunk[idx].name);
            if (globalIdx === -1) return;
            updated[globalIdx] = {
              ...updated[globalIdx],
              creationDate:   info.creationDate   || info.creation_date   || updated[globalIdx].creationDate   || null,
              renewalDate:    info.expiration      || info.renewalDate     || info.renewal_date              || updated[globalIdx].renewalDate    || null,
              expirationDate: info.expiration      || info.expirationDate  || updated[globalIdx].expirationDate || null,
              ovhState:       info.state           || updated[globalIdx].ovhState  || null,
              ovhOffer:       info.offer           || info.currentRange    || updated[globalIdx].ovhOffer       || null,
            };
          });
          setServers([...updated]);
        }
        setDatesLoading(false);
      }
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'Erreur lors du chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // When dropdown selects a server, set search to its name so the table filters to it
  const handleDropdownSelect = useCallback((name) => {
    setServerNameFilter(name);
    setSearch(''); // clear text search when using dropdown
  }, []);

  const handleServerSelect = useCallback(() => {}, []); // kept for ServerTable compat

  const filteredServers = useMemo(() => {
    let list = servers;
    if (typeFilter !== 'all') list = list.filter(s => s.type === typeFilter);
    // Dropdown filter (exact server) takes priority over text search
    if (serverNameFilter) {
      list = list.filter(s => s.name === serverNameFilter);
    } else if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q));
    }
    return list;
  }, [servers, typeFilter, search, serverNameFilter]);

  const summary = useMemo(() => generateSummary(filteredServers), [filteredServers]);

  const rightsizingCount = useMemo(
    () => filteredServers.filter(s => computeRightsizing(s).recommendation !== null).length,
    [filteredServers]
  );

  const renewalSoonCount = useMemo(
    () => filteredServers.filter(s => {
      const d = daysUntil(s.renewalDate || s.expirationDate);
      return d !== null && d <= 30 && d >= 0;
    }).length,
    [filteredServers]
  );

  const tabs = [
    { id: 'servers',  label: 'Serveurs',       icon: Server, count: null },
    { id: 'insights', label: 'Insights FinOps', icon: Zap,    count: renewalSoonCount },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: T.bg, fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <Sidebar />
      <div style={{ flex: 1, overflow: 'auto', padding: '0 32px 40px', minWidth: 0, marginLeft: 240 }}>
        <Header />

        {/* Page header */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: T.green, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 12px ${T.green}55` }}>
                  <Layers size={20} color="white" />
                </div>
                <h1 style={{ fontSize: 28, fontWeight: 900, color: T.slate, letterSpacing: '-0.5px' }}>Resource Dashboard</h1>
              </div>
              <p style={{ color: T.muted, fontSize: 14, marginLeft: 52 }}>
                FinOps · Optimisation serveurs · VPS &amp; Dedicated · Rightsizing · Dates de renouvellement
              </p>
            </div>
            <button
              disabled={loading}
              onClick={loadData}
              style={{ padding: '11px 22px', background: loading ? '#f1f5f9' : T.green, color: loading ? '#94a3b8' : 'white', border: 'none', borderRadius: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 14, transition: 'background .15s' }}
            >
              <RefreshCw size={15} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              {loading ? 'Chargement...' : 'Rafraîchir'}
            </button>
          </div>

          {error && (
            <div style={{ background: '#fff5f5', border: '1.5px solid #fca5a5', borderRadius: 12, padding: '14px 18px', color: T.red, fontSize: 13, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={18} /> {error}
            </div>
          )}

          {/* Summary cards */}
          {filteredServers.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 8 }}>
              <SummaryCard label="Serveurs" value={filteredServers.length} sub={`${filteredServers.filter(s => s.type === 'VPS').length} VPS · ${filteredServers.filter(s => s.type === 'Dedicated').length} Dédiés`} accentColor={T.green} bgColor={T.greenBg} icon={Server} />
              <SummaryCard label="Disk Moyen" value={summary.avgDisk.toFixed(1)} sub="GB" accentColor={T.blue} bgColor={T.blueBg} icon={HardDrive} />
              <SummaryCard label="RAM Moyen" value={summary.avgRam.toFixed(1)} sub="GB" accentColor={T.purple} bgColor={T.purpleBg} icon={Activity} />
              <SummaryCard label="À optimiser" value={summary.underutilized} sub={`${summary.underutilized} downsize · ${summary.critical} upsize`} accentColor={T.amber} bgColor={T.amberBg} icon={AlertTriangle} />
              {renewalSoonCount > 0 && (
                <SummaryCard label="Renouvellement < 30j" value={renewalSoonCount} sub="serveurs à renouveler" accentColor={renewalSoonCount > 0 ? T.red : T.green} bgColor={renewalSoonCount > 0 ? T.redBg : T.greenBg} icon={Clock} />
              )}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: `2px solid ${T.border}`, overflowX: 'auto', paddingBottom: 0 }}>
          {tabs.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{ padding: '12px 20px', borderRadius: '10px 10px 0 0', fontWeight: 700, fontSize: 13, background: isActive ? 'white' : 'transparent', border: isActive ? `2px solid ${T.border}` : '2px solid transparent', borderBottom: isActive ? '2px solid white' : '2px solid transparent', marginBottom: isActive ? '-2px' : 0, color: isActive ? T.green : T.muted, display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s', whiteSpace: 'nowrap' }}
              >
                <tab.icon size={16} /> {tab.label}
                {tab.count > 0 && (
                  <span style={{ background: tab.id === 'rightsizing' ? T.amber : T.red, color: 'white', borderRadius: 99, padding: '1px 7px', fontSize: 10, fontWeight: 800, marginLeft: 2 }}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* SERVERS TAB */}
        {activeTab === 'servers' && (
          <div style={{ background: 'white', borderRadius: 16, border: `1px solid ${T.border}`, boxShadow: '0 4px 20px rgba(0,0,0,0.06)', overflow: 'hidden', animation: 'fadeIn .3s ease' }}>
            <div style={{ padding: '18px 20px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: '#FAFBFC' }}>
              {/* Text search */}
              <div style={{ position: 'relative', flex: 1, maxWidth: 300, minWidth: 160 }}>
                <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                <input
                  type="text"
                  placeholder="Rechercher un serveur..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setServerNameFilter(''); }}
                  style={{ width: '100%', padding: '10px 12px 10px 38px', borderRadius: 10, border: `1.5px solid ${T.border}`, fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', transition: 'border-color .15s', background: 'white' }}
                  onFocus={e => (e.target.style.borderColor = T.green)}
                  onBlur={e  => (e.target.style.borderColor = T.border)}
                />
              </div>
              {/* Type filter buttons */}
              <div style={{ display: 'flex', gap: 6 }}>
                {[{ id: 'all', label: 'Tous' }, { id: 'VPS', label: '🖥️ VPS' }, { id: 'Dedicated', label: '🗄️ Dédiés' }].map(btn => (
                  <button key={btn.id} onClick={() => setTypeFilter(btn.id)} style={{ padding: '8px 16px', borderRadius: 99, fontWeight: 700, fontSize: 12, background: typeFilter === btn.id ? T.green : 'white', color: typeFilter === btn.id ? 'white' : T.muted, border: typeFilter === btn.id ? `1.5px solid ${T.green}` : `1.5px solid ${T.border}`, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}>
                    {btn.label}
                  </button>
                ))}
              </div>
              {/* Server dropdown selector */}
              <select
                value={serverNameFilter}
                onChange={e => handleDropdownSelect(e.target.value)}
                style={{ padding: '9px 14px', borderRadius: 8, border: `1.5px solid ${serverNameFilter ? T.green : T.border}`, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', background: 'white', color: serverNameFilter ? T.green : T.slate, maxWidth: 320, minWidth: 200, fontWeight: serverNameFilter ? 700 : 400 }}
              >
                <option value="">— Tous les serveurs —</option>
                {servers.map(s => (
                  <option key={s.name} value={s.name}>{s.name} ({s.type})</option>
                ))}
              </select>
              {/* Clear button when a server is selected in dropdown */}
              {serverNameFilter && (
                <button
                  onClick={() => setServerNameFilter('')}
                  style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: T.redBg, color: T.red, border: `1.5px solid #fca5a5`, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                >
                  ✕ Effacer
                </button>
              )}
              {/* Date loading indicator */}
              {datesLoading && (
                <span style={{ fontSize: 11, color: T.muted, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Chargement des dates OVH...
                </span>
              )}
              <div style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: T.muted, background: T.bg, padding: '6px 12px', borderRadius: 8, border: `1px solid ${T.border}` }}>
                {filteredServers.length} serveur{filteredServers.length !== 1 ? 's' : ''}
              </div>
            </div>
            <ServerTable servers={filteredServers} loading={loading} onServerSelect={handleServerSelect} />
          </div>
        )}

        {/* INSIGHTS TAB */}
        {activeTab === 'insights' && (
          <div style={{ animation: 'fadeIn .3s ease' }}>
            <Insights servers={filteredServers} />
          </div>
        )}

        <style>{`
          @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
          @keyframes spin   { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        `}</style>
      </div>
    </div>
  );
}