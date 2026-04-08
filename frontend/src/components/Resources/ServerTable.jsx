import React, { useState } from 'react';
import { Search, Server, Cpu, HardDrive, ChevronUp, ChevronDown } from 'lucide-react';

// ─── Status config ────────────────────────────────────────────────────────────
function getStatus(avgCpu) {
  if (avgCpu == null) return { label: 'Inconnu', color: '#94a3b8', bg: '#f8fafc', dot: '#cbd5e1' };
  if (avgCpu < 10)  return { label: 'Sous-utilisé', color: '#d97706', bg: '#fffbeb', dot: '#f59e0b' };
  if (avgCpu > 85)  return { label: 'Critique',     color: '#dc2626', bg: '#fff5f5', dot: '#ef4444' };
  return               { label: 'Optimisé',     color: '#16a34a', bg: '#f0fdf4', dot: '#22c55e' };
}

function StatusBadge({ avgCpu }) {
  const s = getStatus(avgCpu);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 11, fontWeight: 700, color: s.color,
      background: s.bg, padding: '4px 10px', borderRadius: 99,
      whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.dot, display: 'inline-block' }} />
      {s.label}
    </span>
  );
}

function UsageBar({ value, max = 100, color }) {
  const pct = value != null ? Math.min((value / max) * 100, 100) : 0;
  const barColor = value == null ? '#e2e8f0'
    : pct > 85 ? '#ef4444'
    : pct < 10 ? '#f59e0b'
    : '#22c55e';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 99, transition: 'width .3s' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#374151', minWidth: 44, textAlign: 'right' }}>
        {value != null ? `${Number(value).toFixed(1)}${color === 'cpu' ? '%' : ' GB'}` : '—'}
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ServerTable({ metrics, onSelectServer }) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('cpu_usage');
  const [sortDir, setSortDir] = useState('desc');

  const filtered = metrics
    .filter(m => m.server_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortKey] ?? -1;
      const bv = b[sortKey] ?? -1;
      return sortDir === 'asc' ? av - bv : bv - av;
    });

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ k }) => {
    if (sortKey !== k) return null;
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  };

  const TH = ({ label, k, style = {} }) => (
    <th
      onClick={() => handleSort(k)}
      style={{
        padding: '11px 16px', textAlign: 'left', fontSize: 11, fontWeight: 800,
        color: sortKey === k ? '#1B5E46' : '#64748b',
        textTransform: 'uppercase', letterSpacing: '.06em',
        borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap',
        cursor: 'pointer', background: '#f8fafc', ...style,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label} <SortIcon k={k} />
      </span>
    </th>
  );

  return (
    <div style={{ background: 'white', borderRadius: 20, border: '1px solid #e8edf5', boxShadow: '0 2px 12px rgba(0,0,0,.05)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Serveurs</h2>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{filtered.length} serveur{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ position: 'relative' }}>
          <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher un serveur..."
            style={{
              paddingLeft: 32, paddingRight: 14, paddingTop: 9, paddingBottom: 9,
              borderRadius: 11, border: '1.5px solid #e2e8f0',
              fontSize: 13, fontFamily: 'inherit', color: '#0f172a',
              outline: 'none', width: 240,
            }}
          />
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{ padding: '56px', textAlign: 'center', color: '#94a3b8' }}>
          <Server size={48} style={{ opacity: .2, margin: '0 auto 14px', display: 'block' }} />
          <p style={{ fontSize: 15, fontWeight: 700, color: '#374151' }}>Aucun serveur trouvé</p>
          <p style={{ fontSize: 12, marginTop: 5 }}>Importez vos métriques OVH pour commencer</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
            <thead>
              <tr>
                <TH label="Serveur"   k="server_name" />
                <TH label="Type"      k="server_type" />
                <TH label="CPU"       k="cpu_usage" />
                <TH label="RAM"       k="ram_usage" />
                <TH label="Disk"      k="disk_usage" />
                <TH label="Statut"    k="cpu_usage" style={{ cursor: 'default' }} />
                <th style={{ padding: '11px 16px', textAlign: 'left', fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                  Détail
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, i) => (
                <tr
                  key={m.id || m.server_name}
                  style={{ borderBottom: i < filtered.length - 1 ? '1px solid #f1f5f9' : 'none', transition: 'background .1s', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'white'}
                  onClick={() => onSelectServer?.(m)}
                >
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 10, background: m.server_type === 'vps' ? '#eff6ff' : '#f5f3ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Server size={16} color={m.server_type === 'vps' ? '#2563eb' : '#7c3aed'} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.server_name}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700,
                      color: m.server_type === 'vps' ? '#2563eb' : '#7c3aed',
                      background: m.server_type === 'vps' ? '#eff6ff' : '#f5f3ff',
                      padding: '3px 9px', borderRadius: 6, textTransform: 'uppercase',
                    }}>
                      {m.server_type === 'vps' ? 'VPS' : 'Dédié'}
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px', minWidth: 160 }}>
                    <UsageBar value={m.cpu_usage} max={100} color="cpu" />
                  </td>
                  <td style={{ padding: '14px 16px', minWidth: 160 }}>
                    <UsageBar value={m.ram_usage} max={Math.max(...metrics.map(x => x.ram_usage || 0), 1)} color="ram" />
                  </td>
                  <td style={{ padding: '14px 16px', minWidth: 160 }}>
                    <UsageBar value={m.disk_usage} max={Math.max(...metrics.map(x => x.disk_usage || 0), 1)} color="disk" />
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <StatusBadge avgCpu={m.cpu_usage} />
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <button
                      onClick={e => { e.stopPropagation(); onSelectServer?.(m); }}
                      style={{ fontSize: 12, fontWeight: 600, color: '#1B5E46', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      Historique
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
