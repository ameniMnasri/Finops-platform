import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Edit2, Trash2, RefreshCw,
  DollarSign, TrendingUp, BarChart2, FileText,
  ChevronUp, ChevronDown, X, Save, Upload, Server, HardDrive, Calendar,
} from 'lucide-react';
import Layout from '../Layout/Layout';
import { costsService } from '../../services/costs';
import toast from 'react-hot-toast';

// ─── Formatters ───────────────────────────────────────────────────────
const fmt2 = v =>
  Number(v || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
const fmtDate = d =>
  d ? new Date(d).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  }) : '—';

const fmtMonth = key => {
  if (!key) return '';
  const [y, m] = key.split('-');
  return new Date(+y, +m - 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};

// ─── Universal category detection ────────────────────────────────────
const CAT_COLOR_MAP = {
  VPS:       '#7C3AED',
  Dedicated: '#2563EB',
  IP:        '#0891B2',
  Snapshot:  '#0F766E',
  Option:    '#B45309',
  Storage:   '#1B5E46',
  Backup:    '#9333EA',
  'DNS/NS':  '#047857',
  Compute:   '#0369A1',
  Network:   '#0284C7',
  Database:  '#B45309',
  Autre:     '#64748B',
};
const CAT_BG = {
  VPS:       '#f5f3ff',
  Dedicated: '#eff6ff',
  IP:        '#e0f2fe',
  Snapshot:  '#f0fdfa',
  Option:    '#fffbeb',
  Storage:   '#f0fdf4',
  Backup:    '#faf5ff',
  'DNS/NS':  '#f0fdf4',
  Compute:   '#e0f2fe',
  Network:   '#f0f9ff',
  Database:  '#fffbeb',
  Autre:     '#f8fafc',
};

function detectCategory(name, source) {
  if (!name) return 'Autre';
  const n = name.toUpperCase();

  // ── VPS first (most specific) ─────────────────────────────────────────
  if (n.includes('VPS'))                                                       return 'VPS';

  // ── Backup ────────────────────────────────────────────────────────────
  if (n.includes('BACKUP') || n.includes('AUTOMATED BACKUP'))                 return 'Backup';

  // ── Snapshot ──────────────────────────────────────────────────────────
  if (n.includes('SNAPSHOT'))                                                  return 'Snapshot';

  // ── IP addresses ──────────────────────────────────────────────────────
  if (n.includes('IPV4') || n.includes('IPV6') || n.includes('FAILOVER') ||
      (n.includes('ADDITIONAL IP') ) ||
      /^\[EUROPE\]\s+ADDITIONAL/.test(name.toUpperCase()))                    return 'IP';

  // ── DNS / NS ──────────────────────────────────────────────────────────
  if (n.includes('DNS') || n.includes(' NS '))                                return 'DNS/NS';

  // ── vRack (OVH private network) ───────────────────────────────────────
  if (n.includes('VRACK'))                                                     return 'Network';

  // ── Storage / Object / Block ──────────────────────────────────────────
  if (n.includes('OBJECT STORAGE') || n.includes('BLOCK STORAGE') ||
      n.includes('S3 ') || /\bS3$/.test(n))                                   return 'Storage';

  // ── Dedicated server OPTIONS (hardware add-ons billed separately)
  //    These appear as "Option ..." lines in OVH invoices
  //    or are RAM / disk / bandwidth lines attached to a dedicated server
  if (
    n.includes('OPTION ') || n.includes('ADD-ON') ||
    n.startsWith('OPTION') ||
    // RAM upgrades
    n.includes('DDR') ||
    // Disk / NVMe / RAID options
    n.includes('SOFTRAID') || n.includes('HARDRAID') ||
    n.includes('ADDITIONAL DISK') ||
    // Bandwidth / traffic options on dedicated
    n.includes('BANDWIDTH') || n.includes('TRAFFIC') ||
    n.includes('UNMETERED') ||
    // NVMe / SSD / HDD lines (dedicated server disk options)
    (n.includes('NVME') && !n.includes('VPS')) ||
    (n.includes('SSD') && !n.includes('VPS') && !n.includes('SNAPSHOT')) ||
    (n.includes('HDD') && !n.includes('VPS')) ||
    (n.includes('SATA') && !n.includes('VPS'))
  )                                                                            return 'Option';

  // ── Dedicated servers (bare-metal) ────────────────────────────────────
  if (
    n.includes('SERVER') || n.includes('RENTAL') ||
    n.includes('EG-')    || n.includes('ADVANCE') ||
    n.includes('RISE')   || n.includes('BIG-')    ||
    n.includes('SP-')    || n.includes('HG-')     ||
    n.includes('SCALE-') || n.includes('HGR-')    ||
    n.includes('KS-')    || n.includes('SYS-')    ||
    n.includes('HOST-')  || n.includes('DEDIBOX')
  )                                                                            return 'Dedicated';

  // ── Cloud compute ─────────────────────────────────────────────────────
  if (n.includes('EC2') || n.includes('INSTANCE') || n.includes('COMPUTE') ||
      n.includes('VM ') || n.includes('VIRTUAL MACHINE'))                      return 'Compute';

  // ── Database ──────────────────────────────────────────────────────────
  if (n.includes('RDS') || n.includes('DATABASE') || n.includes('DB ') ||
      n.includes('SQL') || n.includes('DYNAMO') || n.includes('COSMOS'))       return 'Database';

  // ── Object / Block Storage fallback ──────────────────────────────────
  if (n.includes('STORAGE') || n.includes('HGR') || n.includes('SDS'))        return 'Storage';

  return 'Autre';
}

// ─── Universal subscription/label extractor ───────────────────────────
function extractLabel(name) {
  if (!name) return null;
  const n = name;

  const vps = n.match(/VPS\s+(?:Elite|Comfort|Essential|Value)\s+[\d]+-[\d]+-[\d]+/i);
  if (vps) return vps[0].trim();

  const srv = n.match(/\b(ADVANCE-\d+|RISE-\d+|EG-[\w-]+|SP-[\w-]+|BIG-HG[\w-]*|HG-[\w-]+)\b/i);
  if (srv) return srv[1].toUpperCase();
  if (/big.hg\b/i.test(n)) return 'BIG-HG';

  const nvme = n.match(/(\d+)\s*[xX×]\s*SSD\s+NVMe?\s+([\d.]+\s*(?:TB|GB))/i);
  if (nvme) return `${nvme[1]}× NVMe ${nvme[2].replace(/\s/g, '').toUpperCase()}`;

  const ssd = n.match(/\b(\d+[xX×]?\s*SSD)\s+([\d.]+\s*(?:TB|GB))\b/i);
  if (ssd) return `SSD ${ssd[2].replace(/\s/g, '').toUpperCase()}`;

  const hdd = n.match(/(\d+)\s*[xX×]\s*(?:HDD\s+)?SATA\s+([\d.]+\s*(?:TB|GB))/i);
  if (hdd) return `${hdd[1]}× HDD ${hdd[2].replace(/\s/g, '').toUpperCase()}`;
  const hdd2 = n.match(/(\d+)\s*[xX×]\s*HDD\s+SATA\s+([\d.]+\s*(?:TB|GB))/i);
  if (hdd2) return `${hdd2[1]}× HDD ${hdd2[2].replace(/\s/g, '').toUpperCase()}`;

  const ram = n.match(/(\d+\s*GB)\s+DDR(\d)/i);
  if (ram) return `${ram[1].replace(/\s/g, '').toUpperCase()} DDR${ram[2]}`;

  const outbw = n.match(/outgoing.*?([\d.]+\s*(?:Gbps|Mbps))/i);
  if (outbw) return 'Out ' + outbw[1].replace(/\s/g, '');

  const vrack = n.match(/vrack.*?([\d.]+\s*(?:Gbps|Mbps))/i);
  if (vrack) return 'vRack ' + vrack[1].replace(/\s/g, '');

  const ulbw = n.match(/unlimited traffic.*?([\d.]+\s*(?:Gbps|Mbps))/i);
  if (ulbw) return ulbw[1].replace(/\s/g, '') + ' traffic';

  const bw = n.match(/^([\d.]+\s*(?:Gbps|Mbps))\s+/i);
  if (bw) return bw[1].replace(/\s/g, '');

  const softraid = n.match(/softraid.*?([\d.]+\s*(?:TB|GB))/i);
  if (softraid) return 'SoftRaid ' + softraid[1].replace(/\s/g, '').toUpperCase();

  const addisk = n.match(/additional\s+disk\s+([\d.]+\s*(?:TB|GB))/i);
  if (addisk) return 'Disk ' + addisk[1].replace(/\s/g, '').toUpperCase();

  if (/additional ipv4/i.test(n)) return 'IPv4';
  if (/additional ipv6/i.test(n)) return 'IPv6';

  const snap = n.match(/snapshot\s+([\d.]+\s*(?:TB|GB))/i);
  if (snap) return 'Snapshot ' + snap[1].replace(/\s/g, '').toUpperCase();

  const os = n.match(/^OS\s+(\w+)/i);
  if (os) return 'OS ' + os[1];

  const awsInst = n.match(/\b([tmcrgpfxi]\d[a-z]?\.\w+)\b/i);
  if (awsInst) return awsInst[1].toLowerCase();
  const gcpInst = n.match(/\b(n\d-\w+-\d+|e2-\w+-\d+|c2-\w+-\d+)\b/i);
  if (gcpInst) return gcpInst[1].toLowerCase();
  const azureInst = n.match(/\b([BDEFLMNZ]\d+[a-z_]*\s*v?\d*)\b/);
  if (azureInst) return azureInst[1].trim();

  const words = n
    .replace(/monthly fees?|rental for \d+.*|for \d+ month.*|\(.*?\)/gi, '')
    .replace(/^\[(europe|canada|asia|us|apac)\]\s*/i, '')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 1)
    .slice(0, 3);
  if (words.length > 0) return words.join(' ');

  return null;
}

