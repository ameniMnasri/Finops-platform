// Anomalies.jsx — Tableau de bord Détection d'Anomalies (Phase 3)
import { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle, AlertCircle, CheckCircle, Zap, Activity,
  RefreshCw, Cpu, HardDrive, MemoryStick, DollarSign,
  TrendingUp, Brain, BarChart2, ChevronDown, ChevronUp, Trash2,
} from 'lucide-react';
import Layout from '../Layout/Layout';
import api from '../../services/api';
import toast from 'react-hot-toast';

// ─── Design tokens ─────────────────────────────────────────────────────────
const T = {
  green:    '#0E7A50', greenBg:  '#ECFDF5',
  blue:     '#1D4ED8', blueBg:   '#EFF6FF',
  amber:    '#B45309', amberBg:  '#FFFBEB',
  red:      '#DC2626', redBg:    '#FEF2F2',
  purple:   '#7C3AED', purpleBg: '#F5F3FF',
  slate:    '#0F172A', muted:    '#64748B',
  border:   '#E2E8F0', bg:       '#F8FAFC',
};

// ─── Severity config ────────────────────────────────────────────────────────
const SEV = {
  critical: { color: T.red,    bg: T.redBg,    icon: AlertCircle,   label: 'Critique'  },
  high:     { color: '#EA580C', bg: '#FFF7ED',  icon: AlertTriangle, label: 'Élevée'    },
  medium:   { color: T.amber,  bg: T.amberBg,  icon: AlertTriangle, label: 'Moyenne'   },
  low:      { color: T.blue,   bg: T.blueBg,   icon: CheckCircle,   label: 'Faible'    },
};

const TYPE_ICON = {
  cost_spike:     DollarSign,
  high_cpu:       Cpu,
  high_ram:       MemoryStick,
  high_disk:      HardDrive,
  resource_spike: Activity,
};

const TYPE_LABEL = {
  cost_spike:     'Pic de coût',
  high_cpu:       'CPU élevé',
  high_ram:       'RAM élevée',
  high_disk:      'Disk élevé',
  resource_spike: 'Ressource outlier',
};

const fmtDate = d => d
  ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—';

