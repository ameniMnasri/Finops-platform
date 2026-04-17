import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
  LineChart, Line, ReferenceLine, Area, AreaChart, ComposedChart,
} from 'recharts';
import {
  DollarSign, Zap, FolderOpen, TrendingUp, FileText,
  Activity, Download, RefreshCw, ArrowUpRight, ArrowDownRight,
  AlertTriangle, BarChart2, Receipt, Percent, ChevronDown, Check,
  Server, Settings, Flame, Minus, Eye, EyeOff, TrendingDown,
} from 'lucide-react';
import Layout from '../Layout/Layout';
import { costsService } from '../../services/costs';
import toast from 'react-hot-toast';

// ══════════════════════════════════════════════════════════════════════
// PALETTE
// ══════════════════════════════════════════════════════════════════════
const COLORS = [
  '#1B5E46','#2563EB','#0891B2','#7C3AED','#0F766E',
  '#1D4ED8','#6D28D9','#047857','#1E40AF','#065F46',
];

const CAT_COLOR_MAP = {
  VPS:       '#7C3AED',
  Dedicated: '#2563EB',
  IP:        '#0891B2',
  Snapshot:  '#0F766E',
  Option:    '#B45309',
  Storage:   '#1B5E46',
  Backup:    '#9333EA',
  'DNS/NS':  '#047857',
  Autre:     '#64748B',
};

const CAT_BG = {
  VPS:'#f5f3ff', Dedicated:'#eff6ff', IP:'#e0f2fe',
  Snapshot:'#f0fdfa', Option:'#fffbeb', Storage:'#f0fdf4',
  Backup:'#faf5ff', 'DNS/NS':'#f0fdf4', Autre:'#f8fafc',
};

const PERIOD_OPTIONS = [
  { label:'7j',   days:7   },
  { label:'30j',  days:30  },
  { label:'90j',  days:90  },
  { label:'Tout', days:null },
];

const SOURCE_ICONS = {
  OVHcloud:'🔷', AWS:'🟠', Azure:'🔵', GCP:'🔴', Fichier:'📄', Manuel:'✏️',
};

// ══════════════════════════════════════════════════════════════════════
// DÉTECTION OVH
// ══════════════════════════════════════════════════════════════════════
function detectOvhCategory(name) {
  if (!name) return 'Autre';
  const n = name.toUpperCase();
  if (n.includes('VPS'))                                         return 'VPS';
  if (n.includes('IP') || n.includes('FAILOVER'))               return 'IP';
  if (n.includes('SNAPSHOT'))                                    return 'Snapshot';
  if (n.includes('OPTION') || n.includes('ADDITIONAL DISK'))    return 'Option';
  if (n.includes('BACKUP'))                                      return 'Backup';
  if (n.includes('HGR') || n.includes('SDS'))                   return 'Storage';
  if (n.includes('NS') || n.includes('DNS'))                    return 'DNS/NS';
  if (
    n.includes('SERVER') || n.includes('EG-') || n.includes('ADVANCE') ||
    n.includes('RISE')   || n.includes('BIG-')|| n.includes('SP-') || n.includes('HG-')
  )                                                              return 'Dedicated';
  return 'Autre';
}