// ─── Disk info ────────────────────────────────────────────────────────
function extractDiskInfo(name) {
  if (!name) return null;
  const n = name.toUpperCase();
  const nvme = n.match(/(\d+)\s*[Xx×]\s*SSD\s+NVME\s+([\d.]+\s*(?:TB|GB))/i);
  if (nvme) return `${nvme[1]}× NVMe ${nvme[2].replace(/\s/g, '').toUpperCase()}`;
  const ssd = n.match(/SSD\s+([\d.]+\s*(?:TB|GB))/i);
  if (ssd) return `SSD ${ssd[1].replace(/\s/g, '').toUpperCase()}`;
  const sata = n.match(/(\d+)\s*[Xx×]\s*([\d.]+\s*(?:TB|GB))\s*(?:SATA|HDD|SAS)/i);
  if (sata) return `${sata[1]}× ${sata[2].replace(/\s/g, '').toUpperCase()} HDD`;
  const hgr = n.match(/(HGR[^\s-]*)/i);
  if (hgr) return `Rack ${hgr[1].toUpperCase()}`;
  const addDisk = n.match(/ADDITIONAL\s+DISK\s+([\d.]+\s*(?:TB|GB))/i);
  if (addDisk) return addDisk[1].replace(/\s/g, '').toUpperCase();
  const snap = n.match(/SNAPSHOT\s+([\d.]+\s*(?:TB|GB))/i);
  if (snap) return `Snap ${snap[1].replace(/\s/g, '').toUpperCase()}`;
  const softraid = n.match(/SOFTRAID.*?([\d.]+\s*(?:TB|GB))/i);
  if (softraid) return `SoftRaid ${softraid[1].replace(/\s/g, '').toUpperCase()}`;
  const generic = n.match(/([\d]+\s*(?:TB|GB))/i);
  if (generic) return generic[1].replace(/\s/g, '').toUpperCase();
  return null;
}