// ─── SummaryCard ────────────────────────────────────────────────────────────
function SummaryCard({ label, value, icon: Icon, color, bg }) {
  return (
    <div style={{ flex: '1 1 160px', background: 'white', border: `1px solid ${T.border}`, borderRadius: 14, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.05)', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: '14px 14px 0 0' }} />
      <div style={{ width: 42, height: 42, borderRadius: 11, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={20} color="white" />
      </div>
      <div>
        <p style={{ fontSize: 10, fontWeight: 800, color: T.muted, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 3 }}>{label}</p>
        <p style={{ fontSize: 26, fontWeight: 900, color: T.slate, lineHeight: 1 }}>{value}</p>
      </div>
    </div>
  );
}

// ─── AnomalyRow ─────────────────────────────────────────────────────────────
function AnomalyRow({ anomaly, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const sev  = SEV[anomaly.severity]  || SEV.low;
  const TIcon = TYPE_ICON[anomaly.anomaly_type] || Activity;
  const SIcon = sev.icon;

  return (
    <>
      <tr
        style={{ borderBottom: `1px solid ${T.border}`, cursor: 'pointer', transition: 'background .1s' }}
        onClick={() => setExpanded(e => !e)}
        onMouseEnter={e => e.currentTarget.style.background = '#F0FDF8'}
        onMouseLeave={e => e.currentTarget.style.background = 'white'}
      >
        {/* Severity */}
        <td style={{ padding: '12px 14px', width: 110 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: sev.bg, color: sev.color, border: `1px solid ${sev.color}44` }}>
            <SIcon size={11} /> {sev.label}
          </span>
        </td>

        {/* Type */}
        <td style={{ padding: '12px 14px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: T.slate }}>
            <TIcon size={14} color={T.muted} /> {TYPE_LABEL[anomaly.anomaly_type] || anomaly.anomaly_type}
          </span>
        </td>

        {/* Entity */}
        <td style={{ padding: '12px 14px', maxWidth: 200 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.slate, wordBreak: 'break-all' }}>
            {anomaly.entity_name.replace(/\.ovh\.net|\.vps\.ovh\.net/gi, '')}
          </span>
          <span style={{ fontSize: 10, color: '#94a3b8' }}>.ovh.net</span>
          <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
            {anomaly.entity_type === 'server' ? '🖥️ Serveur' : '💰 Service'}
          </div>
        </td>

        {/* Values */}
        <td style={{ padding: '12px 14px', textAlign: 'right' }}>
          <span style={{ fontSize: 13, fontWeight: 900, color: sev.color }}>
            {anomaly.observed_value?.toFixed(2)} <span style={{ fontSize: 11, color: T.muted, fontWeight: 400 }}>{anomaly.unit}</span>
          </span>
          {anomaly.expected_value != null && (
            <div style={{ fontSize: 10, color: T.muted }}>moy. {anomaly.expected_value?.toFixed(2)} {anomaly.unit}</div>
          )}
        </td>

        {/* Z-score or ML score */}
        <td style={{ padding: '12px 14px', textAlign: 'right' }}>
          {anomaly.z_score != null ? (
            <span style={{ fontSize: 12, fontWeight: 800, color: Math.abs(anomaly.z_score) > 3 ? T.red : T.amber }}>
              z={anomaly.z_score?.toFixed(2)}
            </span>
          ) : anomaly.anomaly_score != null ? (
            <span style={{ fontSize: 12, fontWeight: 800, color: T.purple }}>
              IF {anomaly.anomaly_score?.toFixed(4)}
            </span>
          ) : '—'}
        </td>

        {/* Method */}
        <td style={{ padding: '12px 14px' }}>
          {anomaly.method === 'statistical' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: T.blueBg, color: T.blue, border: `1px solid #93c5fd` }}>
              <BarChart2 size={10} /> Stats
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: T.purpleBg, color: T.purple, border: `1px solid #c4b5fd` }}>
              <Brain size={10} /> ML
            </span>
          )}
        </td>

        {/* Date */}
        <td style={{ padding: '12px 14px', fontSize: 11, color: T.muted }}>
          {fmtDate(anomaly.detected_at)}
        </td>

        {/* Actions */}
        <td style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              onClick={e => { e.stopPropagation(); onDelete(anomaly.id); }}
              style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid #fca5a5`, background: T.redBg, color: T.red, cursor: 'pointer', fontSize: 11 }}
              title="Supprimer"
            >
              <Trash2 size={12} />
            </button>
            {expanded ? <ChevronUp size={14} color={T.muted} /> : <ChevronDown size={14} color={T.muted} />}
          </div>
        </td>
      </tr>

      {/* Expanded description */}
      {expanded && (
        <tr style={{ background: '#FAFBFC' }}>
          <td colSpan={8} style={{ padding: '10px 20px 14px 50px', fontSize: 12, color: T.muted, borderBottom: `1px solid ${T.border}` }}>
            <strong style={{ color: T.slate }}>Détails : </strong>{anomaly.description}
            {anomaly.threshold_type && (
              <span style={{ marginLeft: 12, padding: '1px 8px', borderRadius: 4, background: T.bg, border: `1px solid ${T.border}`, fontSize: 11 }}>
                Seuil : {anomaly.threshold_type}
                {anomaly.threshold_value != null && ` (${anomaly.threshold_value?.toFixed(2)} ${anomaly.unit})`}
              </span>
            )}
            {anomaly.std_dev != null && (
              <span style={{ marginLeft: 8, fontSize: 11, color: '#94a3b8' }}>σ = {anomaly.std_dev?.toFixed(2)}</span>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function Anomalies() {
  const [anomalies, setAnomalies]   = useState([]);
  const [summary,   setSummary]     = useState(null);
  const [loading,   setLoading]     = useState(true);
  const [detecting, setDetecting]   = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [sevFilter,  setSevFilter]  = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [search,    setSearch]      = useState('');

  // Detection params
  const [params, setParams] = useState({
    window_days: 30, z_threshold: 2.5, contamination: 0.05,
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [anomRes, sumRes] = await Promise.all([
        api.get('/anomalies/', { params: { limit: 500 } }),
        api.get('/anomalies/summary'),
      ]);
      setAnomalies(Array.isArray(anomRes.data) ? anomRes.data : []);
      setSummary(sumRes.data);
    } catch (err) {
      toast.error('Erreur chargement anomalies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const runDetection = async (type) => {
    setDetecting(true);
    try {
      let endpoint, body;
      if (type === 'costs') {
        endpoint = '/anomalies/detect/costs';
        body = { window_days: params.window_days, z_threshold: params.z_threshold, save: true };
      } else if (type === 'resources') {
        endpoint = '/anomalies/detect/resources';
        body = { window_days: params.window_days, z_threshold: params.z_threshold, save: true };
      } else {
        endpoint = '/anomalies/detect/ml';
        body = { contamination: params.contamination, window_days: params.window_days, save: true };
      }
      const res = await api.post(endpoint, body);
      const count = Array.isArray(res.data) ? res.data.length : 0;
      toast.success(`${count} anomalie(s) détectée(s)`);
      await loadData();
    } catch (err) {
      const msg = err?.response?.data?.detail || 'Erreur détection';
      toast.error(msg);
    } finally {
      setDetecting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Supprimer cette anomalie ?')) return;
    try {
      await api.delete(`/anomalies/${id}`);
      toast.success('Anomalie supprimée');
      await loadData();
    } catch {
      toast.error('Erreur suppression');
    }
  };

  const handlePurge = async () => {
    if (!window.confirm('Supprimer TOUTES les anomalies ?')) return;
    try {
      const res = await api.delete('/anomalies/');
      toast.success(res.data?.message || 'Purge effectuée');
      await loadData();
    } catch {
      toast.error('Erreur purge');
    }
  };

  const filtered = useMemo(() => {
    return anomalies.filter(a => {
      if (typeFilter !== 'all' && a.anomaly_type !== typeFilter) return false;
      if (sevFilter  !== 'all' && a.severity     !== sevFilter)  return false;
      if (methodFilter !== 'all' && a.method     !== methodFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!a.entity_name.toLowerCase().includes(q) && !a.description?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [anomalies, typeFilter, sevFilter, methodFilter, search]);

  return (
    <Layout>
      <div style={{ padding: '0 32px 40px', maxWidth: 1600, margin: '0 auto', fontFamily: "'Inter', sans-serif" }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '28px 0 24px', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: T.red, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 12px ${T.red}55` }}>
              <AlertTriangle size={20} color="white" />
            </div>
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 900, color: T.slate, letterSpacing: '-0.5px' }}>Détection d'Anomalies</h1>
              <p style={{ fontSize: 13, color: T.muted }}>Pics de coût · Surconsommation CPU/RAM · Isolation Forest</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={loadData} disabled={loading} style={{ padding: '10px 18px', borderRadius: 9, background: T.bg, border: `1.5px solid ${T.border}`, color: T.slate, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
              <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Actualiser
            </button>
            <button onClick={handlePurge} style={{ padding: '10px 18px', borderRadius: 9, background: T.redBg, border: `1.5px solid #fca5a5`, color: T.red, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
              <Trash2 size={14} /> Purger tout
            </button>
          </div>
        </div>

        {/* Summary cards */}
        {summary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
            <SummaryCard label="Total"       value={summary.total}         icon={AlertTriangle} color={T.muted}   bg={T.bg}      />
            <SummaryCard label="Critique"    value={summary.critical}      icon={AlertCircle}   color={T.red}     bg={T.redBg}   />
            <SummaryCard label="Élevée"      value={summary.high}          icon={AlertTriangle} color="#EA580C"   bg="#FFF7ED"   />
            <SummaryCard label="Pics coût"   value={summary.cost_spikes}   icon={DollarSign}    color={T.amber}   bg={T.amberBg} />
            <SummaryCard label="Ressources"  value={summary.resource_high} icon={Activity}      color={T.blue}    bg={T.blueBg}  />
          </div>
        )}

        {/* Detection panel */}
        <div style={{ background: 'white', borderRadius: 14, border: `1px solid ${T.border}`, padding: '20px 24px', marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
          <h2 style={{ fontSize: 14, fontWeight: 800, color: T.slate, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={16} color={T.amber} /> Lancer une détection
          </h2>

          {/* Params row */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 700, color: T.muted }}>
              FENÊTRE (jours)
              <input type="number" min={7} max={365} value={params.window_days}
                onChange={e => setParams(p => ({ ...p, window_days: +e.target.value }))}
                style={{ width: 90, padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${T.border}`, fontSize: 13, fontFamily: 'inherit' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 700, color: T.muted }}>
              SEUIL Z-SCORE
              <input type="number" min={1} max={5} step={0.1} value={params.z_threshold}
                onChange={e => setParams(p => ({ ...p, z_threshold: +e.target.value }))}
                style={{ width: 90, padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${T.border}`, fontSize: 13, fontFamily: 'inherit' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 700, color: T.muted }}>
              ML CONTAMINATION
              <input type="number" min={0.01} max={0.5} step={0.01} value={params.contamination}
                onChange={e => setParams(p => ({ ...p, contamination: +e.target.value }))}
                style={{ width: 90, padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${T.border}`, fontSize: 13, fontFamily: 'inherit' }} />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[
              { id: 'costs',     label: '💰 Coûts (stats)',      color: T.amber,  bg: T.amberBg },
              { id: 'resources', label: '🖥️ Ressources (stats)',  color: T.blue,   bg: T.blueBg  },
              { id: 'ml',        label: '🤖 Isolation Forest',    color: T.purple, bg: T.purpleBg },
            ].map(btn => (
              <button
                key={btn.id}
                onClick={() => runDetection(btn.id)}
                disabled={detecting}
                style={{ padding: '10px 18px', borderRadius: 9, background: detecting ? T.bg : btn.bg, border: `1.5px solid ${btn.color}44`, color: detecting ? T.muted : btn.color, fontWeight: 700, fontSize: 13, cursor: detecting ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 7 }}
              >
                {detecting ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            placeholder="Rechercher un serveur ou service..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ padding: '9px 14px', borderRadius: 9, border: `1.5px solid ${T.border}`, fontSize: 13, minWidth: 260, fontFamily: 'inherit', outline: 'none' }}
          />
          {[
            { key: 'typeFilter',   setter: setTypeFilter,   val: typeFilter,   options: [['all','Tous types'],['cost_spike','Coût'],['high_cpu','CPU'],['high_ram','RAM'],['high_disk','Disk'],['resource_spike','Outlier ML']] },
            { key: 'sevFilter',    setter: setSevFilter,    val: sevFilter,    options: [['all','Toutes sévérités'],['critical','Critique'],['high','Élevée'],['medium','Moyenne'],['low','Faible']] },
            { key: 'methodFilter', setter: setMethodFilter, val: methodFilter, options: [['all','Toutes méthodes'],['statistical','Stats'],['isolation_forest','ML']] },
          ].map(f => (
            <select key={f.key} value={f.val} onChange={e => f.setter(e.target.value)}
              style={{ padding: '9px 12px', borderRadius: 9, border: `1.5px solid ${T.border}`, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', background: 'white' }}>
              {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: T.muted, padding: '6px 12px', borderRadius: 8, background: T.bg, border: `1px solid ${T.border}` }}>
            {filtered.length} anomalie{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Table */}
        <div style={{ background: 'white', borderRadius: 14, border: `1px solid ${T.border}`, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: T.bg, borderBottom: `2px solid ${T.border}` }}>
                {['Sévérité', 'Type', 'Entité', 'Valeur observée', 'Score', 'Méthode', 'Détecté le', ''].map(h => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: h === 'Valeur observée' || h === 'Score' ? 'right' : 'left', fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.08em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>
                  <RefreshCw size={28} style={{ margin: '0 auto 12px', display: 'block', animation: 'spin 1s linear infinite', opacity: 0.3 }} />
                  <p>Chargement...</p>
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>
                  <CheckCircle size={48} style={{ margin: '0 auto 16px', display: 'block', opacity: 0.15 }} />
                  <p style={{ fontWeight: 700, fontSize: 14, color: '#374151' }}>Aucune anomalie détectée</p>
                  <p style={{ fontSize: 12, marginTop: 4 }}>Lancez une détection pour commencer l'analyse</p>
                </td></tr>
              )}
              {!loading && filtered.map(a => (
                <AnomalyRow key={a.id} anomaly={a} onDelete={handleDelete} />
              ))}
            </tbody>
          </table>
        </div>

        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
      </div>
    </Layout>
  );
}