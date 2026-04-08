import React from 'react';

/**
 * SummaryCard — Reusable KPI card component for resource metrics.
 *
 * Props:
 *   label   {string}       - Upper-case subtitle label
 *   value   {string|number}- Main large value to display
 *   sub     {string}       - Secondary descriptive text
 *   color   {string}       - Accent colour (hex)
 *   bg      {string}       - Background colour (hex)
 *   icon    {Component}    - Lucide icon component
 *   trend   {number}       - Optional trend % (positive=bad/red, negative=good/green)
 */
export default function SummaryCard({ label, value, sub, color, bg, icon: Icon, trend }) {
  return (
    <div
      style={{
        flex: '1 1 160px',
        background: bg,
        border: `1px solid ${color}33`,
        borderRadius: 16,
        padding: '20px 22px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        boxShadow: `0 2px 8px ${color}10`,
        transition: 'transform .15s, box-shadow .15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = `0 8px 24px ${color}25`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = `0 2px 8px ${color}10`;
      }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: color, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 4px 12px ${color}55`,
      }}>
        <Icon size={20} color="white" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: 11, fontWeight: 700, color: '#94a3b8',
          textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4,
        }}>
          {label}
        </p>
        <p style={{
          fontSize: 24, fontWeight: 900, color: '#0f172a',
          lineHeight: 1, letterSpacing: '-0.5px', marginBottom: 4,
        }}>
          {value}
        </p>
        {sub && <p style={{ fontSize: 11, color: '#64748b' }}>{sub}</p>}
        {trend !== undefined && (
          <p style={{
            fontSize: 11,
            color: trend > 0 ? '#dc2626' : '#16a34a',
            fontWeight: 600, marginTop: 4,
          }}>
            {trend > 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
          </p>
        )}
      </div>
    </div>
  );
}
