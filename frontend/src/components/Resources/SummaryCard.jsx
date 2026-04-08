import React from 'react';
import { Cpu, MemoryStick, HardDrive, TrendingUp, TrendingDown, Minus } from 'lucide-react';

const CARD_CONFIGS = {
  cpu:  { label: 'CPU Moyen',  unit: '%',  icon: Cpu,         color: '#2563eb', bg: '#eff6ff', gradient: 'linear-gradient(135deg,#2563eb,#1d4ed8)' },
  ram:  { label: 'RAM Moyen',  unit: ' GB', icon: MemoryStick, color: '#7c3aed', bg: '#f5f3ff', gradient: 'linear-gradient(135deg,#7c3aed,#6d28d9)' },
  disk: { label: 'Disk Moyen', unit: ' GB', icon: HardDrive,   color: '#059669', bg: '#ecfdf5', gradient: 'linear-gradient(135deg,#059669,#047857)' },
  peak_cpu:  { label: 'Pic CPU',  unit: '%',  icon: TrendingUp,  color: '#dc2626', bg: '#fff5f5', gradient: 'linear-gradient(135deg,#dc2626,#b91c1c)' },
  peak_ram:  { label: 'Pic RAM',  unit: ' GB', icon: TrendingUp,  color: '#d97706', bg: '#fffbeb', gradient: 'linear-gradient(135deg,#d97706,#b45309)' },
  peak_disk: { label: 'Pic Disk', unit: ' GB', icon: TrendingUp,  color: '#0891b2', bg: '#ecfeff', gradient: 'linear-gradient(135deg,#0891b2,#0e7490)' },
};

export default function SummaryCard({ type, value, sub }) {
  const cfg = CARD_CONFIGS[type] || CARD_CONFIGS.cpu;
  const Icon = cfg.icon;
  const display = value != null ? Number(value).toFixed(1) : '—';

  return (
    <div style={{
      background: 'white',
      borderRadius: 18,
      padding: '20px 22px',
      border: '1px solid #e8edf5',
      boxShadow: '0 2px 12px rgba(0,0,0,.05)',
      position: 'relative',
      overflow: 'hidden',
      minWidth: 0,
    }}>
      {/* Top accent */}
      <div style={{ height: 4, background: cfg.gradient, position: 'absolute', top: 0, left: 0, right: 0, borderRadius: '18px 18px 0 0' }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: cfg.bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={20} color={cfg.color} />
        </div>
      </div>

      <p style={{ fontSize: 28, fontWeight: 900, color: '#0f172a', lineHeight: 1, letterSpacing: '-1px' }}>
        {display}<span style={{ fontSize: 14, fontWeight: 600, color: '#94a3b8', marginLeft: 4 }}>{cfg.unit}</span>
      </p>
      <p style={{ fontSize: 12, color: '#64748b', marginTop: 6, fontWeight: 600 }}>{cfg.label}</p>
      {sub && <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{sub}</p>}
    </div>
  );
}
