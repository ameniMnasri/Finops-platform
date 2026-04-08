import React from 'react';
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';

const SERIES = [
  { key: 'cpu_usage',  label: 'CPU (%)',  color: '#2563eb', unit: '%'  },
  { key: 'ram_usage',  label: 'RAM (GB)', color: '#7c3aed', unit: ' GB' },
  { key: 'disk_usage', label: 'Disk (GB)',color: '#059669', unit: ' GB' },
];

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 16px', boxShadow: '0 4px 20px rgba(0,0,0,.1)', minWidth: 160 }}>
      <p style={{ fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 600 }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ fontSize: 13, fontWeight: 700, color: p.color, marginBottom: 2 }}>
          {p.name}: {p.value != null ? Number(p.value).toFixed(1) : '—'}{SERIES.find(s => s.key === p.dataKey)?.unit || ''}
        </p>
      ))}
    </div>
  );
}

export default function ResourceChart({ history, serverName }) {
  if (!history || history.length === 0) {
    return (
      <div style={{ background: 'white', borderRadius: 18, border: '1px solid #e8edf5', padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>Aucune donnée historique</p>
        <p style={{ fontSize: 12, marginTop: 4 }}>L'historique apparaîtra après plusieurs imports</p>
      </div>
    );
  }

  const data = history.map(m => ({
    date: fmtDate(m.recorded_at),
    cpu_usage:  m.cpu_usage,
    ram_usage:  m.ram_usage,
    disk_usage: m.disk_usage,
  }));

  return (
    <div style={{ background: 'white', borderRadius: 18, border: '1px solid #e8edf5', boxShadow: '0 2px 12px rgba(0,0,0,.05)', overflow: 'hidden' }}>
      <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid #f1f5f9' }}>
        <h3 style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
          Historique — <span style={{ color: '#1B5E46' }}>{serverName}</span>
        </h3>
        <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>{history.length} point{history.length !== 1 ? 's' : ''} de données</p>
      </div>

      <div style={{ padding: '20px 16px' }}>
        {SERIES.map(s => (
          <div key={s.key} style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: s.color, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              {s.label}
            </p>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={s.color} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={`url(#grad-${s.key})`}
                  dot={data.length < 10}
                  activeDot={{ r: 5, fill: s.color }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </div>
  );
}
