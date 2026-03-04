import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Upload, Link, FileText, CheckCircle, XCircle, Clock,
  Trash2, Play, RefreshCw, Info, Zap, Key, Globe,
  ChevronDown, ChevronRight, Eye, EyeOff,
} from 'lucide-react';
import Layout from '../Layout/Layout';
import { filesService } from '../../services/files';
import api from '../../services/api';
import toast from 'react-hot-toast';

// ─── helpers ──────────────────────────────────────────────────────────
const fmtSize = b =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`;
const fmtDate = d =>
  d ? new Date(d).toLocaleString('fr-FR', { dateStyle:'short', timeStyle:'short' }) : '—';

const STATUS_CFG = {
  PENDING:  { label:'En attente', color:'#f59e0b', bg:'#fffbeb', icon:Clock       },
  PARSING:  { label:'En cours',   color:'#2563eb', bg:'#eff6ff', icon:RefreshCw   },
  SUCCESS:  { label:'Succès',     color:'#16a34a', bg:'#f0fdf4', icon:CheckCircle },
  FAILED:   { label:'Échec',      color:'#dc2626', bg:'#fff5f5', icon:XCircle     },
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
      { label: 'Factures',              value: 'https://eu.api.ovh.com/1.0/me/bill'                                },
      { label: 'Public Cloud Budget',   value: 'https://eu.api.ovh.com/1.0/cloud/project/{projectId}/bill'        },
      { label: 'Public Cloud Usage',    value: 'https://eu.api.ovh.com/1.0/cloud/project/{projectId}/usage/current' },
      { label: 'Consommation totale',   value: 'https://eu.api.ovh.com/1.0/me/consumption'                        },
    ],
    fields: [
      { key:'app_key',      label:'Application Key',    type:'text',     placeholder:'xxxxxxxxxxx',             hint:'Générer sur eu.api.ovh.com/createToken' },
      { key:'app_secret',   label:'Application Secret', type:'password', placeholder:'yyyyyyyyyyyyyyyyyyyy',     hint:'' },
      { key:'consumer_key', label:'Consumer Key',       type:'password', placeholder:'zzzzzzzzzzzzzzzzzzzzzz',  hint:'' },
      { key:'project_id',   label:'Project ID (Cloud)', type:'text',     placeholder:'abc123def456...',          hint:'Optionnel — requis pour endpoints Public Cloud' },
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
      { key:'access_key', label:'Access Key ID',     type:'text',     placeholder:'AKIAIOSFODNN7EXAMPLE', hint:'' },
      { key:'secret_key', label:'Secret Access Key', type:'password', placeholder:'wJalrXUtnFEMI/K7...',  hint:'' },
      { key:'region',     label:'Région',            type:'text',     placeholder:'eu-west-1',             hint:'' },
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
      { key:'subscription_id', label:'Subscription ID', type:'text',     placeholder:'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', hint:'' },
      { key:'tenant_id',       label:'Tenant ID',       type:'text',     placeholder:'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', hint:'' },
      { key:'client_id',       label:'Client ID',       type:'text',     placeholder:'xxxxxxxx-xxxx-...',                    hint:'' },
      { key:'client_secret',   label:'Client Secret',   type:'password', placeholder:'votre_secret',                         hint:'' },
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
      { key:'project_id', label:'Project ID', type:'text',     placeholder:'my-gcp-project', hint:'' },
      { key:'api_key',    label:'API Key',     type:'password', placeholder:'AIzaSy...',       hint:'' },
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
      { key:'auth_header', label:'Header Auth', type:'text',     placeholder:'Authorization',      hint:'' },
      { key:'auth_value',  label:'Valeur Auth',  type:'password', placeholder:'Bearer token123...', hint:'' },
    ],
  },
];

// ─── StatusBadge ──────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const c    = STATUS_CFG[status] || STATUS_CFG.PENDING;
  const Icon = c.icon;
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:11, fontWeight:700, color:c.color, background:c.bg, padding:'3px 10px', borderRadius:99 }}>
      <Icon size={11}/> {c.label}
    </span>
  );
}

// ─── Tab button ───────────────────────────────────────────────────────
function Tab({ active, onClick, icon:Icon, label, color='#1B5E46' }) {
  return (
    <button onClick={onClick} style={{
      display:'flex', alignItems:'center', gap:8,
      padding:'14px 28px', border:'none',
      borderBottom: active ? `3px solid ${color}` : '3px solid transparent',
      background:'none', cursor:'pointer', fontFamily:'inherit',
      fontSize:14, fontWeight:active?800:500,
      color:active?color:'#94a3b8', transition:'all .15s',
    }}>
      <Icon size={16}/> {label}
    </button>
  );
}

// ─── Password field with show/hide ────────────────────────────────────
function Field({ label, value, onChange, type='text', placeholder, hint }) {
  const [show, setShow] = useState(false);
  const isPass = type === 'password';
  return (
    <div>
      <label style={{ fontSize:12, fontWeight:700, color:'#374151', display:'block', marginBottom:5 }}>
        {label}
      </label>
      <div style={{ position:'relative' }}>
        <input
          type={isPass && !show ? 'password' : 'text'}
          value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            width:'100%', padding:`10px ${isPass?'38px':'12px'} 10px 12px`,
            borderRadius:10, border:'1.5px solid #e2e8f0',
            fontSize:13, fontFamily:'inherit', color:'#0f172a',
            background:'white', boxSizing:'border-box', outline:'none',
            transition:'border-color .15s',
          }}
          onFocus={e  => { e.target.style.borderColor = '#1B5E46'; }}
          onBlur={e   => { e.target.style.borderColor = '#e2e8f0'; }}
        />
        {isPass && (
          <button onClick={() => setShow(s => !s)} type="button" style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94a3b8', padding:0, lineHeight:1 }}>
            {show ? <EyeOff size={15}/> : <Eye size={15}/>}
          </button>
        )}
      </div>
      {hint && <p style={{ fontSize:11, color:'#94a3b8', marginTop:4 }}>{hint}</p>}
    </div>
  );
}

// ─── Preset card ─────────────────────────────────────────────────────
function PresetCard({ preset, selected, onClick }) {
  return (
    <button onClick={onClick} style={{
      display:'flex', alignItems:'center', gap:12,
      padding:'14px 18px', borderRadius:14,
      border:`2px solid ${selected ? preset.color : '#e2e8f0'}`,
      background: selected ? preset.color + '10' : 'white',
      cursor:'pointer', fontFamily:'inherit', textAlign:'left',
      transition:'all .15s', flex:1, minWidth:130,
      boxShadow: selected ? `0 0 0 3px ${preset.color}22` : 'none',
    }}>
      <span style={{ fontSize:26, lineHeight:1 }}>{preset.icon}</span>
      <div style={{ flex:1, minWidth:0 }}>
        <p style={{ fontSize:13, fontWeight:700, color:selected?preset.color:'#374151', marginBottom:2 }}>
          {preset.name}
        </p>
        <p style={{ fontSize:10, color:'#94a3b8' }}>
          {preset.authType === 'ovh_keys' ? 'App Key + Secret + Consumer'
            : preset.authType === 'aws_keys' ? 'Access Keys'
            : preset.authType === 'bearer'   ? 'OAuth 2.0'
            : preset.authType === 'api_key'  ? 'API Key'
            : 'Custom Headers'}
        </p>
      </div>
      {selected && (
        <CheckCircle size={16} color={preset.color} style={{ flexShrink:0 }}/>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────��──────────────────────────────────────────────
export default function Files() {
  const [tab,       setTab]       = useState('file');
  const [files,     setFiles]     = useState([]);
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

  const preset = API_PRESETS.find(p => p.id === selectedPreset);

  // ── Load files ──────────────────────────────────────────────────
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

  useEffect(() => { loadFiles(); }, [loadFiles]);

  // ── Upload file ─────────────────────────────────────────────────
  const handleUpload = async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx','xls','csv','pdf'].includes(ext)) {
      toast.error(`Format non supporté : .${ext}`); return;
    }
    try {
      setUploading(true);
      toast.loading('Upload en cours...', { id:'upload' });
      const res = await filesService.uploadFile(file);
      toast.success(`✅ "${res.filename}" uploadé !`, { id:'upload' });
      await loadFiles();
    } catch (e) {
      toast.error('Erreur: ' + (e?.response?.data?.detail || e.message), { id:'upload' });
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = e => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]);
  };

  // ── Parse file ──────────────────────────────────────────────────
  const handleParse = async (id) => {
    try {
      setParsing(p => ({ ...p, [id]:true }));
      toast.loading('Parsing...', { id:`parse-${id}` });
      const res = await filesService.parseFile(id);
      toast.success(`✅ ${res.costs_created} coûts importés`, { id:`parse-${id}` });
      await loadFiles();
    } catch {
      toast.error('Erreur parsing', { id:`parse-${id}` });
    } finally {
      setParsing(p => ({ ...p, [id]:false }));
    }
  };

  // ── Delete file ─────────────────────────────────────────────────
  const handleDelete = async (id, name) => {
    if (!window.confirm(`Supprimer "${name}" ?`)) return;
    try {
      await filesService.deleteFile(id);
      toast.success('Fichier supprimé');
      setFiles(f => f.filter(x => x.id !== id));
    } catch {
      toast.error('Erreur suppression');
    }
  };

  // ── Switch preset ───────────────────────────────────────────────
  const switchPreset = (id) => {
    const p = API_PRESETS.find(x => x.id === id);
    setSelectedPreset(id);
    setApiFields({});
    setApiUrl(p?.endpoints?.[0]?.value || p?.urlPlaceholder || '');
    setTestResult(null);
    setImportResult(null);
  };

  // ── Build payload ───────────────────────────────────────────────
  const buildPayload = () => {
    let parsedHeaders = {};
    try { if (extraHeaders.trim()) parsedHeaders = JSON.parse(extraHeaders); } catch {}
    return {
      source_id:     selectedPreset,
      source_name:   preset.name,
      url:           apiUrl,
      method:        httpMethod,
      auth_type:     preset.authType,
      auth_fields:   apiFields,
      start_date:    startDate,
      end_date:      endDate,
      extra_headers: parsedHeaders,
    };
  };

  // ── Test connexion ──────────────────────────────────────────────
  const handleTest = async () => {
    if (!apiUrl) { toast.error('URL requise'); return; }
    try {
      setTesting(true); setTestResult(null);
      toast.loading('Test de connexion...', { id:'test' });
      const res = await api.post('/files/api-test', buildPayload());
      setTestResult({ success:true, status:res.data.status, records:res.data.records_found, message:res.data.message });
      toast.success('Connexion réussie !', { id:'test' });
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message;
      setTestResult({ success:false, message:msg });
      toast.error('Connexion échouée', { id:'test' });
    } finally {
      setTesting(false);
    }
  };

  // ── Import via API ──────────────────────────────────────────────
  const handleApiImport = async () => {
    if (!apiUrl) { toast.error('URL requise'); return; }
    try {
      setImporting(true); setImportResult(null);
      toast.loading('Import en cours...', { id:'api-import' });
      const res = await api.post('/files/import-api', buildPayload());
      setImportResult(res.data);
      toast.success(`✅ ${res.data.costs_created} coûts importés !`, { id:'api-import' });
      await loadFiles();
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message;
      toast.error('Erreur: ' + msg, { id:'api-import' });
    } finally {
      setImporting(false);
    }
  };

  // ─── RENDER ────────────────────────────────────────────────────
  return (
    <Layout>
      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .spin { animation: spin 1s linear infinite; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:28, flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ fontSize:24, fontWeight:900, color:'#0f172a', letterSpacing:'-0.5px' }}>Importer des données</h1>
          <p style={{ fontSize:13, color:'#64748b', marginTop:3 }}>Upload de fichiers ou connexion directe à une API cloud</p>
        </div>
        <button onClick={loadFiles} style={{ display:'flex', alignItems:'center', gap:7, padding:'9px 18px', background:'white', border:'1.5px solid #e2e8f0', borderRadius:11, fontWeight:600, fontSize:13, cursor:'pointer', fontFamily:'inherit', color:'#374151' }}>
          <RefreshCw size={14}/> Actualiser
        </button>
      </div>

      {/* ── Card principale ── */}
      <div style={{ background:'white', borderRadius:20, border:'1px solid #e8edf5', boxShadow:'0 2px 12px rgba(0,0,0,.05)', overflow:'hidden', marginBottom:24 }}>

        {/* Onglets */}
        <div style={{ display:'flex', borderBottom:'1px solid #e8edf5', paddingLeft:8 }}>
          <Tab active={tab==='file'} onClick={()=>setTab('file')} icon={Upload} label="Upload fichier" color="#1B5E46"/>
          <Tab active={tab==='api'}  onClick={()=>setTab('api')}  icon={Link}   label="Connexion API"  color="#00b3ff"/>
        </div>

        {/* ════════════ ONGLET FICHIER ════════════ */}
        {tab === 'file' && (
          <div style={{ padding:'32px 32px 28px' }}>
            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border:`2.5px dashed ${dragging?'#1B5E46':'#cbd5e1'}`,
                borderRadius:18, padding:'56px 24px', textAlign:'center',
                cursor:'pointer', background:dragging?'#f0fdf4':'#fafbfc',
                transition:'all .2s', marginBottom:24,
              }}
            >
              <div style={{ width:68, height:68, borderRadius:20, background:dragging?'#1B5E46':'#f1f5f9', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 18px', transition:'all .2s' }}>
                <Upload size={30} color={dragging?'white':'#94a3b8'}/>
              </div>
              <p style={{ fontSize:17, fontWeight:700, color:dragging?'#1B5E46':'#374151', marginBottom:8 }}>
                {uploading ? '⏳ Upload en cours...' : dragging ? '📂 Déposez ici !' : 'Glissez-déposez un fichier'}
              </p>
              <p style={{ fontSize:12, color:'#94a3b8', marginBottom:20 }}>ou cliquez pour parcourir</p>
              <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
                {[{ e:'xlsx / xls', i:'📊', l:'Excel' }, { e:'csv', i:'📋', l:'CSV' }, { e:'pdf', i:'📄', l:'PDF' }].map(f => (
                  <span key={f.e} style={{ fontSize:12, fontWeight:600, color:'#64748b', background:'white', border:'1px solid #e2e8f0', borderRadius:9, padding:'5px 14px', display:'flex', alignItems:'center', gap:5 }}>
                    {f.i} {f.l} <span style={{ color:'#cbd5e1', fontWeight:400 }}>({f.e})</span>
                  </span>
                ))}
              </div>
              <p style={{ fontSize:11, color:'#cbd5e1', marginTop:14 }}>Taille max : 50 MB</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf" style={{ display:'none' }}
                onChange={e => { if (e.target.files[0]) handleUpload(e.target.files[0]); e.target.value=''; }}/>
            </div>
          </div>
        )}

        {/* ════════════ ONGLET API ════════════ */}
        {tab === 'api' && (
          <div style={{ padding:'28px 32px 28px' }}>

            {/* Bannière info */}
            <div style={{ background:'#e0f2fe', border:'1px solid #7dd3fc', borderRadius:14, padding:'14px 18px', display:'flex', gap:12, marginBottom:28 }}>
              <Globe size={18} color="#0284c7" style={{ flexShrink:0, marginTop:1 }}/>
              <div>
                <p style={{ fontSize:13, fontWeight:700, color:'#0369a1', marginBottom:3 }}>
                  Connexion directe à votre API cloud
                </p>
                <p style={{ fontSize:12, color:'#0284c7', lineHeight:1.6 }}>
                  Connectez votre plateforme FinOps à OVHcloud, AWS, Azure, GCP ou toute API REST.
                  Le système récupère vos coûts directement depuis la source.
                </p>
              </div>
            </div>

            {/* ── Étape 1 : Source ── */}
            <div style={{ marginBottom:28 }}>
              <StepLabel num="1" text="Choisir la source"/>
              <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                {API_PRESETS.map(p => (
                  <PresetCard key={p.id} preset={p} selected={selectedPreset===p.id} onClick={() => switchPreset(p.id)}/>
                ))}
              </div>
            </div>

            {/* ── Étape 2 : Config ── */}
            <div style={{ marginBottom:28 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                <StepLabel num="2" text="Configurer la connexion"/>
                {preset?.docsUrl && (
                  <a href={preset.docsUrl} target="_blank" rel="noreferrer"
                    style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, color:'#2563eb', fontWeight:600, textDecoration:'none' }}>
                    <Info size={13}/> Documentation
                  </a>
                )}
              </div>

              <div style={{ background:'#f8fafc', borderRadius:16, padding:'22px', border:'1px solid #e2e8f0' }}>

                {/* Description */}
                {preset?.description && (
                  <p style={{ fontSize:12, color:'#64748b', marginBottom:18, padding:'9px 13px', background:'white', borderRadius:9, border:'1px solid #e2e8f0', display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:16 }}>{preset.icon}</span> {preset.description}
                  </p>
                )}

                {/* Endpoints cliquables */}
                {preset?.endpoints?.length > 0 && (
                  <div style={{ marginBottom:18 }}>
                    <label style={{ fontSize:12, fontWeight:700, color:'#374151', display:'block', marginBottom:8 }}>
                      Endpoints disponibles
                    </label>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                      {preset.endpoints.map(ep => {
                        const isActive = apiUrl === ep.value;
                        return (
                          <button key={ep.value} onClick={() => setApiUrl(ep.value)} style={{
                            padding:'7px 14px', borderRadius:9, fontFamily:'inherit',
                            border:`1.5px solid ${isActive ? preset.color : '#e2e8f0'}`,
                            background: isActive ? preset.color+'12' : 'white',
                            color: isActive ? preset.color : '#374151',
                            fontSize:12, fontWeight:600, cursor:'pointer', transition:'all .15s',
                          }}>
                            {isActive && '✓ '}{ep.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* URL + méthode */}
                <div style={{ marginBottom:18 }}>
                  <label style={{ fontSize:12, fontWeight:700, color:'#374151', display:'block', marginBottom:6 }}>
                    URL de l'API <span style={{ color:'#ef4444' }}>*</span>
                  </label>
                  <div style={{ display:'flex', gap:8 }}>
                    <select value={httpMethod} onChange={e => setHttpMethod(e.target.value)} style={{ padding:'10px 12px', borderRadius:10, border:'1.5px solid #e2e8f0', fontSize:13, fontFamily:'inherit', color:'#374151', background:'white', cursor:'pointer', flexShrink:0 }}>
                      <option>GET</option>
                      <option>POST</option>
                    </select>
                    <input
                      value={apiUrl} onChange={e => setApiUrl(e.target.value)}
                      placeholder={preset?.urlPlaceholder || 'https://...'}
                      style={{ flex:1, padding:'10px 14px', borderRadius:10, border:`1.5px solid ${apiUrl?preset?.color||'#1B5E46':'#e2e8f0'}`, fontSize:13, fontFamily:'inherit', color:'#0f172a', background:'white', outline:'none', transition:'border-color .15s' }}
                    />
                  </div>
                </div>

                {/* Champs auth */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(240px,1fr))', gap:14, marginBottom:14 }}>
                  {preset?.fields.map(f => (
                    <Field
                      key={f.key} label={f.label} type={f.type}
                      placeholder={f.placeholder} hint={f.hint}
                      value={apiFields[f.key]||''}
                      onChange={v => setApiFields(prev => ({ ...prev, [f.key]:v }))}
                    />
                  ))}
                </div>

                {/* Bandeau OVH token */}
                {selectedPreset === 'ovh' && (
                  <div style={{ padding:'12px 16px', background:'#e0f2fe', borderRadius:11, border:'1px solid #7dd3fc', display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
                    <span style={{ fontSize:22 }}>🔷</span>
                    <div style={{ flex:1 }}>
                      <p style={{ fontSize:12, fontWeight:700, color:'#0369a1', marginBottom:2 }}>
                        Générer vos clés OVHcloud
                      </p>
                      <p style={{ fontSize:11, color:'#0284c7' }}>
                        Application Key, Application Secret et Consumer Key nécessaires.
                      </p>
                    </div>
                    <a href="https://eu.api.ovh.com/createToken" target="_blank" rel="noreferrer"
                      style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', background:'#0284c7', color:'white', borderRadius:9, fontSize:12, fontWeight:700, textDecoration:'none', flexShrink:0, whiteSpace:'nowrap' }}>
                      <Key size={13}/> Créer un token
                    </a>
                  </div>
                )}

                {/* Options avancées */}
                <button onClick={() => setShowAdvanced(s => !s)} style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer', fontSize:12, color:'#64748b', fontFamily:'inherit', fontWeight:600, padding:0 }}>
                  {showAdvanced ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                  Options avancées (dates, headers)
                </button>
                {showAdvanced && (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginTop:14 }}>
                    <div>
                      <label style={{ fontSize:12, fontWeight:700, color:'#374151', display:'block', marginBottom:5 }}>Date début</label>
                      <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                        style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:'1.5px solid #e2e8f0', fontSize:13, fontFamily:'inherit', color:'#0f172a', boxSizing:'border-box' }}/>
                    </div>
                    <div>
                      <label style={{ fontSize:12, fontWeight:700, color:'#374151', display:'block', marginBottom:5 }}>Date fin</label>
                      <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                        style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:'1.5px solid #e2e8f0', fontSize:13, fontFamily:'inherit', color:'#0f172a', boxSizing:'border-box' }}/>
                    </div>
                    <div style={{ gridColumn:'1/-1' }}>
                      <label style={{ fontSize:12, fontWeight:700, color:'#374151', display:'block', marginBottom:5 }}>
                        Headers additionnels (JSON)
                      </label>
                      <input value={extraHeaders} onChange={e => setExtraHeaders(e.target.value)}
                        placeholder='{"X-Custom-Header": "value"}'
                        style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:'1.5px solid #e2e8f0', fontSize:12, fontFamily:'monospace', color:'#0f172a', boxSizing:'border-box', outline:'none' }}/>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Étape 3 : Test + Import ── */}
            <div style={{ marginBottom:20 }}>
              <StepLabel num="3" text="Tester & Importer"/>
              <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>

                {/* Bouton Test */}
                <button onClick={handleTest} disabled={testing||!apiUrl} style={{
                  display:'flex', alignItems:'center', gap:8, padding:'12px 24px',
                  background: testing||!apiUrl ? '#f1f5f9' : 'white',
                  color:      testing||!apiUrl ? '#94a3b8' : '#1B5E46',
                  border:`1.5px solid ${testing||!apiUrl ? '#e2e8f0' : '#1B5E46'}`,
                  borderRadius:12, fontWeight:700, fontSize:14,
                  cursor:testing||!apiUrl?'not-allowed':'pointer',
                  fontFamily:'inherit', transition:'all .15s',
                }}>
                  <Zap size={16} className={testing?'spin':''} color={testing||!apiUrl?'#94a3b8':'#1B5E46'}/>
                  {testing ? 'Test en cours...' : 'Tester la connexion'}
                </button>

                {/* Bouton Import */}
                <button onClick={handleApiImport} disabled={importing||!apiUrl} style={{
                  display:'flex', alignItems:'center', gap:8, padding:'12px 28px',
                  background: importing||!apiUrl ? '#94a3b8' : '#00b3ff',
                  color:'white', border:'none', borderRadius:12,
                  fontWeight:700, fontSize:14,
                  cursor:importing||!apiUrl?'not-allowed':'pointer',
                  fontFamily:'inherit',
                  boxShadow:importing||!apiUrl?'none':'0 4px 14px rgba(0,179,255,.3)',
                  transition:'all .15s',
                }}>
                  <Link size={16} className={importing?'spin':''}/>
                  {importing ? 'Import en cours...' : 'Importer les données'}
                </button>
              </div>
            </div>

            {/* Résultat test */}
            {testResult && (
              <div style={{
                background: testResult.success?'#f0fdf4':'#fff5f5',
                border:`1px solid ${testResult.success?'#86efac':'#fca5a5'}`,
                borderRadius:14, padding:'16px 20px', marginBottom:16,
                display:'flex', alignItems:'flex-start', gap:12,
              }}>
                {testResult.success
                  ? <CheckCircle size={20} color="#16a34a" style={{ flexShrink:0 }}/>
                  : <XCircle    size={20} color="#dc2626" style={{ flexShrink:0 }}/>}
                <div>
                  <p style={{ fontSize:13, fontWeight:700, color:testResult.success?'#15803d':'#991b1b', marginBottom:4 }}>
                    {testResult.success ? '✅ Connexion réussie' : '❌ Connexion échouée'}
                  </p>
                  <p style={{ fontSize:12, color:testResult.success?'#16a34a':'#dc2626' }}>{testResult.message}</p>
                  {testResult.records !== undefined && (
                    <p style={{ fontSize:12, color:'#64748b', marginTop:4 }}>
                      🔍 <strong>{testResult.records}</strong> enregistrements trouvés
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Résultat import */}
            {importResult && (
              <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:14, padding:'18px 20px' }}>
                <p style={{ fontSize:14, fontWeight:800, color:'#15803d', marginBottom:14, display:'flex', alignItems:'center', gap:8 }}>
                  <CheckCircle size={18} color="#16a34a"/>
                  Import terminé — {importResult.source_name}
                </p>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:importResult.errors?.length?14:0 }}>
                  {[
                    { label:'Récupérés',  value:importResult.total_sent,   color:'#374151' },
                    { label:'Importés',   value:importResult.costs_created, color:'#16a34a' },
                    { label:'Ignorés',    value:importResult.costs_skipped, color:importResult.costs_skipped>0?'#d97706':'#94a3b8' },
                  ].map(s => (
                    <div key={s.label} style={{ background:'white', borderRadius:10, padding:'12px', textAlign:'center', border:'1px solid #dcfce7' }}>
                      <p style={{ fontSize:26, fontWeight:900, color:s.color, lineHeight:1 }}>{s.value}</p>
                      <p style={{ fontSize:11, color:'#94a3b8', fontWeight:600, marginTop:4 }}>{s.label}</p>
                    </div>
                  ))}
                </div>
                {importResult.errors?.length > 0 && (
                  <div style={{ background:'#fff7ed', borderRadius:10, padding:'10px 14px', border:'1px solid #fed7aa' }}>
                    <p style={{ fontSize:12, fontWeight:700, color:'#c2410c', marginBottom:6 }}>
                      ⚠️ {importResult.errors.length} erreur(s)
                    </p>
                    {importResult.errors.map((e,i) => (
                      <p key={i} style={{ fontSize:11, color:'#7c2d12', marginBottom:2 }}>• {e}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ════════════ LISTE FICHIERS ════════════ */}
      <div style={{ background:'white', borderRadius:20, border:'1px solid #e8edf5', boxShadow:'0 2px 12px rgba(0,0,0,.05)', overflow:'hidden' }}>
        <div style={{ padding:'20px 24px 16px', borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <h2 style={{ fontSize:16, fontWeight:800, color:'#0f172a' }}>Fichiers importés</h2>
            <p style={{ fontSize:12, color:'#94a3b8', marginTop:2 }}>{files.length} fichier{files.length!==1?'s':''}</p>
          </div>
        </div>

        {loading ? (
          <div style={{ padding:'48px', textAlign:'center', color:'#94a3b8' }}>
            <RefreshCw size={28} style={{ opacity:.3, margin:'0 auto 10px', display:'block' }} className="spin"/>
            <p style={{ fontSize:13 }}>Chargement...</p>
          </div>
        ) : files.length === 0 ? (
          <div style={{ padding:'56px', textAlign:'center', color:'#94a3b8' }}>
            <FileText size={48} style={{ opacity:.2, margin:'0 auto 14px', display:'block' }}/>
            <p style={{ fontSize:15, fontWeight:700, color:'#374151' }}>Aucun fichier importé</p>
            <p style={{ fontSize:12, marginTop:5 }}>Uploadez un fichier ou connectez une API cloud</p>
          </div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', minWidth:700 }}>
              <thead>
                <tr style={{ background:'#f8fafc' }}>
                  {['Fichier','Format','Taille','Statut','Date','Actions'].map(h => (
                    <th key={h} style={{ padding:'11px 16px', textAlign:'left', fontSize:11, fontWeight:800, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1px solid #f1f5f9', whiteSpace:'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {files.map((f, i) => (
                  <tr key={f.id}
                    style={{ borderBottom: i<files.length-1?'1px solid #f1f5f9':'none', transition:'background .1s' }}
                    onMouseEnter={e => e.currentTarget.style.background='#fafbfc'}
                    onMouseLeave={e => e.currentTarget.style.background='white'}
                  >
                    <td style={{ padding:'13px 16px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                        <div style={{ width:34, height:34, borderRadius:9, background:'#eff6ff', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                          <FileText size={16} color="#2563eb"/>
                        </div>
                        <span style={{ fontSize:13, fontWeight:600, color:'#0f172a', maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {f.filename}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding:'13px 16px' }}>
                      <span style={{ fontSize:11, fontWeight:700, color:'#2563eb', background:'#eff6ff', padding:'3px 8px', borderRadius:6, textTransform:'uppercase' }}>
                        {f.file_format}
                      </span>
                    </td>
                    <td style={{ padding:'13px 16px', fontSize:12, color:'#64748b', whiteSpace:'nowrap' }}>
                      {fmtSize(f.file_size_bytes)}
                    </td>
                    <td style={{ padding:'13px 16px' }}>
                      <StatusBadge status={f.parse_status}/>
                    </td>
                    <td style={{ padding:'13px 16px', fontSize:12, color:'#64748b', whiteSpace:'nowrap' }}>
                      {fmtDate(f.created_at)}
                    </td>
                    <td style={{ padding:'13px 16px' }}>
                      <div style={{ display:'flex', gap:8 }}>
                        {f.parse_status !== 'SUCCESS' && (
                          <button onClick={() => handleParse(f.id)} disabled={!!parsing[f.id]} style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, cursor:parsing[f.id]?'not-allowed':'pointer', fontSize:12, fontWeight:600, color:'#16a34a', fontFamily:'inherit', opacity:parsing[f.id]?.6:1 }}>
                            {parsing[f.id]
                              ? <RefreshCw size={12} className="spin"/>
                              : <Play size={12}/>}
                            {parsing[f.id] ? 'Parsing...' : 'Parser'}
                          </button>
                        )}
                        <button onClick={() => handleDelete(f.id, f.filename)} style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', background:'#fff5f5', border:'1px solid #fca5a5', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:600, color:'#dc2626', fontFamily:'inherit' }}>
                          <Trash2 size={12}/> Suppr.
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}

// ─── StepLabel helper ─────────────────────────────────────────────────
function StepLabel({ num, text }) {
  return (
    <p style={{ fontSize:13, fontWeight:800, color:'#0f172a', marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
      <span style={{ width:24, height:24, borderRadius:99, background:'#1B5E46', color:'white', fontSize:12, fontWeight:900, display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        {num}
      </span>
      {text}
    </p>
  );
}