const isServer  = cat => cat === 'VPS' || cat === 'Dedicated';
const isService = cat => !isServer(cat);

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════
const fmt2 = v =>
  Number(v||0).toLocaleString('fr-FR', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmt0 = v =>
  Number(v||0).toLocaleString('fr-FR', { minimumFractionDigits:0, maximumFractionDigits:0 });

const parseDate = v => {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{2}\/\d{2}\/\d{4}/.test(v)) {
    const [day, month, year] = v.split('/');
    const d = new Date(`${year}-${month}-${day.slice(0,2)}`);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};
const getMonthKey   = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;

const MONTH_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
const getMonthLabel = d => `${MONTH_FR[d.getMonth()]} ${d.getFullYear()}`;

const shortName = (name, maxLen=28) => {
  if (!name) return '?';
  let s = String(name)
    .replace(/\s*\d{2}\/\d{2}\/\d{4}/g,'').replace(/\s*Sans engagement/gi,'')
    .replace(/\s*Monthly fees/gi,'').replace(/\s*rental for \d+ months?/gi,'')
    .replace(/\s*for 1 month/gi,'').replace(/\[EUROPE\]/gi,'EU').trim();
  return s.length > maxLen ? s.slice(0, maxLen-1)+'…' : s;
};

function heatColor(value, max) {
  if (!max || max === 0 || value === 0) return '#f1f5f9';
  const ratio = Math.pow(value / max, 0.55);
  if (ratio < 0.25) {
    const t = ratio / 0.25;
    return `rgb(${Math.round(219+(254-219)*t)},${Math.round(234+(240-234)*t)},${Math.round(254+(138-254)*t)})`;
  } else if (ratio < 0.6) {
    const t = (ratio - 0.25) / 0.35;
    return `rgb(${Math.round(254+(234-254)*t)},${Math.round(240+(88-240)*t)},${Math.round(138+(12-138)*t)})`;
  } else {
    const t = (ratio - 0.6) / 0.4;
    return `rgb(${Math.round(234+(27-234)*t)},${Math.round(88+(94-88)*t)},${Math.round(12+(70-12)*t)})`;
  }
}

function heatTextColor(value, max) {
  if (!max || value === 0) return '#94a3b8';
  const ratio = value / max;
  if (ratio < 0.15) return '#64748b';
  if (ratio < 0.5)  return '#374151';
  return 'white';
}

// ══════════════════════════════════════════════════════════════════════
// ANIMATED COUNTER
// ══════════════════════════════════════════════════════════════════════
function AnimatedValue({ value, duration = 700 }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);
  useEffect(() => {
    let start = null;
    const from = display;
    const to = value;
    const step = (timestamp) => {
      if (!start) start = timestamp;
      const progress = Math.min((timestamp - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (to - from) * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);
  return <>{fmt0(display)} €</>;
}

// ══════════════════════════════════════════════════════════════════════
// SPARK CARD
// ══════════════════════════════════════════════════════════════════════
function SparkCard({ name, color, cat, avg, trend, last, data, seriesKey, isHidden, onToggle, totalAmount }) {
  const [hovered, setHovered] = useState(false);
  const share = totalAmount > 0 ? ((last / totalAmount) * 100) : 0;
  const isSingleMonth = data.filter(r => Number(r[seriesKey] || 0) > 0).length <= 1;
  const shareColor = share >= 30 ? '#ef4444' : share >= 15 ? '#f59e0b' : '#1B5E46';

  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: '1 1 150px', minWidth: 145, maxWidth: 210,
        background: isHidden ? '#f8fafc' : hovered ? `linear-gradient(145deg, white, ${color}08)` : 'white',
        borderRadius: 16, padding: '16px 16px 14px',
        border: isHidden ? '1.5px solid #e2e8f0' : hovered ? `1.5px solid ${color}60` : `1.5px solid ${color}28`,
        boxShadow: isHidden ? 'none' : hovered ? `0 8px 28px ${color}25, 0 2px 8px rgba(0,0,0,.06)` : `0 2px 12px ${color}12, 0 1px 3px rgba(0,0,0,.04)`,
        cursor: 'pointer', transition: 'all .22s cubic-bezier(.4,0,.2,1)',
        opacity: isHidden ? 0.4 : 1, position: 'relative', overflow: 'hidden',
        transform: hovered && !isHidden ? 'translateY(-2px)' : 'none',
      }}
    >
      <div style={{ position:'absolute',top:0,left:0,right:0,height:3, background:isHidden?'#e2e8f0':`linear-gradient(90deg,${color},${color}60)`, borderRadius:'16px 16px 0 0', transition:'all .22s' }}/>
      {!isHidden && <div style={{ position:'absolute',top:-20,right:-20,width:80,height:80,borderRadius:'50%', background:`radial-gradient(circle,${color}12 0%,transparent 70%)`, pointerEvents:'none' }}/>}
      <div style={{ display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:10 }}>
        <div style={{ flex:1,minWidth:0,paddingRight:6 }}>
          <div style={{ display:'flex',alignItems:'center',gap:5,marginBottom:4 }}>
            <div style={{ width:7,height:7,borderRadius:2,flexShrink:0, background:isHidden?'#cbd5e1':color, boxShadow:!isHidden&&hovered?`0 0 6px ${color}`:'none', transition:'all .2s' }}/>
            <span style={{ fontSize:11,fontWeight:700,color:isHidden?'#94a3b8':'#374151', overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:110 }} title={name}>
              {shortName(name,16)}
            </span>
          </div>
          <CatBadge cat={cat}/>
        </div>
        <div style={{ width:24,height:24,borderRadius:7,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center', background:isHidden?'#f1f5f9':hovered?color+'15':'transparent', color:isHidden?'#94a3b8':hovered?color:'transparent', transition:'all .18s', border:isHidden?'1px solid #e2e8f0':'none' }}>
          {isHidden ? <EyeOff size={11}/> : <Eye size={11}/>}
        </div>
      </div>
      <div style={{ marginBottom:10 }}>
        <div style={{ display:'flex',alignItems:'baseline',gap:3 }}>
          <span style={{ fontSize:22,fontWeight:900,letterSpacing:'-0.5px',lineHeight:1,color:isHidden?'#94a3b8':color }}>{fmt2(last)}</span>
          <span style={{ fontSize:12,fontWeight:600,color:'#94a3b8' }}>€</span>
        </div>
        <div style={{ fontSize:10,color:'#94a3b8',marginTop:3,fontWeight:500 }}>{isSingleMonth?'ce mois · HT':`μ ${fmt0(avg)} €/mois`}</div>
      </div>
      <div style={{ marginBottom:12 }}>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4 }}>
          <span style={{ fontSize:9,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em' }}>Part du total</span>
          {share>0&&isFinite(share)?(
            <span style={{ fontSize:10,fontWeight:800,color:isHidden?'#94a3b8':shareColor, background:isHidden?'#f1f5f9':shareColor+'15', padding:'1px 6px',borderRadius:99, border:`1px solid ${isHidden?'#e2e8f0':shareColor+'30'}` }}>{share.toFixed(1)}%</span>
          ):(
            <span style={{ fontSize:10,fontWeight:600,color:'#cbd5e1',padding:'1px 6px',borderRadius:99,border:'1px solid #e2e8f0' }}>— %</span>
          )}
        </div>
        <div style={{ height:4,background:'#f1f5f9',borderRadius:99,overflow:'hidden' }}>
          <div style={{ height:4,borderRadius:99, background:isHidden?'#e2e8f0':`linear-gradient(90deg,${color},${color}80)`, width:`${Math.min(Math.max(share,0),100)}%`, transition:'width .5s cubic-bezier(.4,0,.2,1)', boxShadow:!isHidden&&share>0?`0 0 6px ${color}60`:'none' }}/>
        </div>
      </div>
      {isSingleMonth ? (
        <div style={{ display:'flex',alignItems:'center',gap:6,padding:'7px 10px',borderRadius:9, background:isHidden?'#f8fafc':color+'0e', border:`1px dashed ${isHidden?'#e2e8f0':color+'35'}` }}>
          <div style={{ width:20,height:20,borderRadius:6,flexShrink:0,background:isHidden?'#e2e8f0':color+'20', display:'flex',alignItems:'center',justifyContent:'center',fontSize:11 }}>📅</div>
          <div>
            <div style={{ fontSize:9,fontWeight:800,color:isHidden?'#94a3b8':color,letterSpacing:'.04em' }}>1ER MOIS</div>
            <div style={{ fontSize:9,color:'#94a3b8',fontWeight:500 }}>historique en cours</div>
          </div>
        </div>
      ) : (
        <div style={{ height:36,marginLeft:-4,marginRight:-4 }}>
          <ResponsiveContainer width="100%" height={36}>
            <AreaChart data={data.map(r=>({v:Number(r[seriesKey]||0)}))} margin={{top:3,right:4,left:4,bottom:0}}>
              <defs>
                <linearGradient id={`spark-${seriesKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={isHidden?0:0.4}/>
                  <stop offset="100%" stopColor={color} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={isHidden?'#cbd5e1':color} strokeWidth={2} fill={`url(#spark-${seriesKey})`} dot={false} isAnimationActive={false} connectNulls={true}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const sorted = [...payload].filter(p=>Number(p.value||0)>0).sort((a,b)=>Number(b.value)-Number(a.value));
  const total = sorted.reduce((s,p)=>s+Number(p.value||0),0);
  if (!sorted.length) return null;
  return (
    <div style={{ background:'rgba(10,15,30,0.97)',border:'1px solid rgba(255,255,255,.10)',borderRadius:14,padding:'12px 16px',boxShadow:'0 24px 64px rgba(0,0,0,.55)',minWidth:210 }}>
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,paddingBottom:8,borderBottom:'1px solid rgba(255,255,255,.08)' }}>
        <span style={{ fontSize:12,fontWeight:800,color:'rgba(255,255,255,.9)' }}>{label}</span>
        {sorted.length>1&&<span style={{ fontSize:11,fontWeight:900,color:'#34d399',background:'rgba(52,211,153,.12)',padding:'2px 8px',borderRadius:99,border:'1px solid rgba(52,211,153,.22)' }}>{fmt2(total)} €</span>}
      </div>
      <div style={{ display:'flex',flexDirection:'column',gap:5 }}>
        {sorted.map((p,i)=>(
          <div key={i} style={{ display:'grid',gridTemplateColumns:'8px 1fr auto',gap:'0 9px',alignItems:'center', padding:'6px 8px',borderRadius:8, background:i===0?`${p.color}18`:'rgba(255,255,255,.03)', border:i===0?`1px solid ${p.color}35`:'1px solid rgba(255,255,255,.04)' }}>
            <div style={{ width:8,height:8,borderRadius:2,background:p.color }}/>
            <span style={{ fontSize:11,color:i===0?'rgba(255,255,255,.9)':'rgba(255,255,255,.55)',fontWeight:i===0?700:400,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{shortName(p.dataKey,22)}</span>
            <span style={{ fontSize:12,fontWeight:900,color:i===0?'white':'rgba(255,255,255,.6)' }}>{fmt2(p.value)} €</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendXTick({ x, y, payload, monthTotals, activeLabel }) {
  const isActive = payload.value === activeLabel;
  const total = monthTotals?.[payload.value] || 0;
  return (
    <g transform={`translate(${x},${y})`}>
      {isActive&&<rect x={-32} y={-4} width={64} height={34} rx={7} fill="#1B5E4612" stroke="#1B5E4628" strokeWidth={1}/>}
      {total>0&&<text x={0} y={-2} textAnchor="middle" fontSize={9} fontWeight={700} fill={isActive?'#1B5E46':'#94a3b8'}>{fmt0(total)}€</text>}
      <text x={0} y={14} textAnchor="middle" fontSize={11} fontWeight={isActive?800:500} fill={isActive?'#1B5E46':'#64748b'}>
        {(()=>{const parts=(payload.value||'').split(' ');return parts.length===2?`${parts[0]} ${parts[1].slice(2)}`:payload.value;})()}
      </text>
    </g>
  );
}

function CostTimeCurve({ data, series, allKeys, height = 300, totalAmount = 0 }) {
  const [hiddenSeries, setHiddenSeries] = useState(new Set());
  const [activeLabel, setActiveLabel]   = useState(null);

  const colorMap = useMemo(() => {
    const map = {};
    (allKeys?.length ? allKeys : series).forEach((k, i) => {
      const cat = detectOvhCategory(k);
      map[k] = cat !== 'Autre' ? CAT_COLOR_MAP[cat] : COLORS[i % COLORS.length];
    });
    return map;
  }, [allKeys, series]);

  const stats = useMemo(() => {
    const result = {};
    series.forEach(s => {
      const vals    = data.map(row => Number(row[s] || 0));
      const nonZero = vals.filter(v => v > 0);
      const total   = vals.reduce((a, b) => a + b, 0);
      const avg     = nonZero.length ? total / nonZero.length : 0;
      const last    = [...vals].reverse().find(v => v > 0) || 0;
      result[s]     = { avg, last };
    });
    return result;
  }, [data, series]);

  const monthTotals = useMemo(() => {
    const map = {};
    data.forEach(row => {
      const t = series.filter(s => !hiddenSeries.has(s)).reduce((sum, s) => sum + Number(row[s] || 0), 0);
      map[row.label] = t;
    });
    return map;
  }, [data, series, hiddenSeries]);

  const toggleHidden = useCallback(s => {
    setHiddenSeries(prev => { const next = new Set(prev); if (next.has(s)) next.delete(s); else next.add(s); return next; });
  }, []);

  if (!data?.length || !series?.length) {
    return (
      <div style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'52px 0',gap:10,background:'#f8fafc',borderRadius:14,border:'2px dashed #e2e8f0' }}>
        <BarChart2 size={30} color="#cbd5e1"/>
        <p style={{ fontSize:13,color:'#94a3b8',fontWeight:600,margin:0 }}>Sélectionnez au moins un élément</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display:'flex',gap:10,flexWrap:'wrap',marginBottom:20 }}>
        {series.map(s => (
          <SparkCard key={s} name={s} seriesKey={s} color={colorMap[s]} cat={detectOvhCategory(s)}
            avg={stats[s]?.avg||0} trend={null} last={stats[s]?.last||0} data={data}
            isHidden={hiddenSeries.has(s)} onToggle={()=>toggleHidden(s)} totalAmount={totalAmount}/>
        ))}
        {hiddenSeries.size>0&&(
          <div style={{ display:'flex',alignItems:'center' }}>
            <button onClick={()=>setHiddenSeries(new Set())} style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,padding:'14px 16px',borderRadius:14,cursor:'pointer',border:'1.5px dashed #bbf7d0',background:'#f0fdf4',color:'#16a34a',fontSize:11,fontWeight:700,fontFamily:'inherit',minHeight:80 }}>
              <Eye size={16}/> Tout afficher
            </button>
          </div>
        )}
      </div>
      <div style={{ background:'linear-gradient(180deg,#fafbfd 0%,white 100%)',borderRadius:16,border:'1px solid #f0f4f8',padding:'20px 12px 12px',position:'relative',overflow:'hidden' }}>
        <div style={{ position:'absolute',inset:0,pointerEvents:'none',backgroundImage:'radial-gradient(circle at 80% 20%,#1B5E4606 0%,transparent 60%)' }}/>
        <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4,paddingLeft:56 }}>
          <span style={{ fontSize:11,fontWeight:700,color:'#94a3b8',letterSpacing:'.04em' }}>TENDANCE GLOBALE</span>
          <span style={{ fontSize:12,fontWeight:900,color:'#1B5E46',background:'#f0fdf4',padding:'3px 12px',borderRadius:99,border:'1px solid #bbf7d0' }}>{fmt2(totalAmount)} € total</span>
        </div>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data} margin={{top:16,right:16,left:0,bottom:28}} onMouseMove={e=>{if(e?.activeLabel)setActiveLabel(e.activeLabel);}} onMouseLeave={()=>setActiveLabel(null)}>
            <defs>
              {series.map((s,i)=>(
                <linearGradient key={i} id={`ctcGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colorMap[s]} stopOpacity={hiddenSeries.has(s)?0:0.28}/>
                  <stop offset="70%" stopColor={colorMap[s]} stopOpacity={hiddenSeries.has(s)?0:0.06}/>
                  <stop offset="100%" stopColor={colorMap[s]} stopOpacity={0}/>
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="0" stroke="#f0f4f8" vertical={false}/>
            <XAxis dataKey="label" axisLine={false} tickLine={false} height={42} tick={props=>(<TrendXTick {...props} monthTotals={monthTotals} activeLabel={activeLabel}/>)} interval={0}/>
            <YAxis axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#94a3b8',fontWeight:500}} tickFormatter={v=>`${fmt0(v)}€`} width={56}/>
            <Tooltip content={<TrendTooltip/>} cursor={{stroke:'#94a3b820',strokeWidth:28,strokeLinecap:'round'}}/>
            {activeLabel&&<ReferenceLine x={activeLabel} stroke="#1B5E46" strokeWidth={1.5} strokeDasharray="5 4" strokeOpacity={0.4}/>}
            {series.map((s,i)=>{
              const isHid=hiddenSeries.has(s);
              return (
                <Area key={s} type="monotone" dataKey={s} stroke={isHid?'transparent':colorMap[s]} strokeWidth={2.5} fill={`url(#ctcGrad${i})`} opacity={isHid?0:1}
                  dot={data.length===1?{r:6,fill:colorMap[s],stroke:'white',strokeWidth:3,filter:`drop-shadow(0 2px 6px ${colorMap[s]}88)`}:false}
                  activeDot={isHid?false:{r:5,strokeWidth:2.5,stroke:'white',fill:colorMap[s],filter:`drop-shadow(0 0 8px ${colorMap[s]}99)`}}
                  isAnimationActive={false} connectNulls={true}/>
              );
            })}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ══════════════════════════════════════════════════════════════════════
function CatBadge({ cat }) {
  if (!cat || cat === 'Autre') return null;
  return (
    <span style={{ fontSize:10,fontWeight:700,color:CAT_COLOR_MAP[cat]||'#64748b',background:CAT_BG[cat]||'#f8fafc',padding:'1px 6px',borderRadius:4,border:`1px solid ${(CAT_COLOR_MAP[cat]||'#64748b')}33` }}>{cat}</span>
  );
}

function KPICard({ label, value, unit='€', icon:Icon, topColor, iconBg, sub, trend }) {
  const isUp   = trend > 0;
  const isZero = trend === 0 || trend === null || trend === undefined;
  return (
    <div style={{ background:'white',borderRadius:16,padding:'18px 20px 14px',border:'1px solid #e8edf5',position:'relative',overflow:'hidden',boxShadow:'0 1px 8px rgba(0,0,0,.05)',flex:1,minWidth:155 }}>
      <div style={{ position:'absolute',top:0,left:0,right:0,height:3,background:topColor,borderRadius:'16px 16px 0 0' }}/>
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10 }}>
        <span style={{ fontSize:10,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.1em' }}>{label}</span>
        <div style={{ width:32,height:32,borderRadius:9,background:iconBg,display:'flex',alignItems:'center',justifyContent:'center' }}>
          <Icon size={15} color="white"/>
        </div>
      </div>
      <div style={{ display:'flex',alignItems:'baseline',gap:4,marginBottom:4 }}>
        <span style={{ fontSize:24,fontWeight:900,color:'#0f172a',letterSpacing:'-1px',lineHeight:1 }}>{value}</span>
        {unit&&<span style={{ fontSize:12,fontWeight:600,color:'#94a3b8' }}>{unit}</span>}
      </div>
      <div style={{ display:'flex',alignItems:'center',gap:6 }}>
        {!isZero&&trend!==null&&trend!==undefined&&(
          <span style={{ display:'inline-flex',alignItems:'center',gap:2,fontSize:11,fontWeight:700,color:isUp?'#ef4444':'#16a34a' }}>
            {isUp?<ArrowUpRight size={11}/>:<ArrowDownRight size={11}/>}{Math.abs(trend)}% vs mois dernier
          </span>
        )}
        {isZero&&trend!==null&&<span style={{ fontSize:11,fontWeight:700,color:'#16a34a',display:'flex',alignItems:'center',gap:2 }}><ArrowDownRight size={11}/> 0% vs mois dernier</span>}
        {sub&&<span style={{ fontSize:11,color:'#94a3b8' }}>{sub}</span>}
      </div>
    </div>
  );
}

function ChartCard({ children, title, sub, action, badge, style={} }) {
  return (
    <div style={{ background:'white',borderRadius:16,border:'1px solid #e8edf5',boxShadow:'0 1px 8px rgba(0,0,0,.04)',padding:'20px 22px',...style }}>
      <div style={{ display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16 }}>
        <div>
          <div style={{ display:'flex',alignItems:'center',gap:8 }}>
            <h3 style={{ fontSize:14,fontWeight:800,color:'#0f172a',margin:0 }}>{title}</h3>
            {badge}
          </div>
          {sub&&<p style={{ fontSize:11,color:'#94a3b8',margin:'3px 0 0' }}>{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// DONUT CHART
// ══════════════════════════════════════════════════════════════════════
function DonutChart({ data, total, colorByCategory=false }) {
  const [active, setActive] = useState(null);
  const getColor = (item, i) => {
    if (colorByCategory) { const cat=detectOvhCategory(item.name); return CAT_COLOR_MAP[cat]||COLORS[i%COLORS.length]; }
    return COLORS[i%COLORS.length];
  };
  if (!data?.length) return <div style={{ textAlign:'center',padding:'40px 0',color:'#94a3b8' }}><FolderOpen size={28} style={{ opacity:.2,display:'block',margin:'0 auto 8px' }}/><p style={{ fontSize:12 }}>Aucune donnée</p></div>;
  return (
    <div style={{ display:'flex',gap:20,alignItems:'center',flexWrap:'wrap' }}>
      <div style={{ position:'relative',flexShrink:0 }}>
        <ResponsiveContainer width={190} height={190}>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={58} outerRadius={84} paddingAngle={3} dataKey="value" onMouseEnter={(_,i)=>setActive(i)} onMouseLeave={()=>setActive(null)}>
              {data.map((entry,i)=><Cell key={i} fill={getColor(entry,i)} opacity={active===null||active===i?1:0.35} stroke="white" strokeWidth={2}/>)}
            </Pie>
            <Tooltip formatter={(v,n)=>[`${fmt2(v)} €`,n]} contentStyle={{ borderRadius:10,border:'1px solid #e2e8f0',boxShadow:'0 4px 16px rgba(0,0,0,.1)',fontSize:12 }}/>
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',textAlign:'center',pointerEvents:'none' }}>
          {active!==null&&data[active]?(
            <><div style={{ fontSize:9,color:'#94a3b8',fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em' }}>{shortName(data[active].name,10)}</div><div style={{ fontSize:15,fontWeight:900,color:'#0f172a',lineHeight:1.2 }}>{fmt2(data[active].value)} €</div><div style={{ fontSize:10,color:'#64748b' }}>{total>0?Math.round((data[active].value/total)*100):0}%</div></>
          ):(
            <><div style={{ fontSize:9,color:'#94a3b8',fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em' }}>Total HT</div><div style={{ fontSize:15,fontWeight:900,color:'#0f172a',lineHeight:1.2 }}>{fmt2(total)} €</div></>
          )}
        </div>
      </div>
      <div style={{ flex:1,minWidth:140 }}>
        {data.slice(0,8).map((item,i)=>{
          const pct=total>0?Math.round((item.value/total)*100):0;
          const c=getColor(item,i);
          const cat=detectOvhCategory(item.name);
          return (
            <div key={i} onMouseEnter={()=>setActive(i)} onMouseLeave={()=>setActive(null)} style={{ display:'flex',alignItems:'center',gap:8,marginBottom:6,padding:'4px 8px',borderRadius:7,cursor:'default',background:active===i?c+'15':'transparent',transition:'background .1s' }}>
              <span style={{ width:10,height:10,borderRadius:3,flexShrink:0,background:c }}/>
              <span style={{ fontSize:11,color:'#374151',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:500 }}>{shortName(item.name,20)}</span>
              <CatBadge cat={cat}/>
              <div style={{ textAlign:'right',flexShrink:0 }}>
                <div style={{ fontSize:11,fontWeight:800,color:'#0f172a' }}>{fmt2(item.value)} €</div>
                <div style={{ fontSize:10,color:'#94a3b8' }}>{pct}%</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// RANKED BAR CHART — expandable rows with ref costs
// ══════════════════════════════════════════════════════════════════════
function RankedCostChart({ data, total, refCostMap = {} }) {
  const [hovered, setHovered] = useState(null);
  const [expanded, setExpanded] = useState(null);

  if (!data?.length) return (
    <div style={{ textAlign:'center',padding:'40px 0',color:'#94a3b8' }}>
      <BarChart2 size={28} style={{ opacity:.2,display:'block',margin:'0 auto 8px' }}/>
      <p style={{ fontSize:13 }}>Aucune donnée</p>
    </div>
  );

  const top8   = data.slice(0, 8);
  const maxVal = top8[0]?.value || 1;
  const MEDALS = ['🥇','🥈','🥉'];

  return (
    <div>
      {top8.map((item, i) => {
        const cat    = detectOvhCategory(item.name);
        const color  = CAT_COLOR_MAP[cat] || COLORS[i % COLORS.length];
        const pct    = total > 0 ? (item.value / total) * 100 : 0;
        const barPct = maxVal > 0 ? (item.value / maxVal) * 100 : 0;
        const isHov  = hovered === i;
        const isExp  = expanded === i;
        const tva    = item.value * 0.2;
        const ttc    = item.value * 1.2;
        const share  = total > 0 ? (item.value / total) * 100 : 0;

        // refs for this service: array of { ref, amount }
        const refs = refCostMap[item.name] || [];
        const refsSorted = [...refs].sort((a, b) => b.amount - a.amount);

        return (
          <div key={i}>
            {/* ── Main row ── */}
            <div
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setExpanded(isExp ? null : i)}
              style={{
                display:'grid', gridTemplateColumns:'26px 1fr 110px 64px 18px',
                gap:'0 10px', alignItems:'center',
                padding:'8px 10px',
                borderRadius: isExp ? '10px 10px 0 0' : 10,
                marginBottom: isExp ? 0 : 3,
                background: isExp ? color+'12' : isHov ? color+'0e' : 'transparent',
                border: isExp ? `1.5px solid ${color}35` : '1.5px solid transparent',
                borderBottom: isExp ? 'none' : undefined,
                transition:'all .15s', cursor:'pointer', userSelect:'none',
              }}
            >
              {/* Medal */}
              <div style={{ width:24,height:24,borderRadius:7,flexShrink:0,background:i<3?color:'#f1f5f9',display:'flex',alignItems:'center',justifyContent:'center',fontSize:i<3?13:11,fontWeight:900,color:i<3?'white':'#94a3b8' }}>
                {i<3?MEDALS[i]:i+1}
              </div>

              {/* Name + bar */}
              <div style={{ minWidth:0 }}>
                <div style={{ display:'flex',alignItems:'center',gap:6,marginBottom:3 }}>
                  <span style={{ fontSize:12,fontWeight:isHov||isExp?700:500,color:'#0f172a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1 }} title={item.name}>
                    {shortName(item.name,28)}
                  </span>
                  <CatBadge cat={cat}/>
                </div>
                {/* Ref count pill */}
                {refsSorted.length > 0 && (
                  <div style={{ display:'flex',alignItems:'center',gap:4,marginBottom:3 }}>
                    <span style={{ fontSize:9,fontWeight:700,color:color,background:color+'12',padding:'1px 6px',borderRadius:99,border:`1px solid ${color}25` }}>
                      {refsSorted.length} réf{refsSorted.length>1?'s':''}
                    </span>
                    <span style={{ fontSize:9,color:'#94a3b8',fontFamily:'monospace' }}>
                      {refsSorted[0]?.ref?.length>22 ? refsSorted[0].ref.slice(0,21)+'…' : refsSorted[0]?.ref}
                    </span>
                  </div>
                )}
                <div style={{ height:5,background:'#f1f5f9',borderRadius:99,overflow:'hidden' }}>
                  <div style={{ height:5,borderRadius:99,background:`linear-gradient(90deg,${color},${color}80)`,width:`${barPct}%`,transition:'width .4s ease',opacity:isHov||isExp?1:0.7 }}/>
                </div>
              </div>

              {/* Amount */}
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:13,fontWeight:800,color:isHov||isExp?color:'#0f172a',transition:'color .15s' }}>{fmt2(item.value)} €</div>
                <div style={{ fontSize:9,color:'#94a3b8',marginTop:1 }}>TTC {fmt2(ttc)} €</div>
              </div>

              {/* Share */}
              <div style={{ textAlign:'center' }}>
                <span style={{ fontSize:11,fontWeight:700,color:pct>=10?color:'#64748b',background:pct>=10?color+'12':'#f8fafc',padding:'2px 7px',borderRadius:99,border:`1px solid ${pct>=10?color+'33':'#e2e8f0'}`,display:'inline-block' }}>
                  {pct.toFixed(1)}%
                </span>
              </div>

              {/* Chevron */}
              <div style={{ fontSize:14,color:isExp?color:'#cbd5e1',transform:isExp?'rotate(180deg)':'none',transition:'transform .2s,color .15s',display:'flex',alignItems:'center',justifyContent:'center' }}>▾</div>
            </div>

            {/* ── Expanded detail panel ── */}
            {isExp && (
              <div style={{ background:`linear-gradient(135deg,${color}08 0%,white 60%)`,border:`1.5px solid ${color}30`,borderTop:`1px solid ${color}15`,borderRadius:'0 0 10px 10px',padding:'14px 16px 16px',marginBottom:3 }}>
                
                {/* Financial boxes */}
                <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:14 }}>
                  {[
                    { label:'Montant HT', value:fmt2(item.value)+' €', icon:'💶', color:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0' },
                    { label:'TVA 20%',    value:fmt2(tva)+' €',        icon:'🏛️', color:'#7C3AED', bg:'#faf5ff', border:'#e9d5ff' },
                    { label:'Total TTC',  value:fmt2(ttc)+' €',        icon:'🧾', color:'#0891B2', bg:'#f0f9ff', border:'#bae6fd' },
                    { label:'Part totale',value:share.toFixed(2)+'%',  icon:'📊', color:color,      bg:color+'0d', border:color+'30' },
                  ].map((box, bi) => (
                    <div key={bi} style={{ background:box.bg,borderRadius:10,padding:'10px 12px',border:`1.5px solid ${box.border}` }}>
                      <div style={{ fontSize:9,color:box.color,fontWeight:800,marginBottom:4,textTransform:'uppercase',letterSpacing:'.06em' }}>{box.icon} {box.label}</div>
                      <div style={{ fontSize:16,fontWeight:900,color:'#0f172a',lineHeight:1 }}>{box.value}</div>
                    </div>
                  ))}
                </div>

                {/* Reference IDs with individual costs */}
                {refsSorted.length > 0 ? (
                  <div>
                    <div style={{ fontSize:10,fontWeight:800,color:'#64748b',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8,display:'flex',alignItems:'center',gap:6 }}>
                      🔗 Références & coûts associés
                      <span style={{ fontSize:9,fontWeight:600,color:'#94a3b8',fontWeight:400,textTransform:'none',letterSpacing:0 }}>({refsSorted.length} référence{refsSorted.length>1?'s':''})</span>
                    </div>

                    {/* Column headers */}
                    <div style={{ display:'grid',gridTemplateColumns:'1fr 72px 90px 72px 72px 72px',gap:'0 8px',padding:'4px 10px',marginBottom:4 }}>
  <span style={{ fontSize:9,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em' }}>Référence / Hostname</span>
  <span style={{ fontSize:9,fontWeight:700,color:'#2563eb',textTransform:'uppercase',letterSpacing:'.06em',textAlign:'center' }}>Date</span>
  <span style={{ fontSize:9,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em',textAlign:'right' }}>Montant HT</span>
  <span style={{ fontSize:9,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em',textAlign:'right' }}>TVA</span>
  <span style={{ fontSize:9,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em',textAlign:'right' }}>TTC</span>
  <span style={{ fontSize:9,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em',textAlign:'right' }}>Part</span>
</div>

                    <div style={{ display:'flex',flexDirection:'column',gap:3 }}>
                      {refsSorted.map((r, ri) => {
                        const refPct  = item.value > 0 ? (r.amount / item.value) * 100 : 0;
                        const refTva  = r.amount * 0.2;
                        const refTtc  = r.amount * 1.2;
                        const barW    = item.value > 0 ? (r.amount / item.value) * 100 : 0;
                        return (
                          <div key={ri} style={{ display:'grid',gridTemplateColumns:'1fr 90px 72px 72px 72px',gap:'0 8px',alignItems:'center',padding:'8px 10px',borderRadius:8,background:'white',border:`1px solid ${color}20` }}>
                            {/* Ref name */}
                            <div style={{ minWidth:0 }}>
                              <div style={{ display:'flex',alignItems:'center',gap:6,marginBottom:3 }}>
                                <span style={{ width:16,height:16,borderRadius:4,background:color+'18',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,color:color,fontWeight:800,flexShrink:0 }}>{ri+1}</span>
                                <span style={{ fontSize:11,fontFamily:'monospace',color:'#374151',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }} title={r.ref}>{r.ref}</span>
                                <button onClick={e=>{e.stopPropagation();navigator.clipboard?.writeText(r.ref);toast.success('Copié !');}} title="Copier la référence" style={{ background:color+'12',border:`1px solid ${color}25`,borderRadius:4,padding:'1px 5px',fontSize:9,color:color,fontWeight:700,cursor:'pointer',fontFamily:'inherit',flexShrink:0 }}>📋</button>
                              </div>
                              {/* Mini bar showing proportion */}
                              <div style={{ height:3,background:'#f1f5f9',borderRadius:99,overflow:'hidden' }}>
                                <div style={{ height:3,borderRadius:99,background:`linear-gradient(90deg,${color},${color}60)`,width:`${barW}%` }}/>
                              </div>
                            </div>
                            {/* Date ← ADD THIS */}
  <div style={{ textAlign:'center' }}>
    <div style={{ fontSize:10,fontWeight:700,color:'#2563eb',lineHeight:1 }}>
      {r.date ? new Date(r.date).toLocaleDateString('fr-FR',{month:'short',year:'2-digit'}) : '—'}
    </div>
    <div style={{ fontSize:7,color:'#94a3b8',marginTop:1,fontWeight:600 }}>DATE</div>
  </div>
                            {/* HT */}
                            <div style={{ textAlign:'right' }}>
                              <div style={{ fontSize:12,fontWeight:800,color:'#16a34a' }}>{fmt2(r.amount)} €</div>
                              <div style={{ fontSize:9,color:'#94a3b8' }}>HT</div>
                            </div>
                            {/* TVA */}
                            <div style={{ textAlign:'right' }}>
                              <div style={{ fontSize:11,fontWeight:600,color:'#7C3AED' }}>{fmt2(refTva)} €</div>
                              <div style={{ fontSize:9,color:'#94a3b8' }}>TVA</div>
                            </div>
                            {/* TTC */}
                            <div style={{ textAlign:'right' }}>
                              <div style={{ fontSize:11,fontWeight:700,color:'#0891B2' }}>{fmt2(refTtc)} €</div>
                              <div style={{ fontSize:9,color:'#94a3b8' }}>TTC</div>
                            </div>
                            {/* Part */}
                            <div style={{ textAlign:'right' }}>
                              <span style={{ fontSize:10,fontWeight:700,color:refPct>=20?color:'#64748b',background:refPct>=20?color+'12':'#f8fafc',padding:'2px 6px',borderRadius:99,border:`1px solid ${refPct>=20?color+'33':'#e2e8f0'}`,display:'inline-block' }}>
                                {refPct.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Refs total check */}
                    <div style={{ display:'grid',gridTemplateColumns:'1fr 90px 72px 72px 72px',gap:'0 8px',padding:'8px 10px 0',marginTop:4,borderTop:'2px solid #f1f5f9' }}>
                      <span style={{ fontSize:10,fontWeight:800,color:'#374151' }}>Σ Total références</span>
                        <span/> {/* empty date column */}

                      <span style={{ fontSize:11,fontWeight:900,color:'#1B5E46',textAlign:'right' }}>{fmt2(refsSorted.reduce((s,r)=>s+r.amount,0))} €</span>
                      <span style={{ fontSize:10,fontWeight:700,color:'#7C3AED',textAlign:'right' }}>{fmt2(refsSorted.reduce((s,r)=>s+r.amount*0.2,0))} €</span>
                      <span style={{ fontSize:10,fontWeight:700,color:'#0891B2',textAlign:'right' }}>{fmt2(refsSorted.reduce((s,r)=>s+r.amount*1.2,0))} €</span>
                      <span style={{ fontSize:10,color:'#94a3b8',textAlign:'right' }}>100%</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding:'12px',background:'#f8fafc',borderRadius:8,border:'1px dashed #e2e8f0',fontSize:11,color:'#94a3b8',textAlign:'center' }}>
                    Aucune référence OVH associée à ce service
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Grand total row */}
      <div style={{ display:'grid',gridTemplateColumns:'26px 1fr 110px 64px 18px',gap:'0 10px',alignItems:'center',padding:'10px 10px 0',marginTop:4,borderTop:'2px solid #f1f5f9' }}>
        <span/>
        <span style={{ fontSize:11,fontWeight:800,color:'#374151' }}>Total top 8</span>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:14,fontWeight:900,color:'#1B5E46' }}>{fmt2(top8.reduce((s,d)=>s+d.value,0))} €</div>
          <div style={{ fontSize:9,color:'#94a3b8' }}>TTC {fmt2(top8.reduce((s,d)=>s+d.value,0)*1.2)} €</div>
        </div>
        <span style={{ fontSize:11,color:'#94a3b8',textAlign:'center' }}>{total>0?Math.round((top8.reduce((s,d)=>s+d.value,0)/total)*100):0}%</span>
        <span/>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// BUDGET TRACKER — expandable with ref costs
// ══════════════════════════════════════════════════════════════════════
function BudgetTracker({ topServices, analytics }) {
  const [expanded, setExpanded] = useState(null);

  return (
    <div style={{ maxHeight:420,overflowY:'auto' }}>
      {topServices.map((s, i) => {
        const budget   = s.total * 1.2;
        const pct      = Math.min(Math.round((s.total / budget) * 100), 100);
        const barColor = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#16a34a';
        const cat      = detectOvhCategory(s.name);
        const catColor = CAT_COLOR_MAP[cat] || '#64748b';
        const isExp    = expanded === i;
        const tva      = s.total * 0.2;
        const ttc      = s.total * 1.2;
        const share    = analytics.total > 0 ? (s.total / analytics.total) * 100 : 0;

        const refs = (analytics.refCostMap?.[s.name] || []).sort((a,b)=>b.amount-a.amount);

        return (
          <div key={i} style={{ marginBottom:6 }}>
            <div
              onClick={() => setExpanded(isExp ? null : i)}
              style={{ padding:'9px 10px',borderRadius:isExp?'9px 9px 0 0':9,border:isExp?`1.5px solid ${catColor}30`:'1.5px solid transparent',borderBottom:isExp?'none':undefined,background:isExp?catColor+'08':'transparent',cursor:'pointer',transition:'all .15s' }}
              onMouseEnter={e=>{if(!isExp)e.currentTarget.style.background='#f8fafc';}}
              onMouseLeave={e=>{if(!isExp)e.currentTarget.style.background='transparent';}}
            >
              <div style={{ display:'flex',justifyContent:'space-between',marginBottom:3,alignItems:'flex-start' }}>
                <div style={{ flex:1,overflow:'hidden',paddingRight:8 }}>
                  <div style={{ display:'flex',alignItems:'center',gap:6 }}>
                    <span style={{ fontSize:11,fontWeight:600,color:'#374151',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{s.name}</span>
                    <CatBadge cat={cat}/>
                    {refs.length > 0 && (
                      <span style={{ fontSize:9,fontWeight:700,color:catColor,background:catColor+'12',padding:'1px 5px',borderRadius:99,border:`1px solid ${catColor}25`,flexShrink:0 }}>
                        {refs.length} réf{refs.length>1?'s':''}
                      </span>
                    )}
                  </div>
                  {refs.length > 0 && (
                    <div style={{ fontSize:9,fontFamily:'monospace',color:isExp?catColor:'#94a3b8',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'100%',marginTop:2,transition:'color .15s' }}>
                      {refs[0]?.ref}
                    </div>
                  )}
                </div>
                <div style={{ display:'flex',alignItems:'center',gap:8,flexShrink:0 }}>
                  <span style={{ fontSize:12,fontWeight:800,color:barColor }}>{fmt2(s.total)} €</span>
                  <span style={{ fontSize:11,fontWeight:700,color:barColor,background:barColor+'15',padding:'1px 6px',borderRadius:99,border:`1px solid ${barColor}30` }}>{pct}%</span>
                  <span style={{ fontSize:14,color:isExp?catColor:'#94a3b8',transition:'all .15s',transform:isExp?'rotate(180deg)':'none',display:'inline-block' }}>▾</span>
                </div>
              </div>
              <div style={{ height:5,background:'#f1f5f9',borderRadius:99 }}>
                <div style={{ height:5,borderRadius:99,background:barColor,width:`${pct}%`,transition:'width .5s' }}/>
              </div>
              <div style={{ display:'flex',justifyContent:'space-between',marginTop:2 }}>
                <span style={{ fontSize:9,color:'#94a3b8' }}>{fmt2(s.total)} € HT utilisés</span>
                <span style={{ fontSize:9,color:'#94a3b8' }}>Budget estimé : {fmt2(budget)} € TTC</span>
              </div>
            </div>

            {/* ── Expanded ── */}
            {isExp && (
              <div style={{ background:`linear-gradient(135deg,${catColor}06 0%,white 70%)`,border:`1.5px solid ${catColor}30`,borderTop:`1px solid ${catColor}15`,borderRadius:'0 0 9px 9px',padding:'14px 14px 16px',marginBottom:2 }}>
                
                {/* Financial grid */}
                <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:16 }}>
                  {[
                    { label:'HT', value:fmt2(s.total)+' €', icon:'💶', color:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0' },
                    { label:'TVA 20%', value:fmt2(tva)+' €', icon:'🏛️', color:'#7C3AED', bg:'#faf5ff', border:'#e9d5ff' },
                    { label:'TTC', value:fmt2(ttc)+' €', icon:'🧾', color:'#0891B2', bg:'#f0f9ff', border:'#bae6fd' },
                    { label:'Part', value:share.toFixed(1)+'%', icon:'📊', color:catColor, bg:catColor+'0d', border:catColor+'30' },
                  ].map((box,bi)=>(
                    <div key={bi} style={{ background:box.bg,borderRadius:11,padding:'12px 13px',border:`1.5px solid ${box.border}` }}>
                      <div style={{ fontSize:9,color:box.color,fontWeight:800,marginBottom:5,textTransform:'uppercase',letterSpacing:'.07em' }}>{box.icon} {box.label}</div>
                      <div style={{ fontSize:16,fontWeight:900,color:'#0f172a',lineHeight:1 }}>{box.value}</div>
                    </div>
                  ))}
                </div>

                {/* Refs with costs */}
                {refs.length > 0 && (
                  <div>
                    {/* Section header */}
                    <div style={{ fontSize:11,fontWeight:800,color:'#374151',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:12,display:'flex',alignItems:'center',gap:8 }}>
                      <span style={{ fontSize:14 }}>🔗</span>
                      <span>Références & Coûts Associés</span>
                      <span style={{ fontSize:10,fontWeight:700,color:'#94a3b8',textTransform:'none',letterSpacing:0,marginLeft:'auto',background:'#e2e8f0',color:'#64748b',padding:'3px 9px',borderRadius:99,border:'1px solid #cbd5e1' }}>
                        {refs.length} référence{refs.length>1?'s':''}
                      </span>
                    </div>

                    {/* References list as card rows */}
                    <div style={{ display:'flex',flexDirection:'column',gap:5,marginBottom:12 }}>
                      {refs.map((r,ri)=>{
                        const refPct = s.total > 0 ? (r.amount/s.total)*100 : 0;
                        const refTva = r.amount * 0.2;
                        const refTtc = r.amount * 1.2;

                        return (
                          <div key={ri} style={{ display:'grid',gridTemplateColumns:'24px 1fr 28px 90px 85px 75px 85px 70px',gap:'0 10px',alignItems:'center',padding:'10px 12px',borderRadius:9,background:'white',border:'1.5px solid #e2e8f0' }}>
                            {/* Index badge */}
                            <span style={{ width:24,height:24,borderRadius:5,background:catColor,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'white',fontWeight:800,flexShrink:0 }}>{ri+1}</span>

                            {/* Reference name */}
                            <span style={{ fontSize:10,fontFamily:'monospace',color:'#374151',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }} title={r.ref}>{r.ref}</span>

                            {/* Copy button */}
                            <button onClick={e=>{e.stopPropagation();navigator.clipboard?.writeText(r.ref);toast.success('Copié !');}} title="Copier" style={{ background:'#f1f5f9',border:'1px solid #e2e8f0',borderRadius:5,padding:'4px 5px',fontSize:9,color:'#64748b',fontWeight:600,cursor:'pointer',fontFamily:'inherit',flexShrink:0 }}>📋</button>
                             {/* Date */}
<div style={{ textAlign:'center' }}>
  <div style={{ fontSize:10, fontWeight:700, color:'#2563eb', lineHeight:1 }}>
    {r.date ? new Date(r.date).toLocaleDateString('fr-FR', { month:'short', year:'2-digit' }) : '—'}
  </div>
  <div style={{ fontSize:7, color:'#94a3b8', marginTop:1, fontWeight:600 }}>DATE</div>
</div>
                            {/* HT */}
                            <div style={{ textAlign:'right' }}>
                              <div style={{ fontSize:11,fontWeight:800,color:'#16a34a',lineHeight:1 }}>{fmt2(r.amount)} €</div>
                              <div style={{ fontSize:7,color:'#94a3b8',marginTop:1,fontWeight:600 }}>HT</div>
                            </div>

                            {/* TVA */}
                            <div style={{ textAlign:'right' }}>
                              <div style={{ fontSize:10,fontWeight:700,color:'#7C3AED',lineHeight:1 }}>{fmt2(refTva)} €</div>
                              <div style={{ fontSize:7,color:'#94a3b8',marginTop:1,fontWeight:600 }}>TVA</div>
                            </div>

                            {/* TTC */}
                            <div style={{ textAlign:'right' }}>
                              <div style={{ fontSize:11,fontWeight:800,color:'#0891B2',lineHeight:1 }}>{fmt2(refTtc)} €</div>
                              <div style={{ fontSize:7,color:'#94a3b8',marginTop:1,fontWeight:600 }}>TTC</div>
                            </div>

                            {/* Part */}
                            <div style={{ textAlign:'center' }}>
                              <span style={{ fontSize:9,fontWeight:700,color:refPct>=20?catColor:'#64748b',background:refPct>=20?catColor+'12':'#f8fafc',padding:'2px 6px',borderRadius:5,border:`1px solid ${refPct>=20?catColor+'33':'#e2e8f0'}`,display:'inline-block' }}>{refPct.toFixed(1)}%</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* References total row */}
                    <div style={{ display:'grid',gridTemplateColumns:'24px 1fr 28px 90px 85px 75px 85px 70px',gap:'0 10px',alignItems:'center',padding:'10px 12px 0',borderTop:'2px solid #f1f5f9',fontSize:10,fontWeight:700 }}>
                      <span/>
                      <span style={{ color:'#374151' }}>Σ Total</span>
                      <span/>
                      <div style={{ textAlign:'right',color:'#16a34a' }}>{fmt2(refs.reduce((s,r)=>s+r.amount,0))} €</div>
                      <div style={{ textAlign:'right',color:'#7C3AED' }}>{fmt2(refs.reduce((s,r)=>s+r.amount*0.2,0))} €</div>
                      <div style={{ textAlign:'right',color:'#0891B2' }}>{fmt2(refs.reduce((s,r)=>s+r.amount*1.2,0))} €</div>
                      <div style={{ textAlign:'center',color:'#64748b' }}>100%</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// HEATMAP
// ══════════════════════════════════════════════════════════════════════
function CostHeatmap({ data, services, months, maxValue }) {
  const [hovered,    setHovered]    = useState(null);
  const [sortMode,   setSortMode]   = useState("total");
  const [showValues, setShowValues] = useState(true);
  const showRowTotals = months.length > 1;
  const formatCell = v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : fmt0(v);

  const sorted = useMemo(() => {
    if (!services?.length) return [];
    return [...services].sort((a,b) => {
      if (sortMode === "name") return a.localeCompare(b);
      const totalA = months.reduce((s,m) => s+(data[a]?.[m.key]||0), 0);
      const totalB = months.reduce((s,m) => s+(data[b]?.[m.key]||0), 0);
      if (sortMode === "peak") {
        const peakA = Math.max(...months.map(m => data[a]?.[m.key]||0));
        const peakB = Math.max(...months.map(m => data[b]?.[m.key]||0));
        return peakB - peakA;
      }
      return totalB - totalA;
    });
  }, [services, sortMode, months, data]);

  if (!sorted?.length || !months?.length) {
    return (
      <div style={{ textAlign:"center",padding:"40px 0",color:"#94a3b8" }}>
        <Flame size={28} style={{ opacity:.2,display:"block",margin:"0 auto 8px" }}/>
        <p style={{ fontSize:13 }}>Pas assez de données pour la heatmap</p>
        <p style={{ fontSize:11,marginTop:4,color:"#cbd5e1" }}>Il faut au moins 2 mois de données.</p>
      </div>
    );
  }

  const cellW = Math.max(58, Math.min(100, Math.floor(600/months.length)));
  const cellH = 44;
  const colTotals = months.map(m => services.reduce((s,svc) => s+(data[svc]?.[m.key]||0), 0));
  const grandTotal = colTotals.reduce((s,v) => s+v, 0);

  return (
    <div>
      <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap" }}>
        <div style={{ display:"flex",alignItems:"center",gap:8,flex:1,minWidth:200 }}>
          <span style={{ fontSize:10,color:"#94a3b8",fontWeight:600 }}>0 €</span>
          <div style={{ position:"relative",flex:1,maxWidth:180,height:12,borderRadius:99,background:"linear-gradient(to right,#dbeafe,#fef08a,#ea580c,#1B5E46)",border:"1px solid #e2e8f0" }}/>
          <span style={{ fontSize:10,color:"#94a3b8",fontWeight:600 }}>{fmt0(maxValue)} €</span>
        </div>
        <div style={{ display:"flex",background:"#f1f5f9",borderRadius:8,padding:2,gap:1 }}>
          {[["total","Par total"],["peak","Par pic"],["name","A→Z"]].map(([v,l])=>(
            <button key={v} onClick={()=>setSortMode(v)} style={{ padding:"4px 10px",borderRadius:6,border:"none",fontSize:11,fontWeight:600,cursor:"pointer",background:sortMode===v?"white":"transparent",color:sortMode===v?"#1B5E46":"#94a3b8" }}>{l}</button>
          ))}
        </div>
        <button onClick={()=>setShowValues(v=>!v)} style={{ padding:"5px 12px",borderRadius:8,border:"1px solid #e2e8f0",fontSize:11,fontWeight:600,cursor:"pointer" }}>{showValues?"👁 Valeurs":"👁 Masqué"}</button>
      </div>
      <div style={{ overflowX:"auto" }}>
        <div style={{ minWidth:200+cellW*months.length+(showRowTotals?64:0) }}>
          <div style={{ display:"flex",marginBottom:3 }}>
            <div style={{ width:200 }}/>
            {months.map((m,mi)=>(
              <div key={mi} style={{ width:cellW,margin:"0 2px",textAlign:"center",padding:"5px 2px" }}>
                <div style={{ fontSize:11,fontWeight:700,color:"#64748b" }}>{m.label}</div>
                <div style={{ fontSize:10,color:"#94a3b8" }}>{fmt0(colTotals[mi])} €</div>
              </div>
            ))}
            {showRowTotals&&<div style={{ width:64 }}/>}
          </div>
          {sorted.map((svc,si)=>{
            const cat=detectOvhCategory(svc);
            const catColor=CAT_COLOR_MAP[cat]||"#64748b";
            const rowTotal=months.reduce((s,m)=>s+(data[svc]?.[m.key]||0),0);
            const rowMax=Math.max(...months.map(m=>data[svc]?.[m.key]||0));
            return (
              <div key={svc} style={{ display:"flex",alignItems:"center",marginBottom:3 }}>
                <div style={{ width:200,padding:"0 10px",display:"flex",gap:6 }}>
                  <div style={{ width:3,background:catColor,borderRadius:99 }}/>
                  <div style={{ fontSize:11 }} title={svc}>{svc}<div style={{ marginTop:2 }}><CatBadge cat={cat}/></div></div>
                </div>
                {months.map((m,mi)=>{
                  const val=data[svc]?.[m.key]||0;
                  const bg=heatColor(val,maxValue);
                  const txt=heatTextColor(val,maxValue);
                  const isPeak=val===rowMax&&val>0;
                  return (
                    <div key={mi} onMouseEnter={()=>setHovered({si,mi})} onMouseLeave={()=>setHovered(null)} title={`${svc} — ${m.label}\n${fmt2(val)} €`} style={{ width:cellW,height:cellH,margin:"0 2px",background:bg,borderRadius:9,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center" }}>
                      {val>0?(<>{showValues&&<span style={{ fontSize:11,fontWeight:800,color:txt }}>{formatCell(val)} €</span>}{isPeak&&<span style={{ fontSize:8,opacity:.7,color:txt }}>▲ pic</span>}</>):<span style={{ color:"#e2e8f0" }}>—</span>}
                    </div>
                  );
                })}
                {showRowTotals&&<div style={{ width:64,paddingLeft:8,display:"flex",flexDirection:"column",alignItems:"flex-end" }}><span style={{ fontSize:11,fontWeight:800 }}>{fmt0(rowTotal)} €</span>{rowTotal>0&&<span style={{ fontSize:9,color:"#94a3b8" }}>{Math.round((rowTotal/grandTotal)*100)}%</span>}</div>}
              </div>
            );
          })}
          <div style={{ display:"flex",marginTop:6,paddingTop:8,borderTop:"2px solid #f1f5f9" }}>
            <div style={{ width:200,fontWeight:800,fontSize:11 }}>Total / mois</div>
            {months.map((m,mi)=>{
              const ct=colTotals[mi];
              const isMax=ct===Math.max(...colTotals);
              return (
                <div key={mi} style={{ width:cellW,margin:"0 2px",textAlign:"center" }}>
                  <span style={{ fontSize:12,fontWeight:900,color:isMax?"#1B5E46":"#374151" }}>{fmt0(ct)} €</span>
                  {isMax&&<div style={{ fontSize:9,color:"#16a34a" }}>▲ max</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// SERVICE FILTER — with price + % per item
// ══════════════════════════════════════════════════════════════════════
function ServiceFilter({
    allItems,
    selected,
    onChange,
    max = 5,
    placeholder = 'Sélectionner…',
    itemRefs = {},
    itemTotals = {},
    grandTotal = 0,
    refCostMap = {}          // ← Ajouté : { serviceName: [{ref, amount}, ...] }
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [expanded, setExpanded] = useState(null);   // ← Pour ouvrir le détail d'un service
    const searchRef = useRef(null);

    const TAG_MAP = {
        '@ip': 'IP', '@vps': 'VPS', '@dedicated': 'Dedicated', '@dedi': 'Dedicated',
        '@snapshot': 'Snapshot', '@snap': 'Snapshot', '@backup': 'Backup',
        '@storage': 'Storage', '@dns': 'DNS/NS', '@option': 'Option',
    };

    const filteredItems = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return allItems;
        const tagMatch = TAG_MAP[q];
        if (tagMatch) return allItems.filter(s => detectOvhCategory(s) === tagMatch);
        return allItems.filter(s =>
            s.toLowerCase().includes(q) || (itemRefs[s] || '').toLowerCase().includes(q)
        );
    }, [allItems, search, itemRefs]);

    const sortedFiltered = useMemo(() =>
        [...filteredItems].sort((a, b) => (itemTotals[b] || 0) - (itemTotals[a] || 0)),
        [filteredItems, itemTotals]
    );

    const toggle = s => {
        if (selected.includes(s)) onChange(selected.filter(x => x !== s));
        else if (selected.length < max) onChange([...selected, s]);
    };

    const maxItemTotal = Math.max(...allItems.map(s => itemTotals[s] || 0), 1);
    const TAG_CHIPS = ['@ip', '@vps', '@dedicated', '@snapshot', '@backup'];

    return (
        <div style={{ position: 'relative', marginBottom: 12 }}>
            {/* Pill bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '7px 12px', background: '#f8fafc', borderRadius: 10, border: '1.5px solid #e2e8f0' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.07em', flexShrink: 0 }}>Filtrer :</span>
                {selected.length === 0 ? (
                    <span style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>{placeholder}</span>
                ) : selected.map((s, i) => {
                    const cat = detectOvhCategory(s);
                    const c = CAT_COLOR_MAP[cat] || COLORS[i % COLORS.length];
                    const total = itemTotals[s] || 0;
                    const pct = grandTotal > 0 ? ((total / grandTotal) * 100).toFixed(1) : '0.0';
                    return (
                        <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px 3px 7px', borderRadius: 6, background: c + '15', border: `1px solid ${c}40`, fontSize: 11, fontWeight: 600, color: c }}>
                            <span style={{ width: 6, height: 6, borderRadius: 2, background: c }} />
                            {shortName(s, 13)}
                            <span style={{ fontSize: 9, color: c + 'aa', fontWeight: 700 }}>{fmt2(total)}€ · {pct}%</span>
                            <CatBadge cat={cat} />
                            <button onClick={e => { e.stopPropagation(); toggle(s); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: c, fontSize: 14, fontWeight: 700, marginLeft: 1 }}>×</button>
                        </span>
                    );
                })}
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: selected.length >= max ? '#fef3c7' : '#f1f5f9', color: selected.length >= max ? '#d97706' : '#64748b', border: selected.length >= max ? '1px solid #fcd34d' : '1px solid #e2e8f0' }}>
                        {selected.length}/{max}
                    </span>
                    <button onClick={() => { setOpen(o => !o); setTimeout(() => searchRef.current?.focus(), 80); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#374151', fontFamily: 'inherit' }}>
                        Choisir <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .2s' }} />
                    </button>
                </div>
            </div>

            {open && (
                <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 200, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,.12)', overflow: 'hidden' }}>
                    {/* Search */}
                    <div style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9', background: '#fafbfd' }}>
                        <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, pointerEvents: 'none' }}>🔍</span>
                            <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Escape') { setSearch(''); setOpen(false); }
                                    if (e.key === 'Enter' && sortedFiltered.length > 0) toggle(sortedFiltered[0]);
                                }}
                                placeholder="Rechercher par nom, hostname, réf… @ip @vps"
                                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 36px 8px 32px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 12, fontFamily: 'inherit', background: 'white', outline: 'none', color: '#374151' }}
                                onFocus={e => e.target.style.borderColor = '#1B5E46'}
                                onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
                            {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 16 }}>×</button>}
                        </div>
                        <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
                            {TAG_CHIPS.map(tag => {
                                const catName = TAG_MAP[tag];
                                const color = CAT_COLOR_MAP[catName] || '#64748b';
                                const isActive = search.toLowerCase() === tag;
                                return <button key={tag} onClick={() => setSearch(isActive ? '' : tag)}
                                    style={{ padding: '3px 9px', borderRadius: 99, border: `1.5px solid ${color}44`, background: isActive ? color : color + '12', color: isActive ? 'white' : color, fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                                    {tag}
                                </button>;
                            })}
                            <span style={{ fontSize: 10, color: '#cbd5e1', alignSelf: 'center', marginLeft: 2 }}>raccourcis catégorie</span>
                        </div>
                    </div>

                    {/* Column header */}
                    <div style={{ display: 'grid', gridTemplateColumns: '16px 8px 1fr 88px 52px 80px 28px', gap: '0 8px', padding: '5px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <span /><span />
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em' }}>Service / Référence</span>
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', textAlign: 'right' }}>Total HT</span>
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', textAlign: 'right' }}>Part</span>
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', textAlign: 'right' }}>TVA · TTC</span>
                        <span /> {/* chevron column */}
                    </div>

                    {/* Items list */}
                    <div style={{ maxHeight: 420, overflowY: 'auto', padding: '4px 0' }}>
                        {sortedFiltered.length === 0 ? (
                            <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                                <div style={{ fontSize: 24, marginBottom: 6 }}>🔍</div>
                                <p style={{ fontSize: 12, margin: 0 }}>Aucun résultat pour « {search} »</p>
                            </div>
                        ) : sortedFiltered.map((s, i) => {
                            const isSel = selected.includes(s);
                            const isDis = !isSel && selected.length >= max;
                            const cat = detectOvhCategory(s);
                            const c = CAT_COLOR_MAP[cat] || COLORS[i % COLORS.length];
                            const total = itemTotals[s] || 0;
                            const pct = grandTotal > 0 ? (total / grandTotal) * 100 : 0;
                            const barW = maxItemTotal > 0 ? (total / maxItemTotal) * 100 : 0;
                            const ref = itemRefs[s] || null;
                            const q = search.startsWith('@') ? '' : search.toLowerCase();
                            const isExpanded = expanded === s;

                            const hl = (text, max = 999) => {
                                const disp = text.length > max ? text.slice(0, max - 1) + '…' : text;
                                if (!q || !disp.toLowerCase().includes(q)) return disp;
                                const idx = disp.toLowerCase().indexOf(q);
                                return <>{disp.slice(0, idx)}<mark style={{ background: '#fef08a', color: '#374151', borderRadius: 2, padding: '0 1px' }}>{disp.slice(idx, idx + q.length)}</mark>{disp.slice(idx + q.length)}</>;
                            };

                            return (
                                <React.Fragment key={s}>
                                    {/* Ligne principale */}
                                    <div
                                        onClick={() => !isDis && toggle(s)}
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: '16px 8px 1fr 88px 52px 80px 28px',
                                            gap: '0 8px',
                                            alignItems: 'start',
                                            padding: '10px 14px',
                                            cursor: isDis ? 'not-allowed' : 'pointer',
                                            opacity: isDis ? 0.35 : 1,
                                            background: isSel ? c + '0d' : (isExpanded ? '#f0fdf4' : 'transparent'),
                                            borderLeft: isSel ? `3px solid ${c}` : '3px solid transparent',
                                            transition: 'background .15s',
                                            borderBottom: isExpanded ? 'none' : '1px solid #f1f5f9'
                                        }}
                                        onMouseEnter={e => { if (!isDis) e.currentTarget.style.background = isSel ? c + '18' : '#f8fafc'; }}
                                        onMouseLeave={e => { e.currentTarget.style.background = isSel ? c + '0d' : 'transparent'; }}
                                    >
                                        {/* Checkbox */}
                                        <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 2, border: isSel ? 'none' : '1.5px solid #cbd5e1', background: isSel ? c : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            {isSel && <Check size={10} color="white" strokeWidth={3} />}
                                        </div>
                                        {/* Dot */}
                                        <span style={{ width: 8, height: 8, borderRadius: 2, background: c, flexShrink: 0, marginTop: 4 }} />
                                        {/* Name + ref + bar */}
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                                                <span style={{ fontSize: 12, color: isSel ? '#0f172a' : '#374151', fontWeight: isSel ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {hl(s, 30)}
                                                </span>
                                                <CatBadge cat={cat} />
                                            </div>
                                            {ref && <div style={{ fontSize: 10, fontFamily: 'monospace', color: isSel ? c : '#94a3b8', fontWeight: 500, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }} title={ref}>
                                                {hl(ref, 38)}
                                            </div>}
                                            {total > 0 && <div style={{ height: 3, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden', maxWidth: 130 }}>
                                                <div style={{ height: 3, borderRadius: 99, background: `linear-gradient(90deg,${c},${c}80)`, width: `${barW}%` }} />
                                            </div>}
                                        </div>
                                        {/* Total HT */}
                                        <div style={{ textAlign: 'right', paddingTop: 1 }}>
                                            <div style={{ fontSize: 12, fontWeight: 800, color: isSel ? c : '#0f172a' }}>{fmt2(total)} €</div>
                                            <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 1 }}>HT</div>
                                        </div>
                                        {/* Share % */}
                                        <div style={{ textAlign: 'right', paddingTop: 2 }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: pct >= 10 ? c : '#64748b', background: pct >= 10 ? c + '12' : '#f8fafc', padding: '2px 5px', borderRadius: 99, border: `1px solid ${pct >= 10 ? c + '33' : '#e2e8f0'}`, display: 'inline-block' }}>
                                                {pct.toFixed(1)}%
                                            </span>
                                        </div>
                                        {/* TVA + TTC */}
                                        <div style={{ textAlign: 'right', paddingTop: 1 }}>
                                            <div style={{ fontSize: 9, color: '#7C3AED', fontWeight: 600 }}>{fmt2(total * 0.2)} €</div>
                                            <div style={{ fontSize: 9, color: '#0891B2', fontWeight: 700 }}>{fmt2(total * 1.2)} €</div>
                                        </div>
                                        {/* Chevron */}
                                        <div
                                            onClick={(e) => { e.stopPropagation(); setExpanded(isExpanded ? null : s); }}
                                            style={{
                                                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: 18, color: isExpanded ? '#1B5E46' : '#94a3b8', cursor: 'pointer',
                                                transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform .25s'
                                            }}
                                        >
                                            ▾
                                        </div>
                                    </div>

                                    {/* === PANNEAU DÉTAIL === */}
                                    {isExpanded && refCostMap[s] && refCostMap[s].length > 0 && (
                                        <div style={{
                                            margin: '0 14px 12px',
                                            background: 'white',
                                            border: `1.5px solid ${c}30`,
                                            borderRadius: '0 0 12px 12px',
                                            boxShadow: '0 8px 25px rgba(27,94,70,0.1)',
                                            overflow: 'hidden'
                                        }}>
                                            <div style={{ padding: '16px 20px', background: c + '08', display: 'flex', alignItems: 'center', gap: 12 }}>
                                                <span style={{ fontSize: 15, fontWeight: 700 }}>{shortName(s, 45)}</span>
                                                <CatBadge cat={cat} />
                                                <div style={{ marginLeft: 'auto', fontSize: 20, fontWeight: 900, color: c }}>
                                                    {fmt2(total)} € <span style={{ fontSize: 13, fontWeight: 500, color: '#64748b' }}>HT</span>
                                                </div>
                                            </div>

                                            <div style={{ padding: '18px 20px' }}>
                                                <div style={{ fontSize: 11, fontWeight: 800, color: '#374151', marginBottom: 12, letterSpacing: '.6px' }}>
                                                    🔗 RÉFÉRENCES & CONSOMMATION DÉTAILLÉE
                                                </div>

                                                {/* En-tête colonnes */}
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 70px 70px 60px', gap: '0 12px', padding: '6px 12px', fontSize: 9.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', borderBottom: '1px solid #e2e8f0' }}>
                                                    <span>Référence / Hostname</span>
                                                    <span style={{ textAlign: 'right' }}>Montant HT</span>
                                                    <span style={{ textAlign: 'right' }}>TVA 20%</span>
                                                    <span style={{ textAlign: 'right' }}>TTC</span>
                                                    <span style={{ textAlign: 'right' }}>Part</span>
                                                </div>

                                                {refCostMap[s].map((r, ri) => {
                                                    const refPct = total > 0 ? (r.amount / total) * 100 : 0;
                                                    return (
                                                        <div key={ri} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 70px 70px 60px', gap: '0 12px', alignItems: 'center', padding: '12px', background: '#fafbfc', borderBottom: '1px solid #f1f5f9' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                                <span style={{ minWidth: 22, height: 22, borderRadius: 6, background: c + '15', color: c, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{ri + 1}</span>
                                                                <span style={{ fontFamily: 'monospace', fontSize: 12.5, color: '#1e2937', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.ref}>
                                                                    {r.ref}
                                                                </span>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(r.ref); toast.success('Référence copiée !'); }}
                                                                    style={{ padding: '4px 7px', background: c + '10', border: `1px solid ${c}30`, borderRadius: 5, fontSize: 11, color: c, cursor: 'pointer' }}
                                                                >
                                                                    📋
                                                                </button>
                                                            </div>
                                                            <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 800, color: '#16a34a' }}>{fmt2(r.amount)} €</div>
                                                            <div style={{ textAlign: 'right', fontSize: 12.5, fontWeight: 600, color: '#7C3AED' }}>{fmt2(r.amount * 0.2)} €</div>
                                                            <div style={{ textAlign: 'right', fontSize: 12.5, fontWeight: 700, color: '#0891B2' }}>{fmt2(r.amount * 1.2)} €</div>
                                                            <div style={{ textAlign: 'right' }}>
                                                                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 99, background: refPct >= 15 ? c + '15' : '#f1f5f9', color: refPct >= 15 ? c : '#64748b' }}>
                                                                    {refPct.toFixed(1)}%
                                                                </span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}

                                                {/* Total références */}
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 70px 70px 60px', gap: '0 12px', padding: '14px 12px', background: '#f0fdf4', fontWeight: 700, fontSize: 13, color: '#1B5E46', borderRadius: '0 0 10px 10px' }}>
                                                    <span>Σ Total des références</span>
                                                    <div style={{ textAlign: 'right' }}>{fmt2(refCostMap[s].reduce((sum, r) => sum + r.amount, 0))} €</div>
                                                    <div style={{ textAlign: 'right', color: '#7C3AED' }}>{fmt2(refCostMap[s].reduce((sum, r) => sum + r.amount * 0.2, 0))} €</div>
                                                    <div style={{ textAlign: 'right', color: '#0891B2' }}>{fmt2(refCostMap[s].reduce((sum, r) => sum + r.amount * 1.2, 0))} €</div>
                                                    <div style={{ textAlign: 'right', color: '#16a34a' }}>100%</div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </div>

                    {selected.length >= max && (
                        <div style={{ padding: '8px 14px', background: '#fffbeb', borderTop: '1px solid #fde68a', fontSize: 11, color: '#d97706', fontWeight: 600 }}>
                            ⚠️ Maximum {max} éléments atteint.
                        </div>
                    )}
                </div>
            )}

            {open && <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => { setOpen(false); setSearch(''); }} />}
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ══════════════════════════════════════════════════════════════════════
export default function Dashboard() {
  const [costs,      setCosts]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [period,     setPeriod]     = useState('Tout');
  const [lastUpdate, setLastUpdate] = useState(new Date());

  const [selectedServers,   setSelectedServers]   = useState([]);
  const [selectedServices,  setSelectedServices]  = useState([]);
  const [heatServices,      setHeatServices]      = useState([]);
  const [curveTypeServers,  setCurveTypeServers]  = useState("smooth");
  const [curveTypeServices, setCurveTypeServices] = useState("smooth");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await costsService.getCosts(0, 5000);
      setCosts(Array.isArray(data) ? data : []);
      setLastUpdate(new Date());
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error('Erreur: ' + (typeof d==='string' ? d : e.message));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = useMemo(() => {
    const opt = PERIOD_OPTIONS.find(p => p.label===period);
    if (!opt?.days) return costs;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate()-opt.days);
    return costs.filter(c => { const d=parseDate(c.cost_date); return d&&d>=cutoff; });
  }, [costs, period]);

  const analytics = useMemo(() => {
    if (!filtered.length) return null;

    const total    = filtered.reduce((s,c) => s+Number(c.amount||0), 0);
    const tva      = total * 0.20;
    const ttc      = total * 1.20;
    const avg      = total / filtered.length;
    const maxCost  = Math.max(...filtered.map(c => Number(c.amount||0)));
    const maxEntry = filtered.find(c => Number(c.amount||0) === maxCost);
    const rawServices = [...new Set(filtered.map(c => c.service_name).filter(Boolean))];

    const enriched = filtered.map(c => {
      const hostnameMatch = (c.service_name || '').match(/([a-z0-9-]+\.(?:vps|dedicated|cloud|ovh)\.(?:net|com|eu|fr))/i);
      const exactRef = [c.reference, c.resource_id, c.external_id]
        .map(v => (v || '').toString().trim())
        .find(Boolean)
        || (hostnameMatch ? hostnameMatch[1].toLowerCase() : null);
      const serviceKey = (c.service_name || '').trim() || '?';
      return {
        ...c,
        _cat: detectOvhCategory(c.service_name),
        _serviceKey: serviceKey,
        _refId: exactRef,
        _serverKey: exactRef || `UNREFERENCED::${serviceKey}`,
      };
    });

    const serverLines  = enriched.filter(c => isServer(c._cat));
    const serviceLines = enriched.filter(c => isService(c._cat));

    const buildTotals = (lines, keyField) => {
      const map = {};
      lines.forEach(c => {
        const key = c[keyField];
        if (!key) return;
        map[key] = (map[key] || 0) + Number(c.amount || 0);
      });
      return map;
    };

    const serverTotals  = buildTotals(serverLines, '_serverKey');
    const serviceTotals = buildTotals(serviceLines, '_serviceKey');
    const allTotals     = buildTotals(enriched, '_serviceKey');

    const topN = (map, n=10) =>
      Object.entries(map).sort((a,b) => b[1]-a[1]).slice(0,n).map(([k]) => k);

    const top10Servers   = topN(serverTotals, 10);
    const top10Services  = topN(serviceTotals, 10);

    // ── itemRefs: { service_name → search string of refs/hostnames }
    const refMapRaw = {};
    enriched.forEach(c => {
      if (!refMapRaw[c._serviceKey]) refMapRaw[c._serviceKey] = new Set();
      if (c.reference)   refMapRaw[c._serviceKey].add(c.reference);
      if (c.resource_id) refMapRaw[c._serviceKey].add(c.resource_id);
      if (c.external_id) refMapRaw[c._serviceKey].add(c.external_id);
      const hostnameMatch = (c.service_name||'').match(/([a-z0-9-]+\.(?:vps|dedicated|cloud|ovh)\.(?:net|com|eu|fr))/i);
      if (hostnameMatch) refMapRaw[c._serviceKey].add(hostnameMatch[1].toLowerCase());
    });
    const itemRefs = {};
    Object.entries(refMapRaw).forEach(([name, set]) => {
      const refs = [...set].filter(Boolean);
      if (refs.length) itemRefs[name] = refs.join(' ');
    });

    // ── refCostMap: { service_name → [ { ref, amount } ] }
    const refCostRaw = {};
    enriched.forEach(c => {
      if (!refCostRaw[c._serviceKey]) refCostRaw[c._serviceKey] = [];
      const primaryId = c._refId || shortName(c.service_name, 30);
      const amount = Number(c.amount || 0);
      if (amount > 0) {
        refCostRaw[c._serviceKey].push({
          ref: primaryId,
          amount,
          date: c.cost_date || null,
        });
      }
    });

    const refCostMap = {};
    Object.entries(refCostRaw).forEach(([serviceName, refs]) => {
      refCostMap[serviceName] = refs.sort((a, b) => b.amount - a.amount);
    });
    // Build month map (with all months pre-filled at 0)
    const buildMonthMap = (lines, topKeys, keyField) => {
      const monthsInLines = {};
      lines.forEach(c => {
        const d = parseDate(c.cost_date); if (!d) return;
        const key = getMonthKey(d);
        if (!monthsInLines[key]) monthsInLines[key] = getMonthLabel(d);
      });
      const sortedMonthKeys = Object.keys(monthsInLines).sort();
      const map = {};
      sortedMonthKeys.forEach(key => {
        map[key] = { month:key, label:monthsInLines[key] };
        topKeys.forEach(k => { map[key][k] = 0; });
      });
      lines.forEach(c => {
        const d = parseDate(c.cost_date); if (!d) return;
        const key = getMonthKey(d);
        const entityKey = c[keyField];
        if (map[key] && entityKey in map[key]) { map[key][entityKey] += Number(c.amount||0); }
      });
      return Object.values(map).sort((a,b) => a.month.localeCompare(b.month));
    };

    const mMap = {};
    enriched.forEach(c => {
      const d = parseDate(c.cost_date); if (!d) return;
      const key = getMonthKey(d);
      if (!mMap[key]) mMap[key] = { month:key, label:getMonthLabel(d), total:0 };
      mMap[key].total += Number(c.amount||0);
    });
    const byMonth   = Object.values(mMap).sort((a,b) => a.month.localeCompare(b.month));
    const allMonths = byMonth.map(m => ({ key:m.month, label:m.label }));

    const byServerMonth  = buildMonthMap(serverLines,  top10Servers, '_serverKey');
    const byServiceMonth = buildMonthMap(serviceLines, top10Services, '_serviceKey');

    // Heatmap
    const top12All = topN(allTotals, 12);
    const heatData = {};
    top12All.forEach(svc => { heatData[svc] = {}; });
    enriched.forEach(c => {
      const d = parseDate(c.cost_date); if (!d) return;
      const key = getMonthKey(d);
      if (c._serviceKey in heatData) { heatData[c._serviceKey][key] = (heatData[c._serviceKey][key]||0) + Number(c.amount||0); }
    });
    const heatMax = Math.max(...top12All.flatMap(svc => Object.values(heatData[svc]||{})), 1);

    const catMap = {};
    enriched.forEach(c => { catMap[c._cat] = (catMap[c._cat]||0) + Number(c.amount||0); });
    const donutByCategory = Object.entries(catMap).map(([name,value]) => ({ name, value:Math.round(value*100)/100 })).sort((a,b) => b.value-a.value);

    const top8Data = Object.entries(allTotals).sort((a,b) => b[1]-a[1]).slice(0,8).map(([name,value]) => ({ name, value:Math.round(value*100)/100 }));

    const topServices = Object.entries(allTotals).sort((a,b) => b[1]-a[1]).slice(0,8).map(([name,total]) => ({ name, total }));

    const srcMap = {};
    enriched.forEach(c => { const k=c.source||'Fichier'; srcMap[k]=(srcMap[k]||0)+Number(c.amount||0); });
    const bySource = Object.entries(srcMap).map(([name,value]) => ({ name, value })).sort((a,b) => b.value-a.value);

    const totalServers  = serverLines.reduce((s,c) => s+Number(c.amount||0), 0);
    const totalServices = serviceLines.reduce((s,c) => s+Number(c.amount||0), 0);

    const months2 = [...new Set(enriched.map(c => { const d=parseDate(c.cost_date); return d?getMonthKey(d):null; }).filter(Boolean))].sort();
    let trendPct = 0;
    if (months2.length >= 2) {
      const curr = mMap[months2[months2.length-1]]?.total || 0;
      const prev = mMap[months2[months2.length-2]]?.total || 0;
      trendPct = prev > 0 ? Math.round(((curr-prev)/prev)*100) : 0;
    }

    return {
      total, tva, ttc, avg, maxCost, maxEntry,
      nbServices: rawServices.length, nbEntries: filtered.length, trendPct,
      totalServers, totalServices,
      top5Servers:    top10Servers.slice(0,5),
      top5Services:   top10Services.slice(0,5),
      topServers:     top10Servers,
      topServiceKeys: top10Services,
      top12All,
      byServerMonth, byServiceMonth, byMonth,
      topServices, bySource,
      donutByCategory, top8Data,
      heatData, heatMax, allMonths,
      itemRefs,
      itemTotals: allTotals,       // { serviceName → total amount }
      refCostMap,                  // { serviceName → [ { ref, amount } ] }
    };
  }, [filtered]);

  useEffect(() => {
    if (analytics) {
      setSelectedServers(prev  => prev.length ? prev : (analytics.top5Servers  || []));
      setSelectedServices(prev => prev.length ? prev : (analytics.top5Services || []));
      setHeatServices(prev     => prev.length ? prev : (analytics.top12All     || []).slice(0,10));
    }
  }, [analytics?.top5Servers?.join(','), analytics?.top12All?.join(',')]);

  const handleExport = () => {
    if (!filtered.length) return;
    const headers = ['Date','Service','Référence','Montant HT','TVA','TTC','Devise','Projet','Source'];
    const rows = filtered.map(c => {
      const ht = Number(c.amount||0);
      const ref = [c.reference, c.resource_id, c.external_id].filter(Boolean)[0] || '';
      return [c.cost_date, c.service_name, ref, ht.toFixed(2), (ht*.2).toFixed(2), (ht*1.2).toFixed(2), c.currency, c.project_id||'', c.source||''].join(',');
    });
    const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type:'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `finops-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success('Export CSV téléchargé !');
  };

  const isEmptyState = !loading && !filtered.length;

  return (
    <Layout>
      <style>{`
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes expandIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
        .spin{animation:spin 1s linear infinite}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:#f8fafc}
        ::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:99px}
      `}</style>

      {/* ── Header ── */}
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24,flexWrap:'wrap',gap:12 }}>
        <div style={{ display:'flex',alignItems:'center',gap:12 }}>
          <div style={{ width:38,height:38,borderRadius:11,background:'#1B5E46',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 2px 8px rgba(27,94,70,.3)' }}>
            <Activity size={19} color="white"/>
          </div>
          <div>
            <h1 style={{ fontSize:20,fontWeight:900,color:'#0f172a',letterSpacing:'-0.5px',margin:0 }}>FinOps Dashboard</h1>
            <p style={{ fontSize:11,color:'#94a3b8',margin:0,display:'flex',alignItems:'center',gap:4 }}>
              <Zap size={10} color="#f59e0b"/> Dernière mise à jour : {lastUpdate.toLocaleTimeString('fr-FR')}
            </p>
          </div>
        </div>
        <div style={{ display:'flex',gap:8,alignItems:'center',flexWrap:'wrap' }}>
          <div style={{ display:'flex',background:'#f1f5f9',borderRadius:10,padding:3,gap:2 }}>
            {PERIOD_OPTIONS.map(opt=>(
              <button key={opt.label} onClick={()=>setPeriod(opt.label)} style={{ padding:'6px 14px',borderRadius:8,border:'none',fontFamily:'inherit',fontSize:12,fontWeight:600,cursor:'pointer',transition:'all .15s',background:period===opt.label?'white':'transparent',color:period===opt.label?'#1B5E46':'#94a3b8',boxShadow:period===opt.label?'0 1px 4px rgba(0,0,0,.08)':'none' }}>{opt.label}</button>
            ))}
          </div>
          <button onClick={handleExport} disabled={!filtered.length} style={{ display:'flex',alignItems:'center',gap:6,padding:'8px 16px',background:'white',border:'1.5px solid #e2e8f0',borderRadius:10,fontWeight:600,fontSize:12,cursor:filtered.length?'pointer':'not-allowed',fontFamily:'inherit',color:'#374151',opacity:filtered.length?1:.5 }}>
            <Download size={13}/> Export
          </button>
          <button onClick={loadData} style={{ display:'flex',alignItems:'center',gap:6,padding:'8px 16px',background:'#1B5E46',color:'white',border:'none',borderRadius:10,fontWeight:600,fontSize:12,cursor:'pointer',fontFamily:'inherit',boxShadow:'0 2px 8px rgba(27,94,70,.3)' }}>
            <RefreshCw size={13} className={loading?'spin':''}/> Actualiser
          </button>
        </div>
      </div>

      {isEmptyState && (
        <div style={{ background:'#fffbeb',border:'1.5px solid #fcd34d',borderRadius:14,padding:'24px',textAlign:'center',marginBottom:24 }}>
          <AlertTriangle size={28} color="#d97706" style={{ margin:'0 auto 10px',display:'block' }}/>
          <p style={{ fontSize:14,fontWeight:700,color:'#92400e',marginBottom:4 }}>Aucune donnée disponible</p>
          <p style={{ fontSize:12,color:'#b45309' }}>Importez des fichiers (Excel, CSV, PDF OVH) ou connectez une API cloud.</p>
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div style={{ display:'flex',gap:14,flexWrap:'wrap',marginBottom:20 }}>
        <KPICard label="Coût total HT"   value={fmt2(analytics?.total||0)}   topColor="#2563eb" iconBg="#3b82f6" icon={DollarSign} trend={analytics?.trendPct} sub={`${analytics?.nbEntries||0} entrées`}/>
        <KPICard label="TVA (20%)"        value={fmt2(analytics?.tva||0)}     topColor="#8b5cf6" iconBg="#8b5cf6" icon={Percent}   trend={null} sub="Montant TVA"/>
        <KPICard label="Total TTC"        value={fmt2(analytics?.ttc||0)}     topColor="#f59e0b" iconBg="#f59e0b" icon={Receipt}   trend={null} sub="TVA 20% incluse"/>
        <KPICard label="Services actifs"  value={analytics?.nbServices||0} unit="" topColor="#1B5E46" iconBg="#1B5E46" icon={Zap} trend={null} sub="services cloud actifs"/>
        <KPICard label="Coût moyen HT"    value={fmt2(analytics?.avg||0)}     topColor="#f97316" iconBg="#f97316" icon={BarChart2} trend={null} sub="par entrée"/>
        <KPICard label="Pic de coût"      value={fmt2(analytics?.maxCost||0)} topColor="#ef4444" iconBg="#ef4444" icon={TrendingUp} trend={null} sub={analytics?.maxEntry?`↑ ${shortName(analytics.maxEntry.service_name,20)}`:'montant max'}/>
        <KPICard label="Entrées"          value={analytics?.nbEntries||0} unit="" topColor="#06b6d4" iconBg="#06b6d4" icon={FileText} trend={null} sub="lignes de coûts"/>
      </div>

      {analytics && (
        <>
          {/* ── Récapitulatif Fiscal ── */}
          <div style={{ background:'white',borderRadius:16,border:'1px solid #e8edf5',boxShadow:'0 1px 8px rgba(0,0,0,.04)',padding:'20px 22px',marginBottom:18 }}>
            <div style={{ marginBottom:14 }}>
              <h3 style={{ fontSize:14,fontWeight:800,color:'#0f172a',margin:0 }}>Récapitulatif Fiscal</h3>
              <p style={{ fontSize:11,color:'#94a3b8',margin:'3px 0 0' }}>Décomposition HT / TVA / TTC</p>
            </div>
            <div style={{ display:'flex',gap:14,alignItems:'center',flexWrap:'wrap' }}>
              {[
                { label:'Total HT',  value:analytics.total, color:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0', sub:'Hors taxes' },
                null,
                { label:'TVA 20%',   value:analytics.tva,   color:'#7C3AED', bg:'#faf5ff', border:'#e9d5ff', sub:'Taxe sur la valeur ajoutée' },
                null,
                { label:'Total TTC', value:analytics.ttc,   color:'#0891B2', bg:'#f0f9ff', border:'#bae6fd', sub:'Toutes taxes comprises' },
              ].map((item,i)=>
                item===null?(
                  <span key={i} style={{ fontSize:26,color:'#cbd5e1',fontWeight:200 }}>{i===1?'+':'='}</span>
                ):(
                  <div key={i} style={{ flex:1,minWidth:130,background:item.bg,borderRadius:12,padding:'14px 16px',border:`1.5px solid ${item.border}` }}>
                    <p style={{ fontSize:10,fontWeight:800,color:item.color,textTransform:'uppercase',letterSpacing:'.08em',margin:'0 0 5px' }}>{item.label}</p>
                    <p style={{ fontSize:22,fontWeight:900,color:'#0f172a',margin:0 }}>{fmt2(item.value)}{' '}<span style={{ fontSize:13,color:'#94a3b8',fontWeight:500 }}>€</span></p>
                    <p style={{ fontSize:11,color:'#64748b',marginTop:3 }}>{item.sub}</p>
                  </div>
                )
              )}
              <div style={{ flex:2,minWidth:180,background:'#f8fafc',borderRadius:12,padding:'14px 16px',border:'1.5px solid #e2e8f0' }}>
                <p style={{ fontSize:12,fontWeight:700,color:'#374151',margin:'0 0 5px' }}>ℹ️ Calcul TVA</p>
                <p style={{ fontSize:11,color:'#64748b',lineHeight:1.7,margin:0 }}>Les coûts sont en <strong>HT</strong>.<br/>TVA française <strong>20%</strong> appliquée.<br/>TTC = montant réellement débité.</p>
              </div>
            </div>
          </div>

          {/* ── Top 8 + Budget ── */}
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16 }}>
            <ChartCard title="🏆 Top 8 services"
              sub={`Classement · ${period} · Total : ${fmt2(analytics.total)} € — cliquez une ligne pour le détail`}
              badge={<span style={{ fontSize:10,fontWeight:700,color:'#7C3AED',background:'#f5f3ff',padding:'2px 8px',borderRadius:99,border:'1px solid #ddd6fe' }}>Classement</span>}>
              <RankedCostChart
                data={analytics.top8Data}
                total={analytics.total}
                refCostMap={analytics.refCostMap}
              />
            </ChartCard>

            <ChartCard title="📊 Suivi Budget"
              sub="Consommation par service · cliquez une ligne pour le détail référence">
              <BudgetTracker topServices={analytics.topServices} analytics={analytics}/>
            </ChartCard>
          </div>
          

          {/* ── HEATMAP ── */}
          <ChartCard title="🔥 Heatmap des coûts"
            sub={`Intensité par service × mois · ${heatServices.length} service(s) · ${period}`}
            badge={<span style={{ fontSize:10,fontWeight:700,color:'#B45309',background:'#fffbeb',padding:'2px 8px',borderRadius:99,border:'1px solid #fde68a' }}>Heatmap</span>}
            style={{ marginBottom:16 }}>
            <ServiceFilter
              allItems={analytics.top12All}
              selected={heatServices}
              onChange={setHeatServices}
              max={12}
              placeholder="Choisir des services à afficher…"
              itemRefs={analytics.itemRefs}
              itemTotals={analytics.itemTotals}
              grandTotal={analytics.total}
            />
            <CostHeatmap data={analytics.heatData} services={heatServices} months={analytics.allMonths} maxValue={analytics.heatMax}/>
          </ChartCard>

          {/* ── COURBE SERVEURS ── */}
          <ChartCard title="🖥️ Évolution des coûts serveurs"
            sub={`VPS & Dédiés · mensuel · Infrastructure : ${fmt2(analytics.totalServers)} €`}
            badge={
              <div style={{ display:'flex',gap:6 }}>
                {[['smooth','Courbe'],['simple','Droite']].map(([v,l])=>(
                  <button key={v} onClick={()=>setCurveTypeServers(v)} style={{ fontSize:10,fontWeight:700,padding:'3px 8px',borderRadius:99,border:'1px solid #bfdbfe',cursor:'pointer',color:curveTypeServers===v?'#fff':'#2563EB',background:curveTypeServers===v?'#2563EB':'#eff6ff' }}>{l}</button>
                ))}
              </div>
            }
            style={{ marginBottom:16 }}>
            <ServiceFilter
              allItems={analytics.topServers}
              selected={selectedServers}
              onChange={setSelectedServers}
              max={5}
              placeholder="Choisir des serveurs VPS / Dédiés…"
              itemRefs={analytics.itemRefs}
              itemTotals={analytics.itemTotals}
              grandTotal={analytics.totalServers}
              refCostMap={analytics.refCostMap}
            />
            <CostTimeCurve data={analytics.byServerMonth} series={selectedServers} allKeys={analytics.topServers} height={300} totalAmount={analytics.totalServers}/>
          </ChartCard>

          {/* ── COURBE SERVICES ── */}
          <ChartCard title="⚙️ Évolution des coûts services / options"
            sub={`Options, IP, Snapshots… · mensuel · Options : ${fmt2(analytics.totalServices)} €`}
            badge={
              <div style={{ display:'flex',gap:6 }}>
                {[['smooth','Courbe'],['simple','Droite']].map(([v,l])=>(
                  <button key={v} onClick={()=>setCurveTypeServices(v)} style={{ fontSize:10,fontWeight:700,padding:'3px 8px',borderRadius:99,border:'1px solid #99f6e4',cursor:'pointer',color:curveTypeServices===v?'#fff':'#0F766E',background:curveTypeServices===v?'#0F766E':'#f0fdfa' }}>{l}</button>
                ))}
              </div>
            }
            style={{ marginBottom:16 }}>
            <ServiceFilter
              allItems={analytics.topServiceKeys}
              selected={selectedServices}
              onChange={setSelectedServices}
              max={5}
              placeholder="Choisir des options (IP, Snapshot, Disque…)"
              itemRefs={analytics.itemRefs}
              itemTotals={analytics.itemTotals}
              grandTotal={analytics.totalServices}
              refCostMap={analytics.refCostMap}
            />
            <CostTimeCurve data={analytics.byServiceMonth} series={selectedServices} allKeys={analytics.topServiceKeys} height={300} totalAmount={analytics.totalServices}/>
          </ChartCard>

          {/* ── Par Source ── */}
          <ChartCard title="Par source" sub="Origine des données">
            {analytics.bySource.length > 0 ? analytics.bySource.map((s,i) => {
              const pct = analytics.total>0 ? Math.round((s.value/analytics.total)*100) : 0;
              return (
                <div key={i} style={{ marginBottom:11 }}>
                  <div style={{ display:'flex',justifyContent:'space-between',marginBottom:4 }}>
                    <span style={{ fontSize:12,fontWeight:500,color:'#374151',display:'flex',alignItems:'center',gap:5 }}>{SOURCE_ICONS[s.name]||'📊'} {s.name}</span>
                    <span style={{ fontSize:12,fontWeight:800,color:'#0f172a' }}>{fmt2(s.value)} €<span style={{ fontSize:10,color:'#94a3b8',fontWeight:400,marginLeft:4 }}>{pct}%</span></span>
                  </div>
                  <div style={{ height:4,background:'#f1f5f9',borderRadius:99 }}>
                    <div style={{ height:4,borderRadius:99,background:COLORS[i%COLORS.length],width:`${pct}%` }}/>
                  </div>
                </div>
              );
            }) : <p style={{ fontSize:12,color:'#94a3b8',textAlign:'center',padding:'20px 0' }}>Aucune source</p>}
          </ChartCard>
        </>
      )}

      {loading && (
        <div style={{ textAlign:'center',padding:'60px 0',color:'#94a3b8' }}>
          <RefreshCw size={28} className="spin" style={{ margin:'0 auto 12px',display:'block',opacity:.35 }}/>
          <p style={{ fontSize:13 }}>Chargement des données...</p>
        </div>
      )}
    </Layout>
  );
}
