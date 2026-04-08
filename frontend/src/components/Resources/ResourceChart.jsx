import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';

function ChartTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#0f172a', border: '1px solid #1e293b',
      borderRadius: 12, padding: '10px 16px',
      fontSize: 12, color: '#f8fafc',
    }}>
      <p style={{ color: '#94a3b8', marginBottom: 6, fontSize: 11 }}>
        {new Date(label).toLocaleString('fr-FR')}
      </p>
      {payload.map((p, idx) => (
        <p key={idx} style={{ color: p.color, fontWeight: 700 }}>
          {p.name}: {Number(p.value).toFixed(1)}{unit}
        </p>
      ))}
    </div>
  );
}

/**
 * ResourceChart — Recharts-based time-series visualization for a single metric.
 *
 * Props:
 *   data       {Array}   - time-series records (each with `timestamp` + metricKey)
 *   metricKey  {string}  - key to read from each data point (e.g. "cpu_usage")
 *   label      {string}  - chart title
 *   unit       {string}  - unit suffix for tooltips/axis (e.g. "%" or "GB")
 *   color      {string}  - line + accent color (hex)
 *   threshold  {number}  - optional reference line value (e.g. 85 for CPU warning)
 */
export default function ResourceChart({ data = [], metricKey, label, unit, color, threshold }) {
  if (!data || data.length === 0) {
    return (
      <div style={{
        background: '#fff', borderRadius: 20, border: '1px solid #e2e8f0',
        padding: '24px 28px', height: 300,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#94a3b8', flexDirection: 'column', gap: 8,
      }}>
        <span style={{ fontSize: 32 }}>📉</span>
        <span>Aucune donnée disponible</span>
        <span style={{ fontSize: 11 }}>Vérifiez l'ingestion OVH dans votre backend</span>
      </div>
    );
  }

  const maxValue = Math.max(...data.map(d => d[metricKey] || 0));
  const avgValue = data.reduce((s, d) => s + (d[metricKey] || 0), 0) / data.length;

  return (
    <div style={{
      background: '#fff', borderRadius: 20, border: '1px solid #e2e8f0',
      padding: '24px 28px', boxShadow: '0 4px 20px rgba(0,0,0,.05)',
    }}>
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', marginBottom: 2 }}>{label}</h3>
        <p style={{ fontSize: 12, color: '#94a3b8' }}>
          Max:{' '}
          <span style={{ fontWeight: 700, color }}>{maxValue.toFixed(1)}{unit}</span>
          {' • '}
          Avg:{' '}
          <span style={{ fontWeight: 700, color }}>{avgValue.toFixed(1)}{unit}</span>
        </p>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="timestamp"
            tickFormatter={v =>
              new Date(v).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            }
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${v}${unit}`}
          />
          <Tooltip content={<ChartTooltip unit={unit} />} />
          {threshold && (
            <ReferenceLine
              y={threshold}
              stroke="#fca5a5"
              strokeDasharray="4 4"
              label={{ value: `Seuil ${threshold}${unit}`, fill: '#dc2626', fontSize: 10 }}
            />
          )}
          <Line
            type="monotone"
            dataKey={metricKey}
            stroke={color}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 0, fill: color }}
            name={label}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
