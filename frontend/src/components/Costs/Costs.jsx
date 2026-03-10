import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Filter, Plus, Edit2, Trash2, RefreshCw,
  DollarSign, TrendingUp, BarChart2, FileText,
  ChevronUp, ChevronDown, X, Save, Upload,
  Link, Server,
} from 'lucide-react';
import Layout from '../Layout/Layout';
import { costsService } from '../../services/costs';
import toast from 'react-hot-toast';

// ─── helpers ──────────────────────────────────────────────────────────
const fmt2 = v => Number(v||0).toLocaleString('fr-FR', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmt0 = v => Number(v||0).toLocaleString('fr-FR', { minimumFractionDigits:0, maximumFractionDigits:0 });
const fmtDate = d => d ? new Date(d).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' }) : '—';

// Extracts a short, human-readable service name from OVH (and other) invoice rows.
function extractShortServiceName(name) {
  if (!name) return '—';
  let s = name
    .replace(/\([^)]*\)/g, '')                                      // remove (dates/ranges)
    .replace(/Date de fin d['']engagement\s*:?\s*[\d/]+/gi, '')     // remove engagement date
    .replace(/Monthly fees?/gi, '')                                  // remove "Monthly fees"
    .replace(/Sans engagement/gi, '')                               // remove "Sans engagement"
    .replace(/^\[(EUROPE|CANADA|ASIA|US)\]\s*/i, '')                // remove [EUROPE] etc.
    .replace(/rental for \d+ months?/gi, '')                        // remove rental mentions
    .replace(/for 1 month/gi, '')
    .replace(/au prorata\s*:?\s*\d+ jours?/gi, '')
    .replace(/only applicable for \d+ times?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return name.slice(0, 40);
  return s.length > 42 ? s.slice(0, 40) + '…' : s;
}

// Source badge — affiche l'origine réelle de la donnée
function SourceBadge({ source, sourceRef }) {
  const s = source || 'Manuel';

  const cfg = {
    'Fichier':   { color:'#1B5E46', bg:'#f0fdf4', icon:'📄' },
    'OVHcloud':  { color:'#00b3ff', bg:'#e0f2fe', icon:'🔷' },
    'AWS':       { color:'#f97316', bg:'#fff7ed', icon:'🟠' },
    'Azure':     { color:'#2563eb', bg:'#eff6ff', icon:'🔵' },
    'GCP':       { color:'#ef4444', bg:'#fff5f5', icon:'🔴' },
    'Manuel':    { color:'#94a3b8', bg:'#f8fafc', icon:'✏️' },
  };

  const found = Object.keys(cfg).find(k => s.toLowerCase().includes(k.toLowerCase()));
  const c = cfg[found || 'Manuel'];

  return (
    <span title={sourceRef || s} style={{
      display:'inline-flex', alignItems:'center', gap:4,
      fontSize:11, fontWeight:700, color:c.color,
      background:c.bg, padding:'3px 9px', borderRadius:99,
      cursor: sourceRef ? 'help' : 'default',
      whiteSpace:'nowrap',
    }}>
      <span style={{ fontSize:11 }}>{c.icon}</span>
      {found || s}
    </span>
  );
}

// KPI card
function KPICard({ label, value, unit='€', icon:Icon, topColor, iconBg, sub }) {
  return (
    <div style={{ background:'white', borderRadius:18, padding:'20px 22px 16px', border:'1px solid #e8edf5', position:'relative', overflow:'hidden', boxShadow:'0 2px 12px rgba(0,0,0,.06)', flex:1, minWidth:170 }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:4, background:topColor, borderRadius:'18px 18px 0 0' }}/>
      <div style={{ position:'absolute', right:-18, bottom:-18, width:90, height:90, borderRadius:'50%', background:topColor+'10' }}/>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <span style={{ fontSize:10, fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'.1em' }}>{label}</span>
        <div style={{ width:36, height:36, borderRadius:11, background:iconBg, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Icon size={17} color="white"/>
        </div>
      </div>
      <div style={{ display:'flex', alignItems:'baseline', gap:4, marginBottom:4 }}>
        <span style={{ fontSize:28, fontWeight:900, color:'#0f172a', letterSpacing:'-1px', lineHeight:1 }}>{value}</span>
        <span style={{ fontSize:14, fontWeight:700, color:'#94a3b8' }}>{unit}</span>
      </div>
      {sub && <p style={{ fontSize:11, color:'#94a3b8', position:'relative', zIndex:1 }}>{sub}</p>}
    </div>
  );
}

// Sortable column header
function SortTh({ label, field, sort, onSort }) {
  const active = sort.field === field;
  return (
    <th onClick={() => onSort(field)} style={{ padding:'11px 16px', textAlign:'left', fontSize:11, fontWeight:800, color: active?'#1B5E46':'#64748b', textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1px solid #f1f5f9', cursor:'pointer', whiteSpace:'nowrap', userSelect:'none', background:'#f8fafc' }}>
      <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
        {label}
        {active
          ? (sort.dir==='asc' ? <ChevronUp size={12}/> : <ChevronDown size={12}/>)
          : <ChevronDown size={12} style={{ opacity:.3 }}/>}
      </span>
    </th>
  );
}

// ─────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────
export default function Costs() {
  const navigate  = useNavigate();
  const [costs,   setCosts]   = useState([]);
  const [loading, setLoading] = useState(true);

  // Filtres
  const [search,     setSearch]     = useState('');
  const [filterSvc,  setFilterSvc]  = useState('');
  const [filterProj, setFilterProj] = useState('');
  const [filterSrc,  setFilterSrc]  = useState('');   // ✅ filtre par source

  // Tri
  const [sort, setSort] = useState({ field:'cost_date', dir:'desc' });

  // Edit inline
  const [editId,   setEditId]   = useState(null);
  const [editData, setEditData] = useState({});

  // ── Load ────────────────────────────────────────────────────────
  const loadCosts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await costsService.getCosts(0, 5000);
      setCosts(Array.isArray(data) ? data : []);
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error('Erreur: ' + (typeof d==='string' ? d : e.message));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadCosts(); }, [loadCosts]);

  // ── Derived lists ───────────────────────────────────────────────
  const services = useMemo(() => [...new Set(costs.map(c=>c.service_name).filter(Boolean))].sort(), [costs]);
  const projects  = useMemo(() => [...new Set(costs.map(c=>c.project_id).filter(Boolean))].sort(),  [costs]);
  const sources   = useMemo(() => [...new Set(costs.map(c=>c.source||'Manuel').filter(Boolean))].sort(), [costs]);

  // ── Filter + sort ───────────────────────────────────────────────
  const displayed = useMemo(() => {
    let list = [...costs];

    if (search)     list = list.filter(c =>
      (c.service_name||'').toLowerCase().includes(search.toLowerCase()) ||
      (c.project_id ||'').toLowerCase().includes(search.toLowerCase()) ||
      (c.team_id    ||'').toLowerCase().includes(search.toLowerCase())
    );
    if (filterSvc)  list = list.filter(c => c.service_name === filterSvc);
    if (filterProj) list = list.filter(c => c.project_id   === filterProj);
    if (filterSrc)  list = list.filter(c => (c.source||'Manuel') === filterSrc);

    list.sort((a,b) => {
      let va = a[sort.field] ?? '';
      let vb = b[sort.field] ?? '';
      if (sort.field === 'amount') { va = Number(va); vb = Number(vb); }
      if (sort.field === 'cost_date') { va = new Date(va); vb = new Date(vb); }
      if (va < vb) return sort.dir==='asc' ? -1 :  1;
      if (va > vb) return sort.dir==='asc' ?  1 : -1;
      return 0;
    });

    return list;
  }, [costs, search, filterSvc, filterProj, filterSrc, sort]);

  const handleSort = field => setSort(s => ({ field, dir: s.field===field && s.dir==='asc' ? 'desc' : 'asc' }));

  // ── Stats ───────────────────────────────────────────────────────
  const total   = displayed.reduce((s,c) => s+Number(c.amount||0), 0);
  const avg     = displayed.length ? total/displayed.length : 0;
  const maxAmt  = displayed.length ? Math.max(...displayed.map(c=>Number(c.amount||0))) : 0;
  const nbSvcs  = new Set(displayed.map(c=>c.service_name).filter(Boolean)).size;
  const nbProjs = new Set(displayed.map(c=>c.project_id).filter(Boolean)).size;

  // ── Delete ──────────────────────────────────────────────────────
  const handleDelete = async (id) => {
    if (!window.confirm('Supprimer ce coût ?')) return;
    try {
      await costsService.deleteCost(id);
      toast.success('Coût supprimé');
      setCosts(c => c.filter(x => x.id !== id));
    } catch { toast.error('Erreur suppression'); }
  };

  // ── Edit inline ─────────────────────────────────────────────────
  const startEdit = (cost) => {
    setEditId(cost.id);
    setEditData({
      service_name:  cost.service_name,
      amount:        cost.amount,
      currency:      cost.currency,
      cost_date:     cost.cost_date,
      project_id:    cost.project_id  || '',
      team_id:       cost.team_id     || '',
      cost_category: cost.cost_category || '',
    });
  };

  const saveEdit = async (id) => {
    try {
      const updated = await costsService.updateCost(id, {
        ...editData,
        amount: parseFloat(editData.amount),
      });
      toast.success('Coût mis à jour');
      setCosts(c => c.map(x => x.id===id ? { ...x, ...updated } : x));
      setEditId(null);
    } catch { toast.error('Erreur mise à jour'); }
  };

  const cancelEdit = () => setEditId(null);

  // ── Clear filters ───────────────────────────────────────────────
  const hasFilters = search || filterSvc || filterProj || filterSrc;
  const clearFilters = () => { setSearch(''); setFilterSvc(''); setFilterProj(''); setFilterSrc(''); };

  // ─── RENDER ──────────────────────────────────────────────────────
  return (
    <Layout>
      {/* ── Header ── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24, flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ fontSize:24, fontWeight:900, color:'#0f172a', letterSpacing:'-0.5px' }}>Coûts</h1>
          <p style={{ fontSize:13, color:'#64748b', marginTop:3 }}>
            Sauvez et gérez vos dépenses cloud ·{' '}
            <span style={{ fontWeight:700, color:'#1B5E46' }}>données extraites</span> depuis vos fichiers & APIs
          </p>
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={loadCosts} style={{ display:'flex', alignItems:'center', gap:7, padding:'9px 16px', background:'white', border:'1.5px solid #e2e8f0', borderRadius:11, fontWeight:600, fontSize:13, cursor:'pointer', fontFamily:'inherit', color:'#374151' }}>
            <RefreshCw size={14}/> Actualiser
          </button>
          <button onClick={() => navigate('/files')} style={{ display:'flex', alignItems:'center', gap:7, padding:'9px 18px', background:'#1B5E46', color:'white', border:'none', borderRadius:11, fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:'inherit', boxShadow:'0 4px 12px rgba(27,94,70,.25)' }}>
            <Upload size={14}/> Importer des données
          </button>
        </div>
      </div>

      {/* ── Bannière si aucune donnée ── */}
      {!loading && costs.length === 0 && (
        <div style={{ background:'#fffbeb', border:'1.5px solid #fcd34d', borderRadius:16, padding:'20px 24px', display:'flex', alignItems:'center', gap:16, marginBottom:24 }}>
          <span style={{ fontSize:28 }}>💡</span>
          <div style={{ flex:1 }}>
            <p style={{ fontSize:14, fontWeight:700, color:'#92400e', marginBottom:4 }}>Aucun coût disponible</p>
            <p style={{ fontSize:12, color:'#b45309' }}>
              Les coûts sont automatiquement extraits depuis vos fichiers (Excel, CSV, PDF) ou vos APIs cloud (OVHcloud, AWS, Azure…).
              Commencez par importer des données.
            </p>
          </div>
          <button onClick={() => navigate('/files')} style={{ display:'flex', alignItems:'center', gap:7, padding:'10px 20px', background:'#d97706', color:'white', border:'none', borderRadius:11, fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:'inherit', flexShrink:0 }}>
            <Upload size={14}/> Importer maintenant
          </button>
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div style={{ display:'flex', gap:16, flexWrap:'wrap', marginBottom:24 }}>
        <KPICard label="Coût total"  value={fmt2(total)}    topColor="#2563eb" iconBg="#3b82f6" icon={DollarSign}  sub={`${displayed.length} entrée${displayed.length!==1?'s':''}`}/>
        <KPICard label="Coût moyen"  value={fmt2(avg)}      topColor="#f97316" iconBg="#f97316" icon={BarChart2}   sub="par entrée"/>
        <KPICard label="Pic de coût" value={fmt2(maxAmt)}   topColor="#ef4444" iconBg="#ef4444" icon={TrendingUp}  sub="montant max"/>
        <KPICard label="Services"    value={nbSvcs} unit=""  topColor="#8b5cf6" iconBg="#8b5cf6" icon={Server}     sub={`${nbProjs} projet${nbProjs!==1?'s':''}`}/>
      </div>

      {/* ── Barre de filtres ── */}
      <div style={{ background:'white', borderRadius:16, padding:'16px 20px', border:'1px solid #e8edf5', boxShadow:'0 2px 8px rgba(0,0,0,.04)', marginBottom:16, display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
        {/* Search */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flex:1, minWidth:220, background:'#f8fafc', border:'1.5px solid #e2e8f0', borderRadius:10, padding:'0 12px' }}>
          <Search size={14} color="#94a3b8" style={{ flexShrink:0 }}/>
          <input
            value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Rechercher service, projet..."
            style={{ flex:1, border:'none', background:'transparent', fontSize:13, padding:'9px 0', outline:'none', fontFamily:'inherit', color:'#0f172a' }}
          />
          {search && <button onClick={()=>setSearch('')} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', padding:0, lineHeight:1 }}><X size={13}/></button>}
        </div>

        {/* Filtre service */}
        <select value={filterSvc} onChange={e=>setFilterSvc(e.target.value)} style={{ padding:'9px 14px', borderRadius:10, border:'1.5px solid #e2e8f0', fontSize:13, fontFamily:'inherit', color: filterSvc?'#0f172a':'#94a3b8', background:'white', cursor:'pointer', minWidth:160 }}>
          <option value="">Tous les services</option>
          {services.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Filtre projet */}
        <select value={filterProj} onChange={e=>setFilterProj(e.target.value)} style={{ padding:'9px 14px', borderRadius:10, border:'1.5px solid #e2e8f0', fontSize:13, fontFamily:'inherit', color: filterProj?'#0f172a':'#94a3b8', background:'white', cursor:'pointer', minWidth:160 }}>
          <option value="">Tous les projets</option>
          {projects.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        {/* ✅ Filtre source */}
        <select value={filterSrc} onChange={e=>setFilterSrc(e.target.value)} style={{ padding:'9px 14px', borderRadius:10, border:'1.5px solid #e2e8f0', fontSize:13, fontFamily:'inherit', color: filterSrc?'#0f172a':'#94a3b8', background:'white', cursor:'pointer', minWidth:150 }}>
          <option value="">Toutes les sources</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Clear + compteur */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginLeft:'auto', flexShrink:0 }}>
          {hasFilters && (
            <button onClick={clearFilters} style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, color:'#ef4444', background:'#fff5f5', border:'1px solid #fca5a5', borderRadius:8, padding:'6px 12px', cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>
              <X size={12}/> Effacer
            </button>
          )}
          <span style={{ fontSize:13, fontWeight:700, color:'#374151', whiteSpace:'nowrap' }}>
            {displayed.length} coût{displayed.length!==1?'s':''} · <span style={{ color:'#1B5E46' }}>{fmt2(total)} €</span>
          </span>
        </div>
      </div>

      {/* ── Tableau ── */}
      <div style={{ background:'white', borderRadius:20, border:'1px solid #e8edf5', boxShadow:'0 2px 12px rgba(0,0,0,.05)', overflow:'hidden' }}>
        {loading ? (
          <div style={{ padding:'60px', textAlign:'center', color:'#94a3b8' }}>
            <RefreshCw size={28} style={{ opacity:.3, margin:'0 auto 12px', display:'block' }}/>
            <p style={{ fontSize:13 }}>Chargement des coûts...</p>
          </div>
        ) : displayed.length === 0 ? (
          <div style={{ padding:'60px', textAlign:'center', color:'#94a3b8' }}>
            <FileText size={44} style={{ opacity:.2, margin:'0 auto 14px', display:'block' }}/>
            <p style={{ fontSize:15, fontWeight:700, color:'#374151', marginBottom:6 }}>Aucun coût trouvé</p>
            <p style={{ fontSize:12 }}>
              {hasFilters ? 'Aucun résultat pour ces filtres.' : 'Importez des fichiers ou connectez une API pour voir les coûts ici.'}
            </p>
            {!hasFilters && (
              <button onClick={() => navigate('/files')} style={{ marginTop:16, display:'inline-flex', alignItems:'center', gap:7, padding:'10px 20px', background:'#1B5E46', color:'white', border:'none', borderRadius:10, fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
                <Upload size={14}/> Importer des données
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', minWidth:900 }}>
              <thead>
                <tr>
                  <SortTh label="Service"   field="service_name"  sort={sort} onSort={handleSort}/>
                  <SortTh label="Montant"   field="amount"        sort={sort} onSort={handleSort}/>
                  <th style={{ padding:'11px 16px', textAlign:'left', fontSize:11, fontWeight:800, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1px solid #f1f5f9', background:'#f8fafc' }}>Devise</th>
                  <SortTh label="Date"      field="cost_date"     sort={sort} onSort={handleSort}/>
                  <SortTh label="Projet"    field="project_id"    sort={sort} onSort={handleSort}/>
                  <th style={{ padding:'11px 16px', textAlign:'left', fontSize:11, fontWeight:800, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1px solid #f1f5f9', background:'#f8fafc' }}>Équipe</th>
                  <th style={{ padding:'11px 16px', textAlign:'left', fontSize:11, fontWeight:800, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1px solid #f1f5f9', background:'#f8fafc' }}>Catégorie</th>
                  <th style={{ padding:'11px 16px', textAlign:'left', fontSize:11, fontWeight:800, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1px solid #f1f5f9', background:'#f8fafc' }}>Référence</th>
                  <th style={{ padding:'11px 16px', textAlign:'left', fontSize:11, fontWeight:800, color:'#1B5E46', textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1px solid #f1f5f9', background:'#f8fafc' }}>Source</th>
                  <th style={{ padding:'11px 16px', textAlign:'left', fontSize:11, fontWeight:800, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1px solid #f1f5f9', background:'#f8fafc' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((cost, i) => {
                  const isEdit = editId === cost.id;
                  return (
                    <tr key={cost.id}
                      style={{ borderBottom: i<displayed.length-1 ? '1px solid #f1f5f9' : 'none', transition:'background .1s', background: isEdit ? '#f0fdf4' : 'white' }}
                      onMouseEnter={e => { if(!isEdit) e.currentTarget.style.background='#fafbfc'; }}
                      onMouseLeave={e => { if(!isEdit) e.currentTarget.style.background='white'; }}
                    >
                      {/* SERVICE */}
                      <td style={{ padding:'12px 16px' }}>
                        {isEdit ? (
                          <input value={editData.service_name} onChange={e=>setEditData(d=>({...d,service_name:e.target.value}))}
                            style={{ padding:'6px 10px', borderRadius:8, border:'1.5px solid #1B5E46', fontSize:13, fontFamily:'inherit', width:110, outline:'none' }}/>
                        ) : (
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <div style={{ width:28, height:28, borderRadius:8, background:'#1B5E46'+'18', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color:'#1B5E46', flexShrink:0 }}>
                              {(cost.service_name||'?').charAt(0).toUpperCase()}
                            </div>
                            <span title={cost.service_name} style={{ fontSize:13, fontWeight:600, color:'#0f172a' }}>{extractShortServiceName(cost.service_name)}</span>
                          </div>
                        )}
                      </td>

                      {/* MONTANT */}
                      <td style={{ padding:'12px 16px' }}>
                        {isEdit ? (
                          <input type="number" value={editData.amount} onChange={e=>setEditData(d=>({...d,amount:e.target.value}))}
                            style={{ padding:'6px 10px', borderRadius:8, border:'1.5px solid #1B5E46', fontSize:13, fontFamily:'inherit', width:100, outline:'none' }}/>
                        ) : (
                          <span style={{ fontSize:14, fontWeight:800, color:'#0f172a' }}>{fmt2(cost.amount)} €</span>
                        )}
                      </td>

                      {/* DEVISE */}
                      <td style={{ padding:'12px 16px' }}>
                        <span style={{ fontSize:11, fontWeight:700, color:'#2563eb', background:'#eff6ff', padding:'3px 8px', borderRadius:6 }}>
                          {cost.currency || 'EUR'}
                        </span>
                      </td>

                      {/* DATE */}
                      <td style={{ padding:'12px 16px', fontSize:12, color:'#64748b', whiteSpace:'nowrap' }}>
                        {isEdit ? (
                          <input type="date" value={editData.cost_date} onChange={e=>setEditData(d=>({...d,cost_date:e.target.value}))}
                            style={{ padding:'6px 10px', borderRadius:8, border:'1.5px solid #1B5E46', fontSize:12, fontFamily:'inherit', outline:'none' }}/>
                        ) : fmtDate(cost.cost_date)}
                      </td>

                      {/* PROJET */}
                      <td style={{ padding:'12px 16px', fontSize:12, color:'#374151' }}>
                        {isEdit ? (
                          <input value={editData.project_id} onChange={e=>setEditData(d=>({...d,project_id:e.target.value}))}
                            style={{ padding:'6px 10px', borderRadius:8, border:'1.5px solid #1B5E46', fontSize:12, fontFamily:'inherit', width:100, outline:'none' }}/>
                        ) : (cost.project_id || <span style={{ color:'#cbd5e1' }}>—</span>)}
                      </td>

                      {/* ÉQUIPE */}
                      <td style={{ padding:'12px 16px', fontSize:12, color:'#374151' }}>
                        {cost.team_id || <span style={{ color:'#cbd5e1' }}>—</span>}
                      </td>

                      {/* CATÉGORIE */}
                      <td style={{ padding:'12px 16px', fontSize:12, color:'#374151' }}>
                        {cost.cost_category || <span style={{ color:'#cbd5e1' }}>—</span>}
                      </td>

                      {/* RÉFÉRENCE */}
                      <td style={{ padding:'12px 16px' }}>
                        {(cost.reference) ? (
                          <code title={cost.reference} style={{ fontSize:11, color:'#4b5563', background:'#f3f4f6', padding:'2px 7px', borderRadius:5, fontFamily:'monospace', whiteSpace:'nowrap', display:'inline-block', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', verticalAlign:'middle' }}>
                            {cost.reference}
                          </code>
                        ) : (
                          <span style={{ color:'#cbd5e1' }}>—</span>
                        )}
                      </td>

                      {/* ✅ SOURCE */}
                      <td style={{ padding:'12px 16px' }}>
                        <SourceBadge source={cost.source} sourceRef={cost.source_ref}/>
                      </td>

                      {/* ACTIONS */}
                      <td style={{ padding:'12px 16px' }}>
                        {isEdit ? (
                          <div style={{ display:'flex', gap:7 }}>
                            <button onClick={() => saveEdit(cost.id)} style={{ display:'flex', alignItems:'center', gap:4, padding:'6px 12px', background:'#1B5E46', color:'white', border:'none', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:700, fontFamily:'inherit' }}>
                              <Save size={12}/> Sauver
                            </button>
                            <button onClick={cancelEdit} style={{ display:'flex', alignItems:'center', gap:4, padding:'6px 10px', background:'#f1f5f9', color:'#64748b', border:'none', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit' }}>
                              <X size={12}/> Annuler
                            </button>
                          </div>
                        ) : (
                          <div style={{ display:'flex', gap:8 }}>
                            <button onClick={() => startEdit(cost)} title="Modifier" style={{ width:32, height:32, borderRadius:8, background:'#eff6ff', border:'1px solid #bfdbfe', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#2563eb' }}>
                              <Edit2 size={13}/>
                            </button>
                            <button onClick={() => handleDelete(cost.id)} title="Supprimer" style={{ width:32, height:32, borderRadius:8, background:'#fff5f5', border:'1px solid #fca5a5', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#dc2626' }}>
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
    </Layout>
  );
}