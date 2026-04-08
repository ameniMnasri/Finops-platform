import React, { useState } from 'react';
import { Server, Cpu, MemoryStick, HardDrive, ChevronUp, ChevronDown } from 'lucide-react';

const fmt2 = v =>
  Number(v || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function CpuBar({ value, peak }) {
  const color = value < 10 ? '#f59e0b' : value > 85 ? '#dc2626' : '#16a34a';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 120 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ fontWeight: 700, color }}>{value.toFixed(1)}%</span>
        <span style={{ color: '#94a3b8', fontSize: 11 }}>pic {peak.toFixed(1)}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: '#f1f5f9', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 99,
          width: `${Math.min(value, 100)}%`,
          background: color, transition: 'width 0.6s ease',
        }} />
      </div>
    </div>
  );
}

function NoDataBadge() {
  return (
    <span
      title="Aucune donnée dans la base. Vérifiez l'ingestion OVH."
      style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 6,
        fontSize: 10, fontWeight: 700, background: '#f1f5f9', color: '#94a3b8',
        border: '1px dashed #cbd5e1',
      }}
    >
      Pas de données
    </span>
  );
}

const STATUS_MAP = {
  optimized:     { label: 'Optimisé',     color: '#16a34a', bg: '#dcfce7', border: '#86efac' },
  underutilized: { label: 'Sous-utilisé', color: '#d97706', bg: '#fef3c7', border: '#fcd34d' },
  critical:      { label: 'Critique',     color: '#dc2626', bg: '#fee2e2', border: '#fca5a5' },
};

const RECOMMENDATION_MAP = {
  optimized:     { icon: '✅', text: 'Usage équilibré' },
  underutilized: { icon: '💡', text: 'Envisager un downsize' },
  critical:      { icon: '⚠️', text: 'Envisager un upsize' },
};

function SortIcon({ sortKey, sortDir, col }) {
  if (sortKey !== col) return <ChevronUp size={12} style={{ opacity: 0.3 }} />;
  return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
}

/**
 * ServerTable — Sortable, filterable table showing merged cost + resource metrics.
 *
 * Props:
 *   servers        {Array}    - enriched server objects from buildServerList()
 *   loading        {boolean}  - show spinner when true
 *   onServerSelect {Function} - callback(server) when a row is clicked
 */
export default function ServerTable({ servers = [], loading, onServerSelect }) {
  const [sortKey, setSortKey] = useState('monthlyCost');
  const [sortDir, setSortDir] = useState('desc');

  const handleSort = key => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sorted = [...servers].sort((a, b) => {
    const v = sortDir === 'asc' ? 1 : -1;
    return (a[sortKey] > b[sortKey] ? 1 : -1) * v;
  });

  const thStyle = col => ({
    padding: '14px 20px', textAlign: 'left', fontSize: 11, fontWeight: 800,
    color: sortKey === col ? '#1B5E46' : '#94a3b8',
    textTransform: 'uppercase', letterSpacing: '.08em',
    cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
  });

  return (
    <div style={{ overflowX: 'auto', background: 'white' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '2px solid #f1f5f9' }}>
            <th style={thStyle('name')} onClick={() => handleSort('name')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Server size={13} /> Serveur <SortIcon sortKey={sortKey} sortDir={sortDir} col="name" />
              </div>
            </th>
            <th style={{ ...thStyle('type'), cursor: 'default' }}>Type</th>
            <th style={{ ...thStyle('reference'), cursor: 'default' }}>Référence</th>
            <th style={thStyle('avgCpu')} onClick={() => handleSort('avgCpu')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Cpu size={13} /> CPU moy. <SortIcon sortKey={sortKey} sortDir={sortDir} col="avgCpu" />
              </div>
            </th>
            <th style={thStyle('avgRam')} onClick={() => handleSort('avgRam')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <MemoryStick size={13} /> RAM moy. <SortIcon sortKey={sortKey} sortDir={sortDir} col="avgRam" />
              </div>
            </th>
            <th style={thStyle('avgDisk')} onClick={() => handleSort('avgDisk')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <HardDrive size={13} /> Disque moy. <SortIcon sortKey={sortKey} sortDir={sortDir} col="avgDisk" />
              </div>
            </th>
            <th style={thStyle('monthlyCost')} onClick={() => handleSort('monthlyCost')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                💰 Coût/mois <SortIcon sortKey={sortKey} sortDir={sortDir} col="monthlyCost" />
              </div>
            </th>
            <th style={{ ...thStyle('status'), cursor: 'default' }}>Statut</th>
            <th style={{ ...thStyle('status'), cursor: 'default', minWidth: 220 }}>Recommandation</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={9} style={{ padding: 60, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
                <div style={{
                  display: 'inline-block', width: 24, height: 24,
                  border: '3px solid #e2e8f0', borderTopColor: '#1B5E46',
                  borderRadius: '50%', animation: 'spin 1s linear infinite',
                }} />
                <p style={{ marginTop: 12 }}>Chargement des serveurs...</p>
              </td>
            </tr>
          )}
          {!loading && sorted.length === 0 && (
            <tr>
              <td colSpan={9} style={{ padding: 60, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
                <Server size={48} style={{ opacity: 0.2, margin: '0 auto 16px', display: 'block' }} />
                Aucun serveur trouvé
              </td>
            </tr>
          )}
          {!loading && sorted.map((s, i) => {
            const statusCfg = STATUS_MAP[s.status] || STATUS_MAP.optimized;
            const rec       = RECOMMENDATION_MAP[s.status] || RECOMMENDATION_MAP.optimized;
            return (
              <tr
                key={s.id}
                onClick={() => onServerSelect?.(s)}
                style={{
                  borderTop: '1px solid #f8fafc',
                  background: i % 2 === 0 ? '#fff' : '#fafafa',
                  transition: 'background .1s',
                  cursor: onServerSelect ? 'pointer' : 'default',
                }}
                onMouseEnter={e => onServerSelect && (e.currentTarget.style.background = '#eff6ff')}
                onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafafa')}
              >
                {/* SERVER NAME */}
                <td style={{ padding: '18px 20px' }}>
                  <div style={{
                    fontWeight: 700, color: '#0f172a', fontSize: 14,
                    maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }} title={s.name}>
                    {s.name}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                    {s.records > 0
                      ? `${s.records} enregistrement${s.records !== 1 ? 's' : ''}`
                      : 'Aucune donnée'}
                  </div>
                </td>

                {/* TYPE */}
                <td style={{ padding: '18px 20px' }}>
                  <span style={{
                    padding: '4px 12px', borderRadius: 9999, fontSize: 11, fontWeight: 700,
                    background: s.type === 'VPS' ? '#F3E8FF' : '#EFF6FF',
                    color:      s.type === 'VPS' ? '#7C3AED' : '#2563EB',
                  }}>
                    {s.type === 'VPS' ? '🖥️ VPS' : '🗄️ Dédié'}
                  </span>
                </td>

                {/* REFERENCE */}
                <td style={{ padding: '18px 20px' }}>
                  {s.reference && s.reference !== '—' ? (
                    <span style={{
                      display: 'inline-block', padding: '3px 10px', borderRadius: 6,
                      fontSize: 11, fontWeight: 700, fontFamily: 'monospace',
                      background: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0',
                      maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }} title={s.reference}>
                      {s.reference}
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, color: '#cbd5e1' }}>—</span>
                  )}
                </td>

                {/* CPU */}
                <td style={{ padding: '18px 20px' }}>
                  {s.hasRealData ? <CpuBar value={s.avgCpu} peak={s.peakCpu} /> : <NoDataBadge />}
                </td>

                {/* RAM */}
                <td style={{ padding: '18px 20px', fontWeight: 700, color: '#0f172a' }}>
                  {s.hasRealData ? (
                    <>
                      {s.avgRam.toFixed(1)} <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>GB</span>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>pic {s.peakRam.toFixed(1)} GB</div>
                    </>
                  ) : <NoDataBadge />}
                </td>

                {/* DISK */}
                <td style={{ padding: '18px 20px', fontWeight: 700, color: '#0f172a' }}>
                  {s.hasRealData ? (
                    <>
                      {s.avgDisk.toFixed(1)} <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>GB</span>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>pic {s.peakDisk.toFixed(1)} GB</div>
                    </>
                  ) : <NoDataBadge />}
                </td>

                {/* COST */}
                <td style={{ padding: '18px 20px' }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: '#1B5E46' }}>
                    {fmt2(s.monthlyCost)} €
                  </span>
                </td>

                {/* STATUS */}
                <td style={{ padding: '18px 20px' }}>
                  {s.hasRealData ? (
                    <span style={{
                      display: 'inline-block', padding: '5px 14px', borderRadius: 9999,
                      fontSize: 11, fontWeight: 700,
                      color: statusCfg.color, background: statusCfg.bg,
                      border: `1px solid ${statusCfg.border}`,
                    }}>
                      {statusCfg.label}
                    </span>
                  ) : (
                    <span style={{
                      display: 'inline-block', padding: '5px 14px', borderRadius: 9999,
                      fontSize: 11, fontWeight: 700, color: '#94a3b8',
                      background: '#f8fafc', border: '1px solid #e2e8f0',
                    }}>
                      Inconnu
                    </span>
                  )}
                </td>

                {/* RECOMMENDATION */}
                <td style={{ padding: '18px 20px', fontSize: 13, color: '#374151' }}>
                  {s.hasRealData ? `${rec.icon} ${rec.text}` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