// ─── Source detection ─────────────────────────────────────────────────
function resolveSource(source, filename) {
  if (source && source !== 'Manuel' && source !== 'Fichier') return source;
  const f = (filename || '').toLowerCase();
  if (/facture|ovh/.test(f))     return 'OVHcloud';
  if (/aws|amazon/.test(f))      return 'AWS';
  if (/azure|microsoft/.test(f)) return 'Azure';
  if (/gcp|google/.test(f))      return 'GCP';
  if (/invoice/.test(f))         return 'Fichier';
  return source || 'Fichier';
}

// ─── Source Badge ─────────────────────────────────────────────────────
function SourceBadge({ source, sourceRef, filename }) {
  const resolved = resolveSource(source, filename);
  const cfg = {
    OVHcloud: { color: '#0073d1', bg: '#e0f2fe', icon: '🔷', border: '#7dd3fc' },
    Fichier:  { color: '#1B5E46', bg: '#f0fdf4', icon: '📄', border: '#bbf7d0' },
    AWS:      { color: '#f97316', bg: '#fff7ed', icon: '🟠', border: '#fed7aa' },
    Azure:    { color: '#2563eb', bg: '#eff6ff', icon: '🔵', border: '#bfdbfe' },
    GCP:      { color: '#ef4444', bg: '#fff5f5', icon: '🔴', border: '#fca5a5' },
    Manuel:   { color: '#94a3b8', bg: '#f8fafc', icon: '✏️', border: '#e2e8f0' },
  };
  const found = Object.keys(cfg).find(k =>
    resolved.toLowerCase().includes(k.toLowerCase())
  );
  const c = cfg[found || 'Fichier'];
  return (
    <span title={sourceRef || resolved} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, fontWeight: 700, color: c.color,
      background: c.bg, padding: '3px 9px', borderRadius: 99,
      border: `1px solid ${c.border}`,
      cursor: sourceRef ? 'help' : 'default', whiteSpace: 'nowrap',
    }}>
      <span>{c.icon}</span>{found || resolved}
    </span>
  );
}

// ─── Category Badge ───────────────────────────────────────────────────
function CatBadge({ cat }) {
  if (!cat || cat === 'Autre') return null;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700,
      color: CAT_COLOR_MAP[cat] || '#64748b',
      background: CAT_BG[cat]   || '#f8fafc',
      padding: '2px 8px', borderRadius: 5,
      border: `1px solid ${(CAT_COLOR_MAP[cat] || '#64748b')}33`,
      whiteSpace: 'nowrap',
    }}>
      {cat}
    </span>
  );
}

// ─── Label Badge ──────────────────────────────────────────────────────
function LabelBadge({ label, cat }) {
  const color = CAT_COLOR_MAP[cat] || '#475569';
  const bg    = CAT_BG[cat]        || '#f1f5f9';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontSize: 11, fontWeight: 800, color: color,
      background: bg,
      padding: '3px 10px', borderRadius: 20,
      border: `1.5px solid ${color}33`,
      letterSpacing: '0.01em',
      whiteSpace: 'nowrap',
      boxShadow: `0 1px 4px ${color}18`,
    }}>
      {label}
    </span>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────
