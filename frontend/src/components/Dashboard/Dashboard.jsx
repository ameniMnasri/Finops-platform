import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import {
  DollarSign, Zap, FolderOpen, TrendingUp, FileText,
  Activity, Download, RefreshCw, ArrowUpRight, ArrowDownRight,
  AlertTriangle, BarChart2,
} from 'lucide-react';
import Layout from '../Layout/Layout';
import { costsService } from '../../services/costs';
import toast from 'react-hot-toast';

// ══════════════════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════════════════

const COLORS = [
  '#1B5E46','#2563eb','#f97316','#8b5cf6','#ef4444',
  '#06b6d4','#84cc16','#f59e0b','#ec4899','#14b8a6',
  '#6366f1','#a855f7','#22c55e','#fb923c','#38bdf8',
];

const PERIOD_OPTIONS = [
  { label:'7j',   days:7   },
  { label:'30j',  days:30  },
  { label:'90j',  days:90  },
  { label:'Tout', days:null },
];

const SOURCE_ICONS = {
  OVHcloud:'🔷', AWS:'🟠', Azure:'🔵',
  GCP:'🔴', Fichier:'📄', Manuel:'✏️',
};

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

const fmt2 = v =>
  Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits:2, maximumFractionDigits:2 });

const fmt0 = v =>
  Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits:0, maximumFractionDigits:0 });

const parseDate = v => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const getMonthKey   = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const getMonthLabel = d => d.toLocaleDateString('fr-FR', { month:'short', year:'2-digit' });

const shortName = (name, maxLen = 28) => {
  if (!name) return '?';
  let s = String(name);
  s = s.replace(/\s*\d{2}\/\d{2}\/\d{4}/g,   '');
  s = s.replace(/\s*Sans engagement/gi,        '');
  s = s.replace(/\s*Monthly fees/gi,           '');
  s = s.replace(/\s*rental for \d+ months?/gi, '');
  s = s.replace(/\s*for 1 month/gi,            '');
  s = s.replace(/\[EUROPE\]/gi,                'EU');
  s = s.trim();
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
};

// ══════════════════════════════════════════════════════════════════════
// SOUS-COMPOSANTS
// ══════════════════════════════════════════════════════════════════════

function KPICard({ label, value, unit='€', icon:Icon, topColor, iconBg, sub, trend }) {
  const isUp   = trend > 0;
  const isZero = trend === 0 || trend === null || trend === undefined;
  return (
    <div style={{
      background:'white', borderRadius:18, padding:'18px 20px 14px',
      border:'1px solid #e8edf5', position:'relative', overflow:'hidden',
      boxShadow:'0 2px 12px rgba(0,0,0,.06)', flex:1, minWidth:160,
    }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:4,
                    background:topColor, borderRadius:'18px 18px 0 0' }}/>
      <div style={{ position:'absolute', right:-18, bottom:-18, width:88,
                    height:88, borderRadius:'50%', background:topColor+'12' }}/>
      <div style={{ display:'flex', alignItems:'center',
                    justifyContent:'space-between', marginBottom:10 }}>
        <span style={{ fontSize:10, fontWeight:800, color:'#94a3b8',
                       textTransform:'uppercase', letterSpacing:'.1em' }}>
          {label}
        </span>
        <div style={{ width:34, height:34, borderRadius:10, background:iconBg,
                      display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Icon size={16} color="white"/>
        </div>
      </div>
      <div style={{ display:'flex', alignItems:'baseline', gap:4, marginBottom:4 }}>
        <span style={{ fontSize:26, fontWeight:900, color:'#0f172a',
                       letterSpacing:'-1px', lineHeight:1, position:'relative', zIndex:1 }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontSize:13, fontWeight:700, color:'#94a3b8' }}>{unit}</span>
        )}
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:6, position:'relative', zIndex:1 }}>
        {!isZero && trend !== null && trend !== undefined && (
          <span style={{ display:'inline-flex', alignItems:'center', gap:3,
                         fontSize:11, fontWeight:700,
                         color: isUp ? '#ef4444' : '#16a34a' }}>
            {isUp ? <ArrowUpRight size={12}/> : <ArrowDownRight size={12}/>}
            {Math.abs(trend)}% vs mois dernier
          </span>
        )}
        {isZero && trend !== null && (
          <span style={{ fontSize:11, fontWeight:700, color:'#16a34a',
                         display:'flex', alignItems:'center', gap:3 }}>
            <ArrowDownRight size={12}/> 0% vs mois dernier
          </span>
        )}
        {sub && (
          <span style={{ fontSize:11, color:'#94a3b8' }}>{sub}</span>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ title, sub }) {
  return (
    <div style={{ marginBottom:12 }}>
      <h3 style={{ fontSize:15, fontWeight:800, color:'#0f172a', margin:0 }}>{title}</h3>
      {sub && <p style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>{sub}</p>}
    </div>
  );
}

function ChartCard({ children, title, sub, action, style={} }) {
  return (
    <div style={{
      background:'white', borderRadius:18, border:'1px solid #e8edf5',
      boxShadow:'0 2px 12px rgba(0,0,0,.05)', padding:'20px 22px',
      ...style,
    }}>
      <div style={{ display:'flex', alignItems:'flex-start',
                    justifyContent:'space-between', marginBottom:16 }}>
        <SectionTitle title={title} sub={sub}/>
        {action}
      </div>
      {children}
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background:'white', border:'1px solid #e2e8f0', borderRadius:12,
      padding:'10px 14px', boxShadow:'0 4px 20px rgba(0,0,0,.12)', maxWidth:280,
    }}>
      <p style={{ fontSize:12, fontWeight:700, color:'#374151', marginBottom:6 }}>{label}</p>
      {payload.map((p, i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
          <span style={{ width:8, height:8, borderRadius:'50%',
                         background:p.color, flexShrink:0 }}/>
          <span style={{ fontSize:11, color:'#64748b', flex:1,
                         overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {shortName(p.dataKey, 25)}
          </span>
          <span style={{ fontSize:11, fontWeight:700, color:'#0f172a', flexShrink:0 }}>
            {fmt2(p.value)} €
          </span>
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════

export default function Dashboard() {
  const [costs,      setCosts]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [period,     setPeriod]     = useState('Tout');
  const [lastUpdate, setLastUpdate] = useState(new Date());

  const [chartTypeEvol,    setChartTypeEvol]    = useState('line');
  const [chartTypeServer,  setChartTypeServer]  = useState('bar');
  const [chartTypeService, setChartTypeService] = useState('stacked');

  // ── Load ──────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await costsService.getCosts(0, 5000);
      setCosts(Array.isArray(data) ? data : []);
      setLastUpdate(new Date());
    } catch (e) {
      const d   = e?.response?.data?.detail;
      const msg = typeof d === 'string' ? d : e.message;
      toast.error('Erreur chargement: ' + msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Filtrer par période ───────────────────────────────────────────
  const filtered = useMemo(() => {
    const opt = PERIOD_OPTIONS.find(p => p.label === period);
    if (!opt?.days) return costs;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - opt.days);
    return costs.filter(c => {
      const d = parseDate(c.cost_date);
      return d && d >= cutoff;
    });
  }, [costs, period]);

  // ── Analytics ─────────────────────────────────────────────────────
  const analytics = useMemo(() => {
    if (!filtered.length) return null;

    const total    = filtered.reduce((s, c) => s + Number(c.amount || 0), 0);
    const avg      = total / filtered.length;
    const maxCost  = Math.max(...filtered.map(c => Number(c.amount || 0)));
    const maxEntry = filtered.find(c => Number(c.amount || 0) === maxCost);

    const rawServices = [...new Set(filtered.map(c => c.service_name).filter(Boolean))];
    const services    = rawServices.map(s => shortName(s, 28));
    const projects    = [...new Set(filtered.map(c => c.project_id).filter(Boolean))];

    // ── Évolution mensuelle totale ──
    const mMap = {};
    filtered.forEach(c => {
      const d = parseDate(c.cost_date);
      if (!d) return;
      const key = getMonthKey(d);
      if (!mMap[key]) mMap[key] = { month: key, label: getMonthLabel(d), total: 0 };
      mMap[key].total += Number(c.amount || 0);
    });
    const byMonth = Object.values(mMap).sort((a, b) => a.month.localeCompare(b.month));

    // ── Top 10 services par coût total ──
    const serverTotals = {};
    filtered.forEach(c => {
      const k = shortName(c.service_name, 28);
      serverTotals[k] = (serverTotals[k] || 0) + Number(c.amount || 0);
    });
    const top10Services = Object.entries(serverTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k]) => k);

    // ── Par service par mois ──
    const smMap = {};
    filtered.forEach(c => {
      const d = parseDate(c.cost_date);
      if (!d) return;
      const key  = getMonthKey(d);
      const sKey = shortName(c.service_name, 28);
      if (!smMap[key]) {
        smMap[key] = { month: key, label: getMonthLabel(d) };
        top10Services.forEach(s => { smMap[key][s] = 0; });
      }
      if (sKey in smMap[key]) smMap[key][sKey] += Number(c.amount || 0);
    });
    const byServiceMonth = Object.values(smMap).sort((a, b) => a.month.localeCompare(b.month));

    // ── Par serveur par mois (top 10) ──
    const svMap = {};
    filtered.forEach(c => {
      const d = parseDate(c.cost_date);
      if (!d) return;
      const key  = getMonthKey(d);
      const sKey = shortName(c.service_name, 28);
      if (!top10Services.includes(sKey)) return;
      if (!svMap[key]) {
        svMap[key] = { month: key, label: getMonthLabel(d) };
        top10Services.forEach(s => { svMap[key][s] = 0; });
      }
      if (sKey in svMap[key]) svMap[key][sKey] += Number(c.amount || 0);
    });
    const byServerMonth = Object.values(svMap).sort((a, b) => a.month.localeCompare(b.month));

    // ── Distribution par projet ──
    const projMap = {};
    filtered.forEach(c => {
      const k = c.project_id || 'Sans projet';
      projMap[k] = (projMap[k] || 0) + Number(c.amount || 0);
    });
    const byProject = Object.entries(projMap)
      .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    // ── Top services ──
    const topServices = Object.entries(serverTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, total]) => ({ name, total }));

    // ── Par source ──
    const srcMap = {};
    filtered.forEach(c => {
      const k = c.source || 'Fichier';
      srcMap[k] = (srcMap[k] || 0) + Number(c.amount || 0);
    });
    const bySource = Object.entries(srcMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // ── Coûts par service (barres) ──
    const bySvc = Object.entries(serverTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([service, total]) => ({ service, total: Math.round(total * 100) / 100 }));

    // ── Trend vs mois précédent ──
    const months = [...new Set(filtered.map(c => {
      const d = parseDate(c.cost_date);
      return d ? getMonthKey(d) : null;
    }).filter(Boolean))].sort();

    let trendPct = 0;
    if (months.length >= 2) {
      const curr = mMap[months[months.length - 1]]?.total || 0;
      const prev = mMap[months[months.length - 2]]?.total || 0;
      trendPct   = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : 0;
    }

    return {
      total, avg, maxCost, maxEntry,
      nbServices: rawServices.length,
      nbProjects: projects.length,
      nbEntries:  filtered.length,
      trendPct,
      services:       top10Services,
      byMonth,
      byServiceMonth,
      byServerMonth,
      byProject,
      topServices,
      bySource,
      bySvc,
    };
  }, [filtered]);

  // ── Export CSV ────────────────────────────────────────────────────
  const handleExport = () => {
    if (!filtered.length) return;
    const headers = ['Date','Service','Montant','Devise','Projet','Équipe','Catégorie','Source'];
    const rows    = filtered.map(c =>
      [c.cost_date, c.service_name, c.amount, c.currency,
       c.project_id||'', c.team_id||'', c.cost_category||'', c.source||''].join(',')
    );
    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type:'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `finops-export-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Export CSV téléchargé !');
  };

  const legendFormatter = (value) => (
    <span style={{ fontSize:10, color:'#64748b' }}>{shortName(value, 22)}</span>
  );

  const isEmptyState = !loading && !filtered.length;

  // ── RENDER ────────────────────────────────────────────────────────
  return (
    <Layout>
      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .spin { animation:spin 1s linear infinite }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                    marginBottom:24, flexWrap:'wrap', gap:12 }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <Activity size={22} color="#1B5E46"/>
            <h1 style={{ fontSize:22, fontWeight:900, color:'#0f172a',
                         letterSpacing:'-0.5px', margin:0 }}>
              FinOps Dashboard
            </h1>
          </div>
          <p style={{ fontSize:12, color:'#94a3b8', marginTop:4,
                      display:'flex', alignItems:'center', gap:5 }}>
            <Zap size={11} color="#f59e0b"/>
            Dernière mise à jour : {lastUpdate.toLocaleTimeString('fr-FR')}
          </p>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          {/* Sélecteur période */}
          <div style={{ display:'flex', background:'#f1f5f9', borderRadius:10,
                        padding:3, gap:2 }}>
            {PERIOD_OPTIONS.map(opt => (
              <button key={opt.label} onClick={() => setPeriod(opt.label)} style={{
                padding:'6px 14px', borderRadius:8, border:'none',
                fontFamily:'inherit', fontSize:12, fontWeight:600,
                cursor:'pointer', transition:'all .15s',
                background: period===opt.label ? 'white' : 'transparent',
                color:      period===opt.label ? '#1B5E46' : '#94a3b8',
                boxShadow:  period===opt.label ? '0 1px 4px rgba(0,0,0,.1)' : 'none',
              }}>
                {opt.label}
              </button>
            ))}
          </div>
          <button onClick={handleExport} disabled={!filtered.length} style={{
            display:'flex', alignItems:'center', gap:6, padding:'8px 16px',
            background:'white', border:'1.5px solid #e2e8f0', borderRadius:10,
            fontWeight:600, fontSize:12, cursor: filtered.length ? 'pointer':'not-allowed',
            fontFamily:'inherit', color:'#374151', opacity: filtered.length ? 1 : .5,
          }}>
            <Download size={13}/> Export
          </button>
          <button onClick={loadData} style={{
            display:'flex', alignItems:'center', gap:6, padding:'8px 16px',
            background:'#1B5E46', color:'white', border:'none', borderRadius:10,
            fontWeight:600, fontSize:12, cursor:'pointer', fontFamily:'inherit',
          }}>
            <RefreshCw size={13} className={loading ? 'spin':''}/>
            Actualiser
          </button>
        </div>
      </div>

      {/* ── État vide ── */}
      {isEmptyState && (
        <div style={{ background:'#fffbeb', border:'1.5px solid #fcd34d',
                      borderRadius:16, padding:'24px', textAlign:'center',
                      marginBottom:24 }}>
          <AlertTriangle size={32} color="#d97706"
                         style={{ margin:'0 auto 12px', display:'block' }}/>
          <p style={{ fontSize:15, fontWeight:700, color:'#92400e', marginBottom:6 }}>
            Aucune donnée disponible
          </p>
          <p style={{ fontSize:12, color:'#b45309' }}>
            Importez des fichiers (Excel, CSV, PDF OVH) ou connectez une API cloud.
          </p>
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div style={{ display:'flex', gap:14, flexWrap:'wrap', marginBottom:20 }}>
        <KPICard label="Coût total"
          value={fmt2(analytics?.total || 0)}
          topColor="#2563eb" iconBg="#3b82f6" icon={DollarSign}
          trend={analytics?.trendPct}
          sub={`${analytics?.nbEntries || 0} entrées`}
        />
        <KPICard label="Services actifs"
          value={analytics?.nbServices || 0} unit=""
          topColor="#1B5E46" iconBg="#1B5E46" icon={Zap}
          trend={null} sub="services cloud actifs"
        />
        <KPICard label="Projets"
          value={analytics?.nbProjects || 0} unit=""
          topColor="#8b5cf6" iconBg="#8b5cf6" icon={FolderOpen}
          trend={null} sub="projets actifs"
        />
        <KPICard label="Coût moyen"
          value={fmt2(analytics?.avg || 0)}
          topColor="#f97316" iconBg="#f97316" icon={BarChart2}
          trend={null} sub="par entrée"
        />
        <KPICard label="Pic de coût"
          value={fmt2(analytics?.maxCost || 0)}
          topColor="#ef4444" iconBg="#ef4444" icon={TrendingUp}
          trend={null}
          sub={analytics?.maxEntry
            ? `↑ ${shortName(analytics.maxEntry.service_name, 20)}`
            : 'montant max'}
        />
        <KPICard label="Entrées"
          value={analytics?.nbEntries || 0} unit=""
          topColor="#06b6d4" iconBg="#06b6d4" icon={FileText}
          trend={null} sub="lignes de coûts"
        />
      </div>

      {analytics && (
        <>
          {/* ── Ligne 1 : Évolution + Distribution ── */}
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr',
                        gap:16, marginBottom:16 }}>

            {/* Évolution mensuelle */}
            <ChartCard
              title="Évolution des coûts"
              sub={`${period === 'Tout' ? 'Tout' : period} · coûts réels`}
              action={
                <div style={{ display:'flex', background:'#f1f5f9',
                              borderRadius:8, padding:2, gap:1 }}>
                  {[['line','Courbes'],['bar','Barres'],['area','Area']].map(([v,l]) => (
                    <button key={v} onClick={() => setChartTypeEvol(v)} style={{
                      padding:'4px 10px', borderRadius:6, border:'none',
                      fontFamily:'inherit', fontSize:11, fontWeight:600,
                      cursor:'pointer', transition:'all .1s',
                      background: chartTypeEvol===v ? 'white':'transparent',
                      color:      chartTypeEvol===v ? '#1B5E46':'#94a3b8',
                    }}>{l}</button>
                  ))}
                </div>
              }
            >
              <ResponsiveContainer width="100%" height={240}>
                {chartTypeEvol === 'bar' ? (
                  <BarChart data={analytics.byMonth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                    <XAxis dataKey="label" tick={{ fontSize:11, fill:'#94a3b8' }}/>
                    <YAxis tick={{ fontSize:11, fill:'#94a3b8' }}
                           tickFormatter={v => `${fmt0(v)}€`}/>
                    <Tooltip content={<CustomTooltip/>}/>
                    <Bar dataKey="total" fill="#1B5E46" radius={[6,6,0,0]} name="Total"/>
                  </BarChart>
                ) : chartTypeEvol === 'area' ? (
                  <AreaChart data={analytics.byMonth}>
                    <defs>
                      <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#1B5E46" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#1B5E46" stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                    <XAxis dataKey="label" tick={{ fontSize:11, fill:'#94a3b8' }}/>
                    <YAxis tick={{ fontSize:11, fill:'#94a3b8' }}
                           tickFormatter={v => `${fmt0(v)}€`}/>
                    <Tooltip content={<CustomTooltip/>}/>
                    <Area dataKey="total" stroke="#1B5E46" strokeWidth={2.5}
                          fill="url(#gradTotal)" name="Total"/>
                  </AreaChart>
                ) : (
                  <LineChart data={analytics.byMonth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                    <XAxis dataKey="label" tick={{ fontSize:11, fill:'#94a3b8' }}/>
                    <YAxis tick={{ fontSize:11, fill:'#94a3b8' }}
                           tickFormatter={v => `${fmt0(v)}€`}/>
                    <Tooltip content={<CustomTooltip/>}/>
                    <Line dataKey="total" stroke="#1B5E46" strokeWidth={2.5}
                          dot={{ r:4, fill:'#1B5E46' }} name="Total"/>
                  </LineChart>
                )}
              </ResponsiveContainer>
            </ChartCard>

            {/* Distribution par projet */}
            <ChartCard title="Distribution" sub="Répartition par projet">
              {analytics.byProject.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={analytics.byProject} cx="50%" cy="50%"
                           innerRadius={52} outerRadius={80}
                           paddingAngle={3} dataKey="value">
                        {analytics.byProject.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]}/>
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => [`${fmt2(v)} €`, '']}/>
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ marginTop:8 }}>
                    {analytics.byProject.slice(0, 5).map((p, i) => (
                      <div key={i} style={{ display:'flex', alignItems:'center',
                                            gap:7, marginBottom:5 }}>
                        <span style={{ width:8, height:8, borderRadius:'50%',
                                       background:COLORS[i%COLORS.length], flexShrink:0 }}/>
                        <span style={{ fontSize:11, color:'#374151', flex:1,
                                       overflow:'hidden', textOverflow:'ellipsis',
                                       whiteSpace:'nowrap' }}>
                          {shortName(p.name, 20)}
                        </span>
                        <span style={{ fontSize:11, fontWeight:700, color:'#0f172a',
                                       flexShrink:0 }}>
                          {fmt2(p.value)} €
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ textAlign:'center', padding:'30px 0', color:'#94a3b8' }}>
                  <FolderOpen size={32} style={{ opacity:.3, marginBottom:8,
                               display:'block', margin:'0 auto 8px' }}/>
                  <p style={{ fontSize:12 }}>Aucun projet renseigné</p>
                  <p style={{ fontSize:11, marginTop:4 }}>
                    Tous les coûts sont sous "Sans projet"
                  </p>
                </div>
              )}
            </ChartCard>
          </div>

          {/* ── Ligne 2 : Top Services + Coûts par Service ── */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr',
                        gap:16, marginBottom:16 }}>

            {/* Top Services */}
            <ChartCard title="Top Services" sub="Par coût total">
              <div>
                {analytics.topServices.map((s, i) => {
                  const pct = analytics.total > 0
                    ? Math.round((s.total / analytics.total) * 100) : 0;
                  return (
                    <div key={i} style={{ marginBottom:12 }}>
                      <div style={{ display:'flex', justifyContent:'space-between',
                                    marginBottom:4 }}>
                        <span style={{ fontSize:12, fontWeight:600, color:'#374151',
                                       flex:1, overflow:'hidden', textOverflow:'ellipsis',
                                       whiteSpace:'nowrap', paddingRight:8 }}>
                          {i+1}. {shortName(s.name, 24)}
                        </span>
                        <span style={{ fontSize:12, fontWeight:800, color:'#0f172a',
                                       flexShrink:0 }}>
                          {fmt2(s.total)} €
                          <span style={{ fontSize:10, color:'#94a3b8',
                                         fontWeight:400, marginLeft:4 }}>
                            {pct}%
                          </span>
                        </span>
                      </div>
                      <div style={{ height:5, background:'#f1f5f9', borderRadius:99 }}>
                        <div style={{
                          height:5, borderRadius:99,
                          background: COLORS[i % COLORS.length],
                          width:`${pct}%`, transition:'width .5s',
                        }}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ChartCard>

            {/* Coûts par Service */}
            <ChartCard title="Coûts par Service" sub="Comparaison des montants">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={analytics.bySvc}
                          margin={{ left:10, right:10, top:5, bottom:60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                  <XAxis dataKey="service"
                         tick={{ fontSize:9, fill:'#94a3b8' }}
                         tickFormatter={v => shortName(v, 14)}
                         angle={-35} textAnchor="end" interval={0}/>
                  <YAxis tick={{ fontSize:10, fill:'#94a3b8' }}
                         tickFormatter={v => `${fmt0(v)}€`}/>
                  <Tooltip
                    formatter={(v, n) => [`${fmt2(v)} €`, shortName(n, 25)]}
                    labelFormatter={l => shortName(l, 30)}
                  />
                  <Bar dataKey="total" radius={[6,6,0,0]} name="Coût total">
                    {analytics.bySvc.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]}/>
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* ── Ligne 3 : Évolution par serveur ── */}
          <ChartCard
            title="Évolution par serveur"
            sub={`Coût mensuel · top 10 services · ${period}`}
            style={{ marginBottom:16 }}
            action={
              <div style={{ display:'flex', background:'#f1f5f9',
                            borderRadius:8, padding:2, gap:1 }}>
                {[['bar','Barres'],['line','Courbes']].map(([v,l]) => (
                  <button key={v} onClick={() => setChartTypeServer(v)} style={{
                    padding:'4px 10px', borderRadius:6, border:'none',
                    fontFamily:'inherit', fontSize:11, fontWeight:600,
                    cursor:'pointer', transition:'all .1s',
                    background: chartTypeServer===v ? 'white':'transparent',
                    color:      chartTypeServer===v ? '#1B5E46':'#94a3b8',
                  }}>{l}</button>
                ))}
              </div>
            }
          >
            <ResponsiveContainer width="100%" height={280}>
              {chartTypeServer === 'bar' ? (
                <BarChart data={analytics.byServerMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                  <XAxis dataKey="label" tick={{ fontSize:11, fill:'#94a3b8' }}/>
                  <YAxis tick={{ fontSize:11, fill:'#94a3b8' }}
                         tickFormatter={v => `${fmt0(v)}€`}/>
                  <Tooltip content={<CustomTooltip/>}/>
                  <Legend formatter={legendFormatter} iconType="circle" iconSize={8}
                          wrapperStyle={{ fontSize:10, paddingTop:12 }}/>
                  {analytics.services.map((s, i) => (
                    <Bar key={s} dataKey={s} stackId="a"
                         fill={COLORS[i % COLORS.length]}
                         radius={i===analytics.services.length-1 ? [4,4,0,0]:[0,0,0,0]}/>
                  ))}
                </BarChart>
              ) : (
                <LineChart data={analytics.byServerMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                  <XAxis dataKey="label" tick={{ fontSize:11, fill:'#94a3b8' }}/>
                  <YAxis tick={{ fontSize:11, fill:'#94a3b8' }}
                         tickFormatter={v => `${fmt0(v)}€`}/>
                  <Tooltip content={<CustomTooltip/>}/>
                  <Legend formatter={legendFormatter} iconType="circle" iconSize={8}
                          wrapperStyle={{ fontSize:10, paddingTop:12 }}/>
                  {analytics.services.map((s, i) => (
                    <Line key={s} dataKey={s} stroke={COLORS[i % COLORS.length]}
                          strokeWidth={1.5} dot={false}/>
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
          </ChartCard>

          {/* ── Ligne 4 : Évolution par service ── */}
          <ChartCard
            title="Évolution par service"
            sub={`Décomposition du total · ${period}`}
            style={{ marginBottom:16 }}
            action={
              <div style={{ display:'flex', background:'#f1f5f9',
                            borderRadius:8, padding:2, gap:1 }}>
                {[['stacked','Empilé'],['line','Courbes'],['area','Area']].map(([v,l]) => (
                  <button key={v} onClick={() => setChartTypeService(v)} style={{
                    padding:'4px 10px', borderRadius:6, border:'none',
                    fontFamily:'inherit', fontSize:11, fontWeight:600,
                    cursor:'pointer', transition:'all .1s',
                    background: chartTypeService===v ? 'white':'transparent',
                    color:      chartTypeService===v ? '#1B5E46':'#94a3b8',
                  }}>{l}</button>
                ))}
              </div>
            }
          >
            <ResponsiveContainer width="100%" height={280}>
              {chartTypeService === 'stacked' ? (
                <BarChart data={analytics.byServiceMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                  <XAxis dataKey="label" tick={{ fontSize:11, fill:'#94a3b8' }}/>
                  <YAxis tick={{ fontSize:11, fill:'#94a3b8' }}
                         tickFormatter={v => `${fmt0(v)}€`}/>
                  <Tooltip content={<CustomTooltip/>}/>
                  <Legend formatter={legendFormatter} iconType="circle" iconSize={8}
                          wrapperStyle={{ fontSize:10, paddingTop:12 }}/>
                  {analytics.services.map((s, i) => (
                    <Bar key={s} dataKey={s} stackId="b"
                         fill={COLORS[i % COLORS.length]}/>
                  ))}
                </BarChart>
              ) : chartTypeService === 'area' ? (
                <AreaChart data={analytics.byServiceMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                  <XAxis dataKey="label" tick={{ fontSize:11, fill:'#94a3b8' }}/>
                  <YAxis tick={{ fontSize:11, fill:'#94a3b8' }}
                         tickFormatter={v => `${fmt0(v)}€`}/>
                  <Tooltip content={<CustomTooltip/>}/>
                  <Legend formatter={legendFormatter} iconType="circle" iconSize={8}
                          wrapperStyle={{ fontSize:10, paddingTop:12 }}/>
                  {analytics.services.map((s, i) => (
                    <Area key={s} dataKey={s} stackId="c"
                          stroke={COLORS[i % COLORS.length]}
                          fill={COLORS[i % COLORS.length]}
                          fillOpacity={0.6}/>
                  ))}
                </AreaChart>
              ) : (
                <LineChart data={analytics.byServiceMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                  <XAxis dataKey="label" tick={{ fontSize:11, fill:'#94a3b8' }}/>
                  <YAxis tick={{ fontSize:11, fill:'#94a3b8' }}
                         tickFormatter={v => `${fmt0(v)}€`}/>
                  <Tooltip content={<CustomTooltip/>}/>
                  <Legend formatter={legendFormatter} iconType="circle" iconSize={8}
                          wrapperStyle={{ fontSize:10, paddingTop:12 }}/>
                  {analytics.services.map((s, i) => (
                    <Line key={s} dataKey={s} stroke={COLORS[i % COLORS.length]}
                          strokeWidth={1.5} dot={false}/>
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
          </ChartCard>

          {/* ── Ligne 5 : Par Source + Suivi Budget ── */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:16 }}>

            {/* Par source */}
            <ChartCard title="Par source" sub="Origine des données">
              {analytics.bySource.length > 0 ? (
                <div>
                  {analytics.bySource.map((s, i) => {
                    const pct = analytics.total > 0
                      ? Math.round((s.value / analytics.total) * 100) : 0;
                    return (
                      <div key={i} style={{ marginBottom:12 }}>
                        <div style={{ display:'flex', justifyContent:'space-between',
                                      marginBottom:4 }}>
                          <span style={{ fontSize:12, fontWeight:600, color:'#374151',
                                         display:'flex', alignItems:'center', gap:5 }}>
                            <span>{SOURCE_ICONS[s.name] || '📊'}</span>
                            {s.name}
                          </span>
                          <span style={{ fontSize:12, fontWeight:800, color:'#0f172a' }}>
                            {fmt2(s.value)} €
                            <span style={{ fontSize:10, color:'#94a3b8',
                                           fontWeight:400, marginLeft:4 }}>
                              {pct}%
                            </span>
                          </span>
                        </div>
                        <div style={{ height:5, background:'#f1f5f9', borderRadius:99 }}>
                          <div style={{
                            height:5, borderRadius:99,
                            background: COLORS[i % COLORS.length],
                            width:`${pct}%`,
                          }}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p style={{ fontSize:12, color:'#94a3b8', textAlign:'center',
                             padding:'20px 0' }}>Aucune source</p>
              )}
            </ChartCard>

            {/* Suivi Budget */}
            <ChartCard title="Suivi Budget" sub="Consommation par service">
              <div style={{ maxHeight:280, overflowY:'auto' }}>
                {analytics.topServices.map((s, i) => {
                  const budget = s.total * 1.2;
                  const pct    = Math.min(Math.round((s.total / budget) * 100), 100);
                  const color  = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#16a34a';
                  return (
                    <div key={i} style={{ marginBottom:14 }}>
                      <div style={{ display:'flex', justifyContent:'space-between',
                                    marginBottom:5, alignItems:'center' }}>
                        <span style={{ fontSize:11, fontWeight:600, color:'#374151',
                                       flex:1, overflow:'hidden', textOverflow:'ellipsis',
                                       whiteSpace:'nowrap', paddingRight:8 }}>
                          {shortName(s.name, 30)}
                        </span>
                        <span style={{ fontSize:11, fontWeight:800, color, flexShrink:0 }}>
                          {pct}%
                        </span>
                      </div>
                      <div style={{ height:6, background:'#f1f5f9', borderRadius:99 }}>
                        <div style={{
                          height:6, borderRadius:99, background:color,
                          width:`${pct}%`, transition:'width .5s',
                        }}/>
                      </div>
                      <div style={{ display:'flex', justifyContent:'space-between',
                                    marginTop:3 }}>
                        <span style={{ fontSize:10, color:'#94a3b8' }}>
                          {fmt2(s.total)} € utilisés
                        </span>
                        <span style={{ fontSize:10, color:'#94a3b8' }}>
                          Budget: {fmt2(budget)} €
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ChartCard>
          </div>
        </>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign:'center', padding:'60px 0', color:'#94a3b8' }}>
          <RefreshCw size={32} className="spin"
                     style={{ margin:'0 auto 12px', display:'block', opacity:.4 }}/>
          <p style={{ fontSize:14 }}>Chargement des données...</p>
        </div>
      )}
    </Layout>
  );
}