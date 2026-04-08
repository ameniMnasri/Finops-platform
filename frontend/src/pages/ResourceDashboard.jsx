import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Download, Server, Key, Eye, EyeOff,
  CheckCircle, XCircle, Cpu, MemoryStick, HardDrive,
} from 'lucide-react';
import Layout from '../components/Layout/Layout';
import ServerTable from '../components/Resources/ServerTable';
import ResourceChart from '../components/Resources/ResourceChart';
import SummaryCard from '../components/Resources/SummaryCard';
import Insights from '../components/Resources/Insights';
import { resourcesService } from '../services/resources';
import toast from 'react-hot-toast';

// ─── helpers ─────────────────────────────────────────────────────────────────
function avg(arr) {
  const valid = arr.filter(v => v != null);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}
function peak(arr) {
  const valid = arr.filter(v => v != null);
  return valid.length ? Math.max(...valid) : null;
}

// ─── Password field ───────────────────────────────────────────────────────────
function SecretField({ label, value, onChange, placeholder, hint }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 5 }}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ width: '100%', padding: '10px 36px 10px 12px', borderRadius: 10, border: '1.5px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', color: '#0f172a', background: 'white', boxSizing: 'border-box', outline: 'none' }}
          onFocus={e  => { e.target.style.borderColor = '#1B5E46'; }}
          onBlur={e   => { e.target.style.borderColor = '#e2e8f0'; }}
        />
        <button type="button" onClick={() => setShow(s => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}>
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {hint && <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{hint}</p>}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ResourceDashboard() {
  const [metrics,     setMetrics]     = useState([]);
  const [history,     setHistory]     = useState([]);
  const [selected,    setSelected]    = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [importing,   setImporting]   = useState(false);
  const [importResult,setImportResult]= useState(null);

  // OVH credentials (stored in sessionStorage for convenience — cleared when tab closes, never persisted to localStorage)
  const [appKey,      setAppKey]      = useState(() => sessionStorage.getItem('ovh_ak') || '');
  const [appSecret,   setAppSecret]   = useState('');  // Never persisted — entered each session for security
  const [consumerKey, setConsumerKey] = useState(() => sessionStorage.getItem('ovh_ck') || '');
  const [showCreds,   setShowCreds]   = useState(false);

  // Persist non-secret creds in sessionStorage (cleared on tab close). App secret is NOT persisted.
  useEffect(() => { sessionStorage.setItem('ovh_ak', appKey); },      [appKey]);
  useEffect(() => { sessionStorage.setItem('ovh_ck', consumerKey); }, [consumerKey]);

  // ── Load latest metrics from DB ──────────────────────────────────────────
  const loadMetrics = useCallback(async () => {
    try {
      setLoading(true);
      const data = await resourcesService.getLatestMetrics();
      setMetrics(Array.isArray(data) ? data : []);
    } catch (e) {
      // Silently fail if no metrics yet
      setMetrics([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMetrics(); }, [loadMetrics]);

  // ── Load history when server selected ────────────────────────────────────
  const loadHistory = useCallback(async (serverName) => {
    try {
      const data = await resourcesService.getServerHistory(serverName, 30);
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      setHistory([]);
    }
  }, []);

  const handleSelectServer = useCallback((m) => {
    setSelected(m);
    loadHistory(m.server_name);
  }, [loadHistory]);

  // ── Import OVH metrics ────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!appKey || !appSecret || !consumerKey) {
      toast.error('Veuillez saisir vos 3 clés OVH');
      setShowCreds(true);
      return;
    }
    try {
      setImporting(true);
      setImportResult(null);
      toast.loading('Import des métriques OVH...', { id: 'ovh-import' });
      const result = await resourcesService.importOVHMetrics({
        app_key: appKey,
        app_secret: appSecret,
        consumer_key: consumerKey,
      });
      setImportResult(result);
      toast.success(`✅ ${result.metrics_created} serveur${result.metrics_created !== 1 ? 's' : ''} importé${result.metrics_created !== 1 ? 's' : ''} !`, { id: 'ovh-import' });
      await loadMetrics();
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message;
      toast.error('Erreur: ' + msg, { id: 'ovh-import' });
    } finally {
      setImporting(false);
    }
  };

  // ── Computed stats ────────────────────────────────────────────────────────
  const cpus  = metrics.map(m => m.cpu_usage);
  const rams  = metrics.map(m => m.ram_usage);
  const disks = metrics.map(m => m.disk_usage);

  const avgCpu  = avg(cpus);
  const avgRam  = avg(rams);
  const avgDisk = avg(disks);
  const peakCpu  = peak(cpus);
  const peakRam  = peak(rams);
  const peakDisk = peak(disks);

  // ─────────────────────────────── RENDER ──────────────────────────────────
  return (
    <Layout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}.spin{animation:spin 1s linear infinite}`}</style>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: '#0f172a', letterSpacing: '-0.5px' }}>
            <Server size={22} style={{ verticalAlign: 'middle', marginRight: 10, color: '#1B5E46' }} />
            Resource Dashboard
          </h1>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 3 }}>
            Surveillance des ressources serveurs — VPS & Dédiés OVHcloud
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowCreds(s => !s)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 11, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: '#374151' }}
          >
            <Key size={14} /> Clés OVH
          </button>
          <button
            onClick={loadMetrics}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 11, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: '#374151' }}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Actualiser
          </button>
          <button
            onClick={handleImport}
            disabled={importing}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 20px', background: importing ? '#94a3b8' : '#1B5E46', color: 'white', border: 'none', borderRadius: 11, fontWeight: 700, fontSize: 13, cursor: importing ? 'not-allowed' : 'pointer', fontFamily: 'inherit', boxShadow: importing ? 'none' : '0 4px 14px rgba(27,94,70,.3)' }}
          >
            <Download size={14} className={importing ? 'spin' : ''} />
            {importing ? 'Import...' : 'Importer métriques OVH'}
          </button>
        </div>
      </div>

      {/* ── OVH Credentials Panel ── */}
      {showCreds && (
        <div style={{ background: 'white', borderRadius: 18, border: '1px solid #e8edf5', boxShadow: '0 2px 12px rgba(0,0,0,.05)', padding: '24px', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <span style={{ fontSize: 24 }}>🔷</span>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Clés API OVHcloud</h3>
              <p style={{ fontSize: 12, color: '#64748b' }}>Clés stockées en mémoire de session uniquement — non persistées</p>
            </div>
            <a
              href="https://eu.api.ovh.com/createToken"
              target="_blank"
              rel="noreferrer"
              style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#0284c7', color: 'white', borderRadius: 9, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}
            >
              <Key size={12} /> Créer un token
            </a>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 5 }}>Application Key</label>
              <input
                type="text"
                value={appKey}
                onChange={e => setAppKey(e.target.value)}
                placeholder="xxxxxxxxxxx"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', color: '#0f172a', background: 'white', boxSizing: 'border-box', outline: 'none' }}
                onFocus={e => { e.target.style.borderColor = '#1B5E46'; }}
                onBlur={e  => { e.target.style.borderColor = '#e2e8f0'; }}
              />
            </div>
            <SecretField label="Application Secret" value={appSecret} onChange={setAppSecret} placeholder="yyyyyyyyyyyyyyyyyyyy" />
            <SecretField label="Consumer Key" value={consumerKey} onChange={setConsumerKey} placeholder="zzzzzzzzzzzzzzzzzzzzzz" />
          </div>
          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 12 }}>
            ⚠️ Assurez-vous que votre token a accès à <code>/vps</code>, <code>/dedicated/server</code> et leurs endpoints de monitoring.
          </p>
        </div>
      )}

      {/* ── Import Result ── */}
      {importResult && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 14, padding: '16px 20px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <CheckCircle size={20} color="#16a34a" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, fontWeight: 800, color: '#15803d' }}>
              Import terminé — {importResult.total_servers} serveur{importResult.total_servers !== 1 ? 's' : ''} trouvé{importResult.total_servers !== 1 ? 's' : ''}
            </p>
            <p style={{ fontSize: 12, color: '#16a34a', marginTop: 2 }}>
              {importResult.metrics_created} enregistrement{importResult.metrics_created !== 1 ? 's' : ''} créé{importResult.metrics_created !== 1 ? 's' : ''}
              {importResult.errors?.length > 0 && ` · ${importResult.errors.length} erreur(s)`}
            </p>
          </div>
          <button onClick={() => setImportResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#16a34a', padding: 4 }}>
            <XCircle size={16} />
          </button>
        </div>
      )}

      {/* ── Summary Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 16, marginBottom: 28 }}>
        <SummaryCard type="cpu"       value={avgCpu}  sub={`${metrics.length} serveur${metrics.length !== 1 ? 's' : ''}`} />
        <SummaryCard type="ram"       value={avgRam}  sub="moyenne" />
        <SummaryCard type="disk"      value={avgDisk} sub="moyenne" />
        <SummaryCard type="peak_cpu"  value={peakCpu}  sub="maximum observé" />
        <SummaryCard type="peak_ram"  value={peakRam}  sub="maximum observé" />
        <SummaryCard type="peak_disk" value={peakDisk} sub="maximum observé" />
      </div>

      {/* ── Server Table ── */}
      <div style={{ marginBottom: 28 }}>
        <ServerTable metrics={metrics} onSelectServer={handleSelectServer} />
      </div>

      {/* ── Charts + Insights ── */}
      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: 24, marginBottom: 28 }}>
        {selected && (
          <ResourceChart history={history} serverName={selected.server_name} />
        )}
        <Insights metrics={metrics} />
      </div>

      {/* ── Empty state CTA ── */}
      {metrics.length === 0 && !loading && (
        <div style={{ background: 'white', borderRadius: 20, border: '2px dashed #cbd5e1', padding: '56px 32px', textAlign: 'center', color: '#94a3b8' }}>
          <Server size={56} style={{ opacity: .15, margin: '0 auto 16px', display: 'block' }} />
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#374151', marginBottom: 8 }}>Aucune métrique disponible</h2>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 24, maxWidth: 420, margin: '0 auto 24px' }}>
            Configurez vos clés API OVHcloud et cliquez sur <strong>Importer métriques OVH</strong> pour visualiser
            les ressources de vos serveurs VPS et dédiés.
          </p>
          <button
            onClick={() => { setShowCreds(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 28px', background: '#1B5E46', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 14px rgba(27,94,70,.3)' }}
          >
            <Key size={16} /> Configurer les clés OVH
          </button>
        </div>
      )}
    </Layout>
  );
}