function KPICard({ label, value, unit = '€', icon: Icon, topColor, iconBg, sub }) {
  return (
    <div style={{
      background: 'white', borderRadius: 18, padding: '18px 20px 14px',
      border: '1px solid #e8edf5', position: 'relative', overflow: 'hidden',
      boxShadow: '0 2px 12px rgba(0,0,0,.06)', flex: 1, minWidth: 160,
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 4,
        background: topColor, borderRadius: '18px 18px 0 0',
      }}/>
      <div style={{
        position: 'absolute', right: -18, bottom: -18, width: 88, height: 88,
        borderRadius: '50%', background: topColor + '12',
      }}/>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{
          fontSize: 10, fontWeight: 800, color: '#94a3b8',
          textTransform: 'uppercase', letterSpacing: '.1em',
        }}>
          {label}
        </span>
        <div style={{
          width: 34, height: 34, borderRadius: 10, background: iconBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={16} color="white"/>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
        <span style={{
          fontSize: 26, fontWeight: 900, color: '#0f172a',
          letterSpacing: '-1px', lineHeight: 1, position: 'relative', zIndex: 1,
        }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>{unit}</span>}
      </div>
      {sub && <p style={{ fontSize: 11, color: '#94a3b8', position: 'relative', zIndex: 1 }}>{sub}</p>}
    </div>
  );
}

// ─── Sortable TH ──────────────────────────────────────────────────────
function SortTh({ label, field, sort, onSort }) {
  const active = sort.field === field;
  return (
    <th onClick={() => onSort(field)} style={{
      padding: '11px 14px', textAlign: 'left', fontSize: 11, fontWeight: 800,
      color: active ? '#1B5E46' : '#64748b', textTransform: 'uppercase',
      letterSpacing: '.06em', borderBottom: '1px solid #f1f5f9',
      cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none',
      background: '#f8fafc',
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        {active
          ? (sort.dir === 'asc' ? <ChevronUp size={12}/> : <ChevronDown size={12}/>)
          : <ChevronDown size={12} style={{ opacity: .3 }}/>}
      </span>
    </th>
  );
}

const thStyle = {
  padding: '11px 14px', textAlign: 'left', fontSize: 11, fontWeight: 800,
  color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em',
  borderBottom: '1px solid #f1f5f9', background: '#f8fafc', whiteSpace: 'nowrap',
};
const inputStyle = {
  padding: '6px 10px', borderRadius: 8, border: '1.5px solid #1B5E46',
  fontSize: 12, fontFamily: 'inherit', outline: 'none', width: 130,
};

// ─────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────
export default function Costs() {
  const navigate = useNavigate();
  const [costs,       setCosts]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [globalSearch, setGlobalSearch] = useState('');
  const [filterCat,   setFilterCat]   = useState('');
  const [filterSrc,   setFilterSrc]   = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterAmount, setFilterAmount] = useState({ min: '', max: '' });
  const [sort,        setSort]        = useState({ field: 'cost_date', dir: 'desc' });
  const [editId,      setEditId]      = useState(null);
  const [editData,    setEditData]    = useState({});

  // ✅ ÉTAPE 2: AI States
  const [aiQuery, setAiQuery] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiFilters, setAiFilters] = useState({
    minAmount: 0,
    maxAmount: 999999,
    category: '',
    source: '',
    period: '',
  });


  const loadCosts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await costsService.getCosts(0, 5000);
      setCosts(Array.isArray(data) ? data : []);
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error('Erreur: ' + (typeof d === 'string' ? d : e.message));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadCosts(); }, [loadCosts]);

  
  // ── Enrich ────────────────────────────────────────────────────
  const enriched = useMemo(() => costs.map(c => {
    const src    = resolveSource(c.source, c.filename || c.source_file);
    const cat    = detectCategory(c.service_name, src);
    const lbl    = c.subscription_type || extractLabel(c.service_name);
    const disk   = c.disk_info || extractDiskInfo(c.service_name);
    const refRaw = c.reference || c.resource_id || c.external_id || null;
    const ref    = refRaw ? refRaw.replace(/\s+/g, '') : null;
    
    return { ...c, _cat: cat, _lbl: lbl, _disk: disk, _ref: ref, _src: src };
  }), [costs]);

  const categories = useMemo(() =>
    [...new Set(enriched.map(c => c._cat).filter(Boolean))].sort(), [enriched]);
  const sources = useMemo(() =>
    [...new Set(enriched.map(c => c._src).filter(Boolean))].sort(), [enriched]);

  // ── Available months (sorted desc) ────────────────────────────
  const months = useMemo(() => {
    const set = new Set();
    enriched.forEach(c => {
      if (c.cost_date) {
        const d = new Date(c.cost_date);
        if (!isNaN(d))
          set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      }
    });
    return [...set].sort().reverse();
  }, [enriched]);

  // ✅ ÉTAPE 6: Filter + sort (avec aiFilters)
  const displayed = useMemo(() => {
    let list = [...enriched];
    if (globalSearch.trim()) {
      const q = globalSearch.trim().toLowerCase();
      list = list.filter(c =>
        (c.service_name || '').toLowerCase().includes(q) ||
        (c._lbl  || '').toLowerCase().includes(q) ||
        (c._ref  || '').toLowerCase().includes(q) ||
        (c._cat  || '').toLowerCase().includes(q) ||
        (c._src  || '').toLowerCase().includes(q) ||
        String(c.amount || '').includes(q)
      );
    }
    if (filterCat)   list = list.filter(c => c._cat === filterCat);
    if (filterSrc)   list = list.filter(c => c._src === filterSrc);
    if (filterMonth) {
      list = list.filter(c => {
        if (!c.cost_date) return false;
        const d = new Date(c.cost_date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        return key === filterMonth;
      });
    }
    
    // Amount range filter
    const minAmt = filterAmount.min !== '' ? Number(filterAmount.min) : null;
    const maxAmt = filterAmount.max !== '' ? Number(filterAmount.max) : null;
    if (minAmt !== null) list = list.filter(c => Number(c.amount || 0) >= minAmt);
    if (maxAmt !== null) list = list.filter(c => Number(c.amount || 0) <= maxAmt);
    // ✅ Ajouter les filtres montant de l'IA
    if (aiFilters.minAmount > 0) {
      list = list.filter(c => Number(c.amount || 0) >= aiFilters.minAmount);
    }
    if (aiFilters.maxAmount < 999999) {
      list = list.filter(c => Number(c.amount || 0) <= aiFilters.maxAmount);
    }
    
    list.sort((a, b) => {
      let va = a[sort.field] ?? '';
      let vb = b[sort.field] ?? '';
      if (sort.field === 'amount')    { va = Number(va); vb = Number(vb); }
      if (sort.field === 'cost_date') { va = new Date(va); vb = new Date(vb); }
      if (va < vb) return sort.dir === 'asc' ? -1 :  1;
      if (va > vb) return sort.dir === 'asc' ?  1 : -1;
      return 0;
    });
    return list;
  }, [enriched, globalSearch, filterCat, filterSrc, filterMonth, filterAmount, sort, aiFilters]);

  const handleSort = field =>
    setSort(s => ({ field, dir: s.field === field && s.dir === 'asc' ? 'desc' : 'asc' }));

  const total  = displayed.reduce((s, c) => s + Number(c.amount || 0), 0);
  const avg    = displayed.length ? total / displayed.length : 0;
  const maxAmt = displayed.length ? Math.max(...displayed.map(c => Number(c.amount || 0))) : 0;

  const handleDelete = async id => {
    if (!window.confirm('Supprimer ce coût ?')) return;
    try {
      await costsService.deleteCost(id);
      toast.success('Coût supprimé');
      setCosts(c => c.filter(x => x.id !== id));
    } catch { toast.error('Erreur suppression'); }
  };

  const startEdit = cost => {
    setEditId(cost.id);
    setEditData({
      service_name:  cost.service_name  || '',
      amount:        cost.amount        || '',
      currency:      cost.currency      || 'EUR',
      cost_date:     cost.cost_date     || '',
      cost_category: cost.cost_category || '',
    });
  };

  const saveEdit = async id => {
    try {
      const updated = await costsService.updateCost(id, {
        ...editData, amount: parseFloat(editData.amount),
      });
      toast.success('Coût mis à jour');
      setCosts(c => c.map(x => x.id === id ? { ...x, ...updated } : x));
      setEditId(null);
    } catch { toast.error('Erreur mise à jour'); }
  };

  const hasFilters = globalSearch || filterCat || filterSrc || filterMonth || filterAmount.min !== '' || filterAmount.max !== '';
  const clearFilters = () => {
    setGlobalSearch('');
    setFilterCat('');
    setFilterSrc('');
    setFilterMonth('');
    setFilterAmount({ min: '', max: '' });
  };

  // ── Monthly breakdown (for "Total par mois" table) ────────────
  const monthlyStats = useMemo(() => {
    let base = [...enriched];
    if (globalSearch.trim()) {
      const q = globalSearch.trim().toLowerCase();
      base = base.filter(c =>
        (c.service_name || '').toLowerCase().includes(q) ||
        (c._lbl  || '').toLowerCase().includes(q) ||
        (c._ref  || '').toLowerCase().includes(q) ||
        (c._cat  || '').toLowerCase().includes(q) ||
        (c._src  || '').toLowerCase().includes(q) ||
        String(c.amount || '').includes(q)
      );
    }
    if (filterCat) base = base.filter(c => c._cat === filterCat);
    if (filterSrc) base = base.filter(c => c._src === filterSrc);

    const map = {};
    base.forEach(c => {
      if (!c.cost_date) return;
      const d = new Date(c.cost_date);
      if (isNaN(d)) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!map[key]) map[key] = { count: 0, total: 0 };
      map[key].count++;
      map[key].total += Number(c.amount || 0);
    });
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [enriched, globalSearch, filterCat, filterSrc]);

  const maxMonthTotal = useMemo(
    () => Math.max(...monthlyStats.map(([, v]) => v.total), 1),
    [monthlyStats]
  );

  const monthRangeLabel = useMemo(() => {
    if (!months.length) return 'aucun';
    if (months.length === 1) return fmtMonth(months[0]);
    return `${fmtMonth(months[months.length - 1])} – ${fmtMonth(months[0])}`;
  }, [months]);

  // ─── RENDER ───────────────────────────────────────────────────
  return (
    <Layout>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 24, flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: '#0f172a', letterSpacing: '-0.5px' }}>
            Coûts
          </h1>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 3 }}>
            Gérez vos dépenses cloud ·{' '}
            <span style={{ fontWeight: 700, color: '#1B5E46' }}>multi-sources</span>
            {' '}— OVHcloud, AWS, Azure, GCP, fichiers
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={loadCosts} style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px',
            background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 11,
            fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: '#374151',
          }}>
            <RefreshCw size={14}/> Actualiser
          </button>
          <button onClick={() => navigate('/files')} style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px',
            background: '#1B5E46', color: 'white', border: 'none', borderRadius: 11,
            fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: '0 4px 12px rgba(27,94,70,.25)',
          }}>
            <Upload size={14}/> Importer
          </button>
        </div>
      </div>

      {/* Empty banner */}
      {!loading && costs.length === 0 && (
        <div style={{
          background: '#fffbeb', border: '1.5px solid #fcd34d', borderRadius: 16,
          padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24,
        }}>
          <span style={{ fontSize: 28 }}>💡</span>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>
              Aucun coût disponible
            </p>
            <p style={{ fontSize: 12, color: '#b45309' }}>
              Importez un fichier PDF, Excel ou CSV pour extraire automatiquement vos coûts cloud.
            </p>
          </div>
          <button onClick={() => navigate('/files')} style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '10px 20px',
            background: '#d97706', color: 'white', border: 'none', borderRadius: 11,
            fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
          }}>
            <Upload size={14}/> Importer maintenant
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <KPICard
          label="Coût total"
          value={fmt2(total)}
          topColor="#2563eb" iconBg="#3b82f6"
          icon={DollarSign}
          sub={`${displayed.length} entrée${displayed.length !== 1 ? 's' : ''}`}
        />
        <KPICard
          label="Coût moyen"
          value={fmt2(avg)}
          topColor="#f97316" iconBg="#f97316"
          icon={BarChart2}
          sub="par entrée"
        />
        <KPICard
          label="Pic de coût"
          value={fmt2(maxAmt)}
          topColor="#ef4444" iconBg="#ef4444"
          icon={TrendingUp}
          sub="montant max"
        />
        <KPICard
          label="Mois importés"
          value={months.length}
          unit={months.length === 1 ? 'mois' : 'mois'}
          topColor="#7C3AED" iconBg="#7C3AED"
          icon={Calendar}
          sub={monthRangeLabel}
        />
      </div>

      {/* Search */}
      <div style={{
        background: 'white', borderRadius: 14, border: '1px solid #e8edf5',
        boxShadow: '0 1px 6px rgba(0,0,0,.04)', padding: '12px 16px',
        marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flex: 1,
          background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '0 12px',
        }}>
          <Search size={14} color="#94a3b8" style={{ flexShrink: 0 }}/>
          <input
            value={globalSearch}
            onChange={e => setGlobalSearch(e.target.value)}
            placeholder="Rechercher par service, référence, catégorie, source, montant…"
            style={{
              flex: 1, border: 'none', background: 'transparent', fontSize: 13,
              padding: '9px 0', outline: 'none', fontFamily: 'inherit', color: '#0f172a',
            }}
          />
          {globalSearch && (
            <button onClick={() => setGlobalSearch('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}>
              <X size={13}/>
            </button>
          )}
        </div>
        {globalSearch && (
          <span style={{
            fontSize: 12, fontWeight: 700, color: '#1B5E46', background: '#f0fdf4',
            padding: '5px 12px', borderRadius: 8, border: '1px solid #bbf7d0', whiteSpace: 'nowrap',
          }}>
            {displayed.length} résultat{displayed.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      
      
      {/* Filters */}
      <div style={{
        background: 'white', borderRadius: 14, padding: '12px 16px',
        border: '1px solid #e8edf5', boxShadow: '0 1px 6px rgba(0,0,0,.04)',
        marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
      }}>
        {/* Category */}
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{
          padding: '8px 12px', borderRadius: 9, border: '1.5px solid #e2e8f0', fontSize: 13,
          fontFamily: 'inherit', color: filterCat ? '#0f172a' : '#94a3b8',
          background: 'white', cursor: 'pointer', minWidth: 170,
        }}>
          <option value="">Toutes les catégories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* Source */}
        <select value={filterSrc} onChange={e => setFilterSrc(e.target.value)} style={{
          padding: '8px 12px', borderRadius: 9, border: '1.5px solid #e2e8f0', fontSize: 13,
          fontFamily: 'inherit', color: filterSrc ? '#0f172a' : '#94a3b8',
          background: 'white', cursor: 'pointer', minWidth: 160,
        }}>
          <option value="">Toutes les sources</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Month filter */}
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{
          padding: '8px 12px', borderRadius: 9, fontSize: 13,
          fontFamily: 'inherit', cursor: 'pointer', minWidth: 180,
          border: filterMonth ? '1.5px solid #7C3AED' : '1.5px solid #e2e8f0',
          color: filterMonth ? '#7C3AED' : '#94a3b8',
          background: 'white',
          fontWeight: filterMonth ? 700 : 400,
        }}>
          <option value="">Tous les mois</option>
          {months.map(m => (
            <option key={m} value={m}>
              {fmtMonth(m)}
            </option>
          ))}
        </select>


        {/* Amount range filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/* Quick range buttons */}
          {[
            { label: '0 – 50 €',   min: 0,   max: 50   },
            { label: '50 – 200 €', min: 50,  max: 200  },
            { label: '200 – 500 €',min: 200, max: 500  },
            { label: '> 500 €',    min: 500, max: ''   },
          ].map(r => {
            const active = String(filterAmount.min) === String(r.min) && String(filterAmount.max) === String(r.max);
            return (
              <button
                key={r.label}
                onClick={() => setFilterAmount(active ? { min: '', max: '' } : { min: r.min, max: r.max })}
                style={{
                  padding: '6px 11px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
                  border: active ? '1.5px solid #2563eb' : '1.5px solid #e2e8f0',
                  background: active ? '#eff6ff' : 'white',
                  color: active ? '#2563eb' : '#64748b',
                }}
              >
                {r.label}
              </button>
            );
          })}
          {/* Manual min/max inputs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="number" min="0" placeholder="Min €"
              value={filterAmount.min}
              onChange={e => setFilterAmount(a => ({ ...a, min: e.target.value }))}
              style={{
                width: 70, padding: '6px 8px', borderRadius: 8, fontSize: 12,
                border: filterAmount.min !== '' ? '1.5px solid #2563eb' : '1.5px solid #e2e8f0',
                fontFamily: 'inherit', outline: 'none', color: '#0f172a',
              }}
            />
            <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>–</span>
            <input
              type="number" min="0" placeholder="Max €"
              value={filterAmount.max}
              onChange={e => setFilterAmount(a => ({ ...a, max: e.target.value }))}
              style={{
                width: 70, padding: '6px 8px', borderRadius: 8, fontSize: 12,
                border: filterAmount.max !== '' ? '1.5px solid #2563eb' : '1.5px solid #e2e8f0',
                fontFamily: 'inherit', outline: 'none', color: '#0f172a',
              }}
            />
          </div>
          {(filterAmount.min !== '' || filterAmount.max !== '') && (
            <button
              onClick={() => setFilterAmount({ min: '', max: '' })}
              style={{
                width: 22, height: 22, borderRadius: '50%', border: 'none',
                background: '#e2e8f0', cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center', color: '#64748b',
                fontSize: 11, padding: 0,
              }}
            >
              ×
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', flexShrink: 0 }}>
          {hasFilters && (
            <button onClick={clearFilters} style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 12,
              color: '#ef4444', background: '#fff5f5', border: '1px solid #fca5a5',
              borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
            }}>
              <X size={12}/> Effacer
            </button>
          )}
          <span style={{ fontSize: 13, fontWeight: 700, color: '#374151', whiteSpace: 'nowrap' }}>
            {displayed.length} coût{displayed.length !== 1 ? 's' : ''} ·{' '}
            <span style={{ color: '#1B5E46' }}>{fmt2(total)} €</span>
          </span>
        </div>
      </div>

      {/* Main Table */}
      <div style={{
        background: 'white', borderRadius: 20, border: '1px solid #e8edf5',
        boxShadow: '0 2px 12px rgba(0,0,0,.05)', overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>
            <RefreshCw size={28} style={{ opacity: .3, margin: '0 auto 12px', display: 'block' }}/>
            <p style={{ fontSize: 13 }}>Chargement des coûts...</p>
          </div>
        ) : displayed.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>
            <FileText size={44} style={{ opacity: .2, margin: '0 auto 14px', display: 'block' }}/>
            <p style={{ fontSize: 15, fontWeight: 700, color: '#374151', marginBottom: 6 }}>Aucun coût trouvé</p>
            <p style={{ fontSize: 12 }}>
              {hasFilters ? 'Aucun résultat pour ces filtres.' : 'Importez des fichiers ou connectez une API.'}
            </p>
            {!hasFilters && (
              <button onClick={() => navigate('/files')} style={{
                marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '10px 20px', background: '#1B5E46', color: 'white',
                border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <Upload size={14}/> Importer des données
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, color: '#2563EB', minWidth: 160 }}>Référence</th>
                  <th style={{ ...thStyle, color: '#7C3AED', minWidth: 210 }}>Abonnement / Service</th>
                  <SortTh label="Montant"  field="amount"    sort={sort} onSort={handleSort}/>
                  <th style={thStyle}>Devise</th>
                  <SortTh label="Date"     field="cost_date" sort={sort} onSort={handleSort}/>
                  <th style={{ ...thStyle, color: '#1B5E46' }}>Disque</th>
                  <th style={thStyle}>Catégorie</th>
                  <th style={{ ...thStyle, color: '#0073d1' }}>Source</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((cost, i) => {
                  const isEdit   = editId === cost.id;
                  const cat      = cost._cat;
                  const lbl      = cost._lbl;
                  const disk     = cost._disk;
                  const ref      = cost._ref;
                  const catColor = CAT_COLOR_MAP[cat] || '#64748b';

                  return (
                    <tr key={cost.id} style={{
                      borderBottom: i < displayed.length - 1 ? '1px solid #f1f5f9' : 'none',
                      transition: 'background .1s',
                      background: isEdit ? '#f0fdf4' : 'white',
                    }}
                      onMouseEnter={e => { if (!isEdit) e.currentTarget.style.background = '#fafbfc'; }}
                      onMouseLeave={e => { if (!isEdit) e.currentTarget.style.background = 'white'; }}
                    >
                      {/* RÉFÉRENCE */}
                      <td style={{ padding: '10px 14px', minWidth: 150, maxWidth: 175 }}>
                        {ref ? (
                          <span title={ref} style={{
                            fontSize: 10,
                            fontFamily: "'Courier New', Courier, monospace",
                            fontWeight: 600, color: '#374151',
                            background: '#f8fafc', border: '1px solid #e2e8f0',
                            borderRadius: 6, padding: '3px 8px',
                            letterSpacing: '0.02em', whiteSpace: 'nowrap',
                            overflow: 'hidden', textOverflow: 'ellipsis',
                            maxWidth: 165, display: 'block',
                          }}>
                            {ref}
                          </span>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <div style={{
                              width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                              background: catColor + '18',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 11, fontWeight: 900, color: catColor,
                            }}>
                              {(cost.service_name || '?').charAt(0).toUpperCase()}
                            </div>
                            <span style={{ fontSize: 11, color: '#cbd5e1', fontStyle: 'italic' }}>N/A</span>
                          </div>
                        )}
                      </td>

                      {/* ABONNEMENT / SERVICE */}
                      <td style={{ padding: '10px 14px', maxWidth: 250 }}>
                        {isEdit ? (
                          <input
                            value={editData.service_name}
                            onChange={e => setEditData(d => ({ ...d, service_name: e.target.value }))}
                            style={{ ...inputStyle, width: 190 }}
                          />
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {lbl && <LabelBadge label={lbl} cat={cat} />}
                            <span title={cost.service_name} style={{
                              fontSize: 11, color: '#64748b', fontWeight: 400,
                              overflow: 'hidden', textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap', maxWidth: 230, display: 'block', lineHeight: '1.4',
                            }}>
                              {cost.service_name || '—'}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* MONTANT */}
                      <td style={{ padding: '10px 14px' }}>
                        {isEdit ? (
                          <input type="number" value={editData.amount}
                            onChange={e => setEditData(d => ({ ...d, amount: e.target.value }))}
                            style={{ ...inputStyle, width: 100 }}/>
                        ) : (
                          <span style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
                            {fmt2(cost.amount)} €
                          </span>
                        )}
                      </td>

                      {/* DEVISE */}
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, color: '#2563eb',
                          background: '#eff6ff', padding: '3px 8px', borderRadius: 6,
                        }}>
                          {cost.currency || 'EUR'}
                        </span>
                      </td>

                      {/* DATE */}
                      <td style={{ padding: '10px 14px', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                        {isEdit ? (
                          <input type="date" value={editData.cost_date}
                            onChange={e => setEditData(d => ({ ...d, cost_date: e.target.value }))}
                            style={inputStyle}/>
                        ) : fmtDate(cost.cost_date)}
                      </td>

                      {/* DISQUE */}
                      <td style={{ padding: '10px 14px' }}>
                        {disk ? (
                          <span style={{
                            fontSize: 11, fontWeight: 700, color: '#1B5E46',
                            background: '#f0fdf4', padding: '3px 10px', borderRadius: 7,
                            border: '1px solid #bbf7d0',
                            display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                          }}>
                            <HardDrive size={11}/> {disk}
                          </span>
                        ) : (
                          <span style={{ color: '#cbd5e1', fontSize: 13 }}>—</span>
                        )}
                      </td>

                      {/* CATÉGORIE */}
                      <td style={{ padding: '10px 14px' }}>
                        <CatBadge cat={cat}/>
                      </td>

                      {/* SOURCE */}
                      <td style={{ padding: '10px 14px' }}>
                        <SourceBadge
                          source={cost.source}
                          sourceRef={cost.source_ref}
                          filename={cost.filename || cost.source_file}
                        />
                      </td>

                      {/* ACTIONS */}
                      <td style={{ padding: '10px 14px' }}>
                        {isEdit ? (
                          <div style={{ display: 'flex', gap: 7 }}>
                            <button onClick={() => saveEdit(cost.id)} style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              padding: '6px 12px', background: '#1B5E46', color: 'white',
                              border: 'none', borderRadius: 8, cursor: 'pointer',
                              fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                            }}>
                              <Save size={12}/> Sauver
                            </button>
                            <button onClick={() => setEditId(null)} style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              padding: '6px 10px', background: '#f1f5f9', color: '#64748b',
                              border: 'none', borderRadius: 8, cursor: 'pointer',
                              fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                            }}>
                              <X size={12}/> Annuler
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => startEdit(cost)} title="Modifier" style={{
                              width: 32, height: 32, borderRadius: 8,
                              background: '#eff6ff', border: '1px solid #bfdbfe',
                              cursor: 'pointer', display: 'flex', alignItems: 'center',
                              justifyContent: 'center', color: '#2563eb',
                            }}>
                              <Edit2 size={13}/>
                            </button>
                            <button onClick={() => handleDelete(cost.id)} title="Supprimer" style={{
                              width: 32, height: 32, borderRadius: 8,
                              background: '#fff5f5', border: '1px solid #fca5a5',
                              cursor: 'pointer', display: 'flex', alignItems: 'center',
                              justifyContent: 'center', color: '#dc2626',
                            }}>
                              <Trash2 size={13}/>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Total par mois */}
      {!loading && monthlyStats.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 12, flexWrap: 'wrap', gap: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Calendar size={16} color="#7C3AED"/>
              <span style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.3px' }}>
                Total par mois
              </span>
              <span style={{
                fontSize: 11, fontWeight: 700, color: '#7C3AED',
                background: '#f5f3ff', padding: '2px 10px', borderRadius: 99,
                border: '1px solid #ddd6fe',
              }}>
                {monthlyStats.length} mois importé{monthlyStats.length > 1 ? 's' : ''}
              </span>
            </div>
            {filterMonth && (
              <button onClick={() => setFilterMonth('')} style={{
                display: 'flex', alignItems: 'center', gap: 5, fontSize: 12,
                color: '#7C3AED', background: '#f5f3ff', border: '1px solid #ddd6fe',
                borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
              }}>
                <X size={11}/> Voir tous les mois
              </button>
            )}
          </div>

          <div style={{
            background: 'white', borderRadius: 20, border: '1px solid #e8edf5',
            boxShadow: '0 2px 12px rgba(0,0,0,.05)', overflow: 'hidden',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, color: '#7C3AED' }}>Mois</th>
                  <th style={thStyle}>Entrées</th>
                  <th style={thStyle}>Total</th>
                  <th style={thStyle}>Coût moyen</th>
                  <th style={{ ...thStyle, minWidth: 200 }}>Répartition</th>
                </tr>
              </thead>
              <tbody>
                {monthlyStats.map(([key, val], i) => {
                  const isSelected = filterMonth === key;
                  const pct = (val.total / maxMonthTotal * 100).toFixed(1);
                  return (
                    <tr
                      key={key}
                      onClick={() => setFilterMonth(isSelected ? '' : key)}
                      style={{
                        borderBottom: i < monthlyStats.length - 1 ? '1px solid #f1f5f9' : 'none',
                        background: isSelected ? '#faf5ff' : 'white',
                        cursor: 'pointer', transition: 'background .1s',
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#fafbfc'; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'white'; }}
                    >
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{
                          fontSize: 12, fontWeight: 700,
                          color: isSelected ? '#7C3AED' : '#374151',
                          background: isSelected ? '#f5f3ff' : '#f8fafc',
                          border: `1px solid ${isSelected ? '#ddd6fe' : '#e2e8f0'}`,
                          borderRadius: 99, padding: '4px 13px',
                          display: 'inline-block',
                        }}>
                          {isSelected ? '● ' : ''}{fmtMonth(key)}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: 13, color: '#374151', fontWeight: 600 }}>
                        {val.count}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{ fontSize: 15, fontWeight: 900, color: '#0f172a' }}>
                          {fmt2(val.total)} €
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: 12, color: '#64748b' }}>
                        {fmt2(val.count ? val.total / val.count : 0)} €
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            flex: 1, background: '#f1f5f9', borderRadius: 4, height: 8, minWidth: 80,
                          }}>
                            <div style={{
                              height: 8, borderRadius: 4,
                              background: isSelected ? '#7C3AED' : '#a78bfa',
                              width: `${pct}%`, transition: 'width .4s ease',
                            }}/>
                          </div>
                          <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 36, textAlign: 'right' }}>
                            {pct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f8fafc', borderTop: '2px solid #e8edf5' }}>
                  <td style={{ padding: '12px 14px', fontSize: 12, fontWeight: 800, color: '#374151' }}>
                    TOTAL
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 700, color: '#374151' }}>
                    {monthlyStats.reduce((s, [, v]) => s + v.count, 0)}
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <span style={{ fontSize: 15, fontWeight: 900, color: '#1B5E46' }}>
                      {fmt2(monthlyStats.reduce((s, [, v]) => s + v.total, 0))} €
                    </span>
                  </td>
                  <td colSpan={2} style={{ padding: '12px 14px', fontSize: 11, color: '#94a3b8' }}>
                    Cliquez sur un mois pour filtrer le tableau
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </Layout>
  );
}