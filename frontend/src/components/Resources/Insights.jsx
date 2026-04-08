import React from 'react';
import { AlertTriangle, TrendingDown, TrendingUp, CheckCircle, Info } from 'lucide-react';

function getInsight(metric) {
  const cpu = metric.cpu_usage;
  const ram = metric.ram_usage;
  const name = metric.server_name;
  const type = metric.server_type === 'vps' ? 'VPS' : 'Dédié';

  const insights = [];

  // CPU analysis
  if (cpu == null) {
    insights.push({
      level: 'info',
      icon: Info,
      title: `${name} (${type}) — Données insuffisantes`,
      message: 'Aucune métrique CPU disponible. Relancez un import pour obtenir des données.',
    });
  } else if (cpu < 10) {
    insights.push({
      level: 'warning',
      icon: TrendingDown,
      title: `${name} (${type}) — Sous-utilisé`,
      message: `CPU moyen à ${cpu.toFixed(1)}% — Envisagez de réduire la taille du serveur pour économiser des coûts.`,
      action: 'Downsize recommandé',
    });
  } else if (cpu > 85) {
    insights.push({
      level: 'danger',
      icon: TrendingUp,
      title: `${name} (${type}) — Charge critique`,
      message: `CPU à ${cpu.toFixed(1)}% — Risque de saturation. Évitez de réduire la taille, envisagez un upgrade.`,
      action: 'Scale Up recommandé',
    });
  } else {
    insights.push({
      level: 'success',
      icon: CheckCircle,
      title: `${name} (${type}) — Optimisé`,
      message: `CPU à ${cpu.toFixed(1)}% — Utilisation équilibrée, aucune action requise.`,
    });
  }

  return insights;
}

const LEVEL_STYLE = {
  warning: { bg: '#fffbeb', border: '#fde68a', color: '#d97706', iconColor: '#f59e0b' },
  danger:  { bg: '#fff5f5', border: '#fecaca', color: '#dc2626', iconColor: '#ef4444' },
  success: { bg: '#f0fdf4', border: '#bbf7d0', color: '#16a34a', iconColor: '#22c55e' },
  info:    { bg: '#eff6ff', border: '#bfdbfe', color: '#2563eb', iconColor: '#3b82f6' },
};

function InsightCard({ insight }) {
  const s = LEVEL_STYLE[insight.level] || LEVEL_STYLE.info;
  const Icon = insight.icon;
  return (
    <div style={{
      background: s.bg, border: `1px solid ${s.border}`,
      borderRadius: 14, padding: '14px 18px',
      display: 'flex', alignItems: 'flex-start', gap: 12,
    }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: `1px solid ${s.border}` }}>
        <Icon size={18} color={s.iconColor} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 800, color: s.color, marginBottom: 4 }}>{insight.title}</p>
        <p style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>{insight.message}</p>
        {insight.action && (
          <span style={{ display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 700, color: s.color, background: 'white', border: `1px solid ${s.border}`, padding: '3px 10px', borderRadius: 99 }}>
            💡 {insight.action}
          </span>
        )}
      </div>
    </div>
  );
}

export default function Insights({ metrics }) {
  if (!metrics || metrics.length === 0) {
    return (
      <div style={{ background: 'white', borderRadius: 18, border: '1px solid #e8edf5', padding: '32px', textAlign: 'center' }}>
        <AlertTriangle size={40} color="#94a3b8" style={{ opacity: .4, margin: '0 auto 12px', display: 'block' }} />
        <p style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>Aucune analyse disponible</p>
        <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Importez vos métriques OVH pour voir les recommandations</p>
      </div>
    );
  }

  const allInsights = metrics.flatMap(m => getInsight(m));

  // Sort: danger → warning → info → success
  const order = { danger: 0, warning: 1, info: 2, success: 3 };
  allInsights.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));

  const byLevel = {
    danger:  allInsights.filter(i => i.level === 'danger').length,
    warning: allInsights.filter(i => i.level === 'warning').length,
    success: allInsights.filter(i => i.level === 'success').length,
  };

  return (
    <div style={{ background: 'white', borderRadius: 18, border: '1px solid #e8edf5', boxShadow: '0 2px 12px rgba(0,0,0,.05)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid #f1f5f9' }}>
        <h3 style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', marginBottom: 2 }}>
          💡 Recommandations FinOps
        </h3>
        <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          {byLevel.danger  > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', background: '#fff5f5', padding: '3px 10px', borderRadius: 99 }}>🔴 {byLevel.danger} critique{byLevel.danger > 1 ? 's' : ''}</span>}
          {byLevel.warning > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#d97706', background: '#fffbeb', padding: '3px 10px', borderRadius: 99 }}>🟡 {byLevel.warning} sous-utilisé{byLevel.warning > 1 ? 's' : ''}</span>}
          {byLevel.success > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', background: '#f0fdf4', padding: '3px 10px', borderRadius: 99 }}>🟢 {byLevel.success} optimisé{byLevel.success > 1 ? 's' : ''}</span>}
        </div>
      </div>

      {/* Insights list */}
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {allInsights.map((insight, i) => (
          <InsightCard key={i} insight={insight} />
        ))}
      </div>
    </div>
  );
}
