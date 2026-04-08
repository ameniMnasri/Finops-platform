import React from 'react';
import { AlertTriangle, AlertCircle, CheckCircle, Zap } from 'lucide-react';

function InsightCard({ type, title, description, action }) {
  const config = {
    warning:  { bg: '#fffbeb', border: '#fcd34d', icon: AlertTriangle, color: '#f59e0b' },
    critical: { bg: '#fff5f5', border: '#fca5a5', icon: AlertCircle,   color: '#dc2626' },
    success:  { bg: '#f0fdf4', border: '#86efac', icon: CheckCircle,   color: '#16a34a' },
  };
  const cfg  = config[type] || config.success;
  const Icon = cfg.icon;
  return (
    <div style={{
      background: cfg.bg, border: `1.5px solid ${cfg.border}`,
      borderRadius: 12, padding: '16px 18px',
      display: 'flex', gap: 12, marginBottom: 12,
    }}>
      <Icon size={20} color={cfg.color} style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13, fontWeight: 800, color: cfg.color, marginBottom: 4 }}>{title}</p>
        <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5, marginBottom: 8 }}>{description}</p>
        {action && (
          <button style={{
            fontSize: 11, fontWeight: 700, color: cfg.color,
            background: 'white', border: `1px solid ${cfg.border}`,
            borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {action}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Insights — FinOps intelligence panel with global summary and per-server recommendations.
 *
 * Props:
 *   servers {Array} - enriched server objects from buildServerList()
 */
export default function Insights({ servers = [] }) {
  const realServers = servers.filter(s => s.hasRealData);

  if (servers.length === 0) {
    return (
      <div style={{
        padding: 48, textAlign: 'center', color: '#94a3b8',
        background: '#fff', borderRadius: 20, border: '1px solid #e2e8f0',
      }}>
        <Zap size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
        <p>Aucune donnée pour générer des insights</p>
      </div>
    );
  }

  if (realServers.length === 0) {
    return (
      <div style={{
        padding: 48, textAlign: 'center', color: '#94a3b8',
        background: '#fff', borderRadius: 20, border: '1px solid #e2e8f0',
      }}>
        <AlertTriangle size={32} style={{ marginBottom: 12, opacity: 0.4, color: '#f59e0b' }} />
        <p style={{ fontWeight: 700, color: '#374151', marginBottom: 8 }}>
          Aucune métrique réelle disponible
        </p>
        <p style={{ fontSize: 13 }}>
          Les serveurs sont listés depuis les coûts, mais aucune donnée CPU/RAM/Disk n'a été ingérée.
          <br />
          Vérifiez votre job d'ingestion OVH (<code>POST /resources/</code>).
        </p>
      </div>
    );
  }

  const underCount  = realServers.filter(s => s.status === 'underutilized').length;
  const critCount   = realServers.filter(s => s.status === 'critical').length;
  const optimCount  = realServers.filter(s => s.status === 'optimized').length;
  // Rough estimate: ~40€/month saved per underutilised server after downsizing
  const estimatedSavings = underCount * 40;

  const insights = [];
  realServers.forEach(s => {
    if (s.avgCpu < 10) {
      insights.push({
        type: 'warning',
        title: `${s.name} est fortement sous-utilisé`,
        description: `CPU moyen à ${s.avgCpu.toFixed(1)}% — downsize recommandé pour réduire les coûts.`,
        action: 'Envisager un downsize',
      });
    } else if (s.peakCpu > 85) {
      insights.push({
        type: 'critical',
        title: `${s.name} atteint des pics critiques`,
        description: `Peak CPU à ${s.peakCpu.toFixed(1)}% — risque de dégradation des performances.`,
        action: 'Envisager un upsize',
      });
    } else {
      insights.push({
        type: 'success',
        title: `${s.name} — usage équilibré`,
        description: `CPU moyen à ${s.avgCpu.toFixed(1)}% (pic ${s.peakCpu.toFixed(1)}%) — configuration optimale.`,
      });
    }
  });

  // Sort: critical first, then warning, then success
  insights.sort((a, b) => (
    { critical: 0, warning: 1, success: 2 }[a.type] -
    { critical: 0, warning: 1, success: 2 }[b.type]
  ));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Global summary banner */}
      <div style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        borderRadius: 20, padding: '24px 28px',
        display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Zap size={20} color="#fbbf24" />
            <span style={{ fontSize: 16, fontWeight: 800, color: '#f8fafc' }}>FinOps Intelligence</span>
          </div>
          <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>
            Analyse de {realServers.length} serveur{realServers.length !== 1 ? 's' : ''} avec données réelles
            {' — '}
            {optimCount} optimisé{optimCount !== 1 ? 's' : ''},
            {' '}
            {underCount} sous-utilisé{underCount !== 1 ? 's' : ''},
            {' '}
            {critCount} critique{critCount !== 1 ? 's' : ''}.
          </p>
        </div>
        {underCount > 0 && (
          <div style={{
            background: '#1B5E4622', border: '1px solid #1B5E4655',
            borderRadius: 14, padding: '16px 20px', textAlign: 'center',
          }}>
            <p style={{
              fontSize: 11, fontWeight: 700, color: '#4ade80',
              textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4,
            }}>
              Économies potentielles
            </p>
            <p style={{ fontSize: 26, fontWeight: 900, color: '#4ade80', letterSpacing: '-1px' }}>
              ~{estimatedSavings} €
            </p>
            <p style={{ fontSize: 11, color: '#86efac' }}>/ mois estimé</p>
          </div>
        )}
      </div>

      {/* Per-server insight cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
        {insights.map((ins, i) => <InsightCard key={i} {...ins} />)}
      </div>
    </div>
  );
}
