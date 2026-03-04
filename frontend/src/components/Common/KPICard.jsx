import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

const iconColors = {
  success: 'green',
  accent:  'blue',
  warning: 'orange',
  danger:  'red',
};

export default function KPICard({ title, value, unit = '', icon: Icon, trend = 0, color = 'success' }) {
  const c = iconColors[color] || 'green';

  return (
    <div className="kpi-card">
      <div className="kpi-top">
        <span className="kpi-label">{title}</span>
        <div className={`kpi-icon ${c}`}>
          {Icon && <Icon size={18} />}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
        <span className="kpi-value">{value}</span>
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>

      {trend !== 0 && (
        <div className={`kpi-trend ${trend > 0 ? 'up' : 'down'}`}>
          {trend > 0
            ? <TrendingUp  size={13} />
            : <TrendingDown size={13} />}
          <span>{Math.abs(trend)}% vs mois dernier</span>
        </div>
      )}
    </div>
  );
}