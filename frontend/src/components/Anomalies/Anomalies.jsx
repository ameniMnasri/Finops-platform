// Anomalies.jsx — Détection d'Anomalies Budgétaires FinOps v6
// CORRECTIONS v6 :
//  1. Filtre "Catégorie MoM" : par référence serveur exacte OU par service_name
//  2. expected_value label correct selon le contexte (pair group vs mois précédent)
//  3. Explication claire du seuil IF et du coût normal
//  4. mom_groupby passé à l'API selon le choix du filtre
import { useState, useEffect, useMemo, useRef } from 'react';
import {
  AlertTriangle, AlertCircle, CheckCircle, Brain,
  RefreshCw, DollarSign, BarChart2,
  ChevronDown, ChevronUp, Trash2, ArrowUpDown,
  Clock, TrendingUp, TrendingDown, Minus, Zap,
  Calendar, Hash, ArrowRight, Server,
} from 'lucide-react';
import Layout from '../Layout/Layout';
import api from '../../services/api';
import toast from 'react-hot-toast';

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  green:    '#059669', greenBg:  '#ECFDF5',
  blue:     '#1D4ED8', blueBg:   '#EFF6FF',
  amber:    '#B45309', amberBg:  '#FFFBEB',
  red:      '#DC2626', redBg:    '#FEF2F2',
  purple:   '#7C3AED', purpleBg: '#F5F3FF',
  teal:     '#0F766E', tealBg:   '#F0FDFA',
  orange:   '#EA580C', orangeBg: '#FFF7ED',
  slate:    '#0F172A', muted:    '#64748B',
  border:   '#E2E8F0', bg:       '#F8FAFC',
  dark:     '#1E293B',
};

const SEV = {
  critical: { color: T.red,    bg: T.redBg,    icon: AlertCircle,   label: 'Critique',  dot: '#DC2626' },
  high:     { color: T.orange, bg: T.orangeBg, icon: AlertTriangle, label: 'Élevée',    dot: '#EA580C' },
  medium:   { color: T.amber,  bg: T.amberBg,  icon: AlertTriangle, label: 'Moyenne',   dot: '#B45309' },
  low:      { color: T.blue,   bg: T.blueBg,   icon: CheckCircle,   label: 'Faible',    dot: '#1D4ED8' },
};

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmtDate     = d => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
const fmtDateTime = d => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtEuro     = v => v != null ? `${Number(v).toFixed(2)} €` : '—';
const fmtPct      = v => v != null ? `${v >= 0 ? '+' : ''}${Number(v).toFixed(1)}%` : null;

// ─── Score IF → niveau visuel ─────────────────────────────────────────────────
function scoreLevel(score) {
  if (score == null) return { label: 'MoM seul', color: T.orange, bg: T.orangeBg, bar: 60, emoji: '📅', pct: 60 };
  const a = Math.abs(score);
  if (a >= 0.25) return { label: 'Outlier extrême', color: T.red,    bg: T.redBg,    bar: 100, emoji: '🔴', pct: 99 };
  if (a >= 0.18) return { label: 'Outlier fort',    color: T.orange, bg: T.orangeBg, bar: 75,  emoji: '🟠', pct: 75 };
  if (a >= 0.13) return { label: 'Outlier modéré',  color: T.amber,  bg: T.amberBg,  bar: 50,  emoji: '🟡', pct: 50 };
  return           { label: 'Outlier léger',        color: T.blue,   bg: T.blueBg,   bar: 25,  emoji: '🔵', pct: 25 };
}

// ─── Parse description ────────────────────────────────────────────────────────
function parseDesc(desc) {
  if (!desc) return {};
  const refMatch      = desc.match(/\bref=([^\s.,]+)/i);
  const varPctMatch   = desc.match(/hausse de ([+-]?[\d.]+)%/i) || desc.match(/MoM\s*:\s*([+-]?[\d.]+)%/i);
  const diffMatch     = desc.match(/\(([+-]?[\d.]+)€\)/);
  const overcostMatch = desc.match(/Surcoût\s*(?:MoM)?\s*:\s*\+?([\d.]+)€/i);
  const curCostMatch  = desc.match(/Mois courant\s*:\s*([\d.]+)€/i);
  const prevCostMatch = desc.match(/Mois précédent\s*:\s*([\d.]+)€/i);
  const total         = desc.match(/total[=:\s]+([\d.]+)€/i)?.[1];
  const avg           = desc.match(/moy[.\s]+([\d.]+)€/i)?.[1];
  const n             = desc.match(/parmi (\d+) services/i)?.[1];

  return {
    ref:          refMatch      ? refMatch[1]                    : null,
    total:        total         ? parseFloat(total)              : null,
    avg:          avg           ? parseFloat(avg)                : null,
    n:            n             ? parseInt(n)                    : null,
    momVariation: varPctMatch   ? parseFloat(varPctMatch[1])     : null,
    momDiff:      diffMatch     ? parseFloat(diffMatch[1])       : null,
    overcost:     overcostMatch ? parseFloat(overcostMatch[1])   : null,
    currentCost:  curCostMatch  ? parseFloat(curCostMatch[1])    : null,
    previousCost: prevCostMatch ? parseFloat(prevCostMatch[1])   : null,
  };
}

// ─── Parse MoM depuis threshold_type ─────────────────────────────────────────
function parseMomFromThreshold(tt) {
  if (!tt) return null;
  const momMatch  = tt.match(/mom=([+-]?[\d.]+)%/);
  const diffMatch = tt.match(/diff=([+-]?[\d.]+)/);
  if (!momMatch && !diffMatch) return null;
  return {
    variation: momMatch  ? parseFloat(momMatch[1])  : null,
    diff:      diffMatch ? parseFloat(diffMatch[1]) : null,
  };
}

function parseDescMom(desc) {
  const p = parseDesc(desc);
  if (p.momVariation == null && p.momDiff == null) return null;
  return { variation: p.momVariation, diff: p.momDiff };
}

// ─── Détection des signaux ────────────────────────────────────────────────────
function anomalySignals(anomaly) {
  const tt  = anomaly.threshold_type ?? '';
  const mom = parseMomFromThreshold(tt) || parseDescMom(anomaly.description);
  const isIF  = anomaly.anomaly_score != null;
  const isMom = tt.includes('mom_variation') ||
                mom?.variation != null ||
                parseDesc(anomaly.description).momVariation != null;
  return { isIF, isMom, mom };
}

// ─── Référence OVH ────────────────────────────────────────────────────────────
function resolveRef(anomaly) {
  const parsed = parseDesc(anomaly.description);
  if (parsed.ref) return parsed.ref;
  if (anomaly.source_record_id) return `REF-${String(anomaly.source_record_id).padStart(5, '0')}`;
  return null;
}

// ─── Explication pédagogique ──────────────────────────────────────────────────
function getWhyText(anomaly) {
  const observed  = anomaly.observed_value;
  const expected  = anomaly.expected_value;
  const score     = anomaly.anomaly_score;
  const { isIF, isMom } = anomalySignals(anomaly);
  const parsed    = parseDesc(anomaly.description);

  const deviationPct = expected && expected > 0
    ? ((observed - expected) / expected * 100)
    : null;

  const parts = [];

  if (isIF && deviationPct != null) {
    const dir   = deviationPct > 0 ? 'supérieur' : 'inférieur';
    const times = Math.abs(deviationPct / 100 + 1).toFixed(1);
    parts.push(
      `[Signal 1 — IF] Ce service affiche un coût de ${fmtEuro(observed)}, `
      + `soit ${Math.abs(deviationPct).toFixed(0)}% ${dir} à la moyenne `
      + `des services comparables (référence : ${fmtEuro(expected)}). `
      + `Isolation Forest l'a isolé parmi ${parsed.n ?? '?'} services car il faut `
      + `${times}× moins de décisions — signe d'un profil budgétaire très atypique.`
    );
  } else if (isIF) {
    parts.push(
      `[Signal 1 — IF] Score IF : ${score?.toFixed(4)} (seuil : -0.08). `
      + `Ce service est outlier par rapport à ses pairs.`
    );
  }

  if (isMom) {
    const v  = parsed.momVariation ?? parseMomFromThreshold(anomaly.threshold_type)?.variation;
    const d  = parsed.momDiff ?? parseMomFromThreshold(anomaly.threshold_type)?.diff;
    const oc = parsed.overcost;
    if (v != null) {
      const sign = v >= 0 ? '+' : '';
      parts.push(
        `[Signal 3 — MoM] Coût ${v >= 0 ? 'en hausse' : 'en baisse'} de `
        + `${sign}${v.toFixed(1)}% vs le mois précédent`
        + (d != null ? ` (${sign}${d.toFixed(2)}€)` : '')
        + (oc != null && oc > 0 ? `. Surcoût réel : +${oc.toFixed(2)}€.` : '.')
      );
    }
  }

  if (!isIF && isMom) {
    const cur  = parsed.currentCost  ?? observed;
    const prev = parsed.previousCost ?? expected;
    if (prev > 0) {
      parts.push(`[Signal 2 — Peer] Mois courant : ${fmtEuro(cur)} vs mois précédent : ${fmtEuro(prev)}.`);
    }
  }

  return parts.join('\n\n') ||
    `Isolation Forest a détecté un profil budgétaire atypique. Score : ${score?.toFixed(4)}.`;
}

// ─── Conseil FinOps ───────────────────────────────────────────────────────────
function getAdvice(anomaly) {
  const { isIF, isMom } = anomalySignals(anomaly);
  const parsed          = parseDesc(anomaly.description);
  const observed        = anomaly.observed_value;
  const expected        = anomaly.expected_value;
  const deviationPct    = expected && expected > 0
    ? ((observed - expected) / expected * 100) : null;
  const momVar          = parsed.momVariation ?? parseMomFromThreshold(anomaly.threshold_type)?.variation;

  if (momVar != null && momVar >= 100)
    return { text: `🚨 Forte hausse MoM : +${momVar.toFixed(0)}% vs le mois dernier. Vérifiez immédiatement : nouvelles ressources, auto-scaling, ou erreur de facturation.`, color: T.red, bg: T.redBg };
  if (momVar != null && momVar >= 50)
    return { text: `📈 Dérive budgétaire MoM : +${momVar.toFixed(0)}% vs mois dernier. Bloquez l'auto-scaling ou vérifiez les nouvelles ressources ajoutées récemment.`, color: T.orange, bg: T.orangeBg };
  if (deviationPct != null && deviationPct > 150)
    return { text: `🚨 Action urgente : ce service coûte plus du double de la norme inter-services. Vérifiez immédiatement s'il est actif et si ses options sont justifiées.`, color: T.red, bg: T.redBg };
  if (deviationPct != null && deviationPct > 75)
    return { text: `⚠️ Audit recommandé : ce service est significativement plus cher que ses pairs. Comparez avec des services équivalents et vérifiez la tendance sur 3 mois.`, color: T.orange, bg: T.orangeBg };
  return { text: `💡 Profil budgétaire atypique détecté. Surveillez l'évolution sur les prochaines périodes.`, color: T.teal, bg: T.tealBg };
}

/// ⭐ CORRECTED: Filtre MoM avec vraie différenciation

function CostInsightPanel({ anomaly }) {
  const score    = anomaly.anomaly_score;
  const observed = anomaly.observed_value;
  const expected = anomaly.expected_value;
  const sl       = scoreLevel(score);
  const advice   = getAdvice(anomaly);
  const whyText  = getWhyText(anomaly);
  const parsed   = parseDesc(anomaly.description);
  const { isIF, isMom } = anomalySignals(anomaly);

  const deviationPct = expected && expected > 0
    ? ((observed - expected) / expected * 100) : null;

  const momVar   = parsed.momVariation ?? parseMomFromThreshold(anomaly.threshold_type)?.variation;
  const momDiff  = parsed.momDiff      ?? parseMomFromThreshold(anomaly.threshold_type)?.diff;
  const overcost = parsed.overcost ?? (momDiff != null && momDiff > 0 ? momDiff : null);

  const curCost  = parsed.currentCost  ?? (isMom && !isIF ? observed : null);
  const prevCost = parsed.previousCost ?? (isMom && !isIF ? expected : null);

  // ✅ NOUVEAU: Déterminer le mode MoM utilisé
  const thresholdType = anomaly.threshold_type || '';
  const momMode = thresholdType.includes('mom_ref') ? 'ref' : 
                  thresholdType.includes('mom_service') ? 'service' :
                  'inconnu';

  const nServices = anomaly.threshold_type?.match(/n=(\d+)/)?.[1] ?? '?';
  const ifExplain = isIF
    ? `Isolation Forest a entraîné des arbres de décision aléatoires sur ${nServices} services. `
      + `Les points normaux sont difficiles à isoler (ils ressemblent à leurs voisins). `
      + `Ce service a été isolé très rapidement → score très négatif (${score?.toFixed(4)}). `
      + `Double-gate appliqué : pred == -1 ET score < -0.08.`
    : null;

  // ✅ LABEL CLAIR selon contexte
  const normalLabel = isIF
    ? `Moyenne inter-services (${nServices} services sur 90j) — VRAI MOYENNE`
    : isMom && !isIF 
    ? `Coût mois précédent (base MoM ${momMode === 'ref' ? 'par ref serveur' : 'par service'})`
    : 'Référence';

  return (
    <div style={{ marginTop: 10, background: 'white', border: `1px solid ${T.border}`, borderLeft: `4px solid ${sl.color}`, borderRadius: 10, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Header avec MODE MoM */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Brain size={14} color={T.teal} />
        <span style={{ fontSize: 11, fontWeight: 800, color: T.teal, textTransform: 'uppercase', letterSpacing: '.08em' }}>
          Analyse FinOps — {isIF && isMom ? '3 Signaux' : isIF ? 'IF + Peer' : 'MoM Temporal'}
        </span>
        <span style={{ padding: '2px 10px', borderRadius: 99, fontSize: 10, fontWeight: 700, background: sl.bg, color: sl.color, border: `1px solid ${sl.color}44` }}>
          {sl.emoji} {sl.label}
        </span>
        {isIF && <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, background: T.tealBg, color: T.teal, border: '1px solid #5eead4' }}>🤖 IF</span>}
        {isMom && (
          <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, background: T.orangeBg, color: T.orange, border: `1px solid ${T.orange}44` }}>
            📅 MoM {momMode === 'ref' ? '🖥️ ref' : '📊 service'}
          </span>
        )}
      </div>

      {/* Métriques clés */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10 }}>
        {/* Coût observé */}
        <div style={{ background: sl.bg, borderRadius: 10, padding: '14px 16px', border: `1px solid ${sl.color}33` }}>
          <p style={{ fontSize: 9, fontWeight: 800, color: sl.color, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>💰 Coût Réel (Anormal)</p>
          <p style={{ fontSize: 24, fontWeight: 900, color: sl.color, margin: 0 }}>{fmtEuro(observed)}</p>
          <p style={{ fontSize: 10, color: T.muted, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Calendar size={9} /> {fmtDate(anomaly.detected_at)}
          </p>
        </div>

        {/* Coût normal — label TRANSPARENT */}
        <div style={{ background: T.greenBg, borderRadius: 10, padding: '14px 16px', border: '1px solid #6ee7b7' }}>
          <p style={{ fontSize: 9, fontWeight: 800, color: T.green, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>
            ✅ Coût Normal (Référence)
          </p>
          <p style={{ fontSize: 24, fontWeight: 900, color: T.green, margin: 0 }}>{fmtEuro(expected)}</p>
          <p style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>{normalLabel}</p>
        </div>

        {/* Δ MoM */}
        {isMom && momVar != null && (
          <div style={{ background: momVar > 0 ? T.redBg : T.greenBg, borderRadius: 10, padding: '14px 16px', border: `1px solid ${momVar > 0 ? '#fca5a5' : '#6ee7b7'}` }}>
            <p style={{ fontSize: 9, fontWeight: 800, color: T.muted, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>📅 Δ vs Mois Dernier ({momMode})</p>
            <p style={{ fontSize: 24, fontWeight: 900, color: momVar > 0 ? T.red : T.green, margin: 0 }}>{fmtPct(momVar)}</p>
            {momDiff != null && (
              <p style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>
                {momDiff >= 0 ? '+' : ''}{momDiff.toFixed(2)}€ vs mois précédent
              </p>
            )}
          </div>
        )}

        {/* Surcoût vs pairs (IF) */}
        {isIF && deviationPct != null && (
          <div style={{ background: deviationPct > 0 ? T.redBg : T.blueBg, borderRadius: 10, padding: '14px 16px', border: `1px solid ${deviationPct > 0 ? '#fca5a5' : '#93c5fd'}` }}>
            <p style={{ fontSize: 9, fontWeight: 800, color: T.muted, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>
              {deviationPct > 0
                ? <><TrendingUp size={9} style={{ display: 'inline', marginRight: 3 }} />Surcoût vs Moyenne</>
                : <><TrendingDown size={9} style={{ display: 'inline', marginRight: 3 }} />Sous-coût</>
              }
            </p>
            <p style={{ fontSize: 24, fontWeight: 900, color: deviationPct > 0 ? T.red : T.blue, margin: 0 }}>
              {deviationPct > 0 ? '+' : ''}{Math.abs(deviationPct).toFixed(2)}%
            </p>
            <p style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>
              {fmtEuro(Math.abs(observed - (expected ?? 0)))} au-dessus de la norme
            </p>
          </div>
        )}

        {/* Score IF */}
        {isIF && score != null && (
          <div style={{ background: T.purpleBg, borderRadius: 10, padding: '14px 16px', border: '1px solid #c4b5fd' }}>
            <p style={{ fontSize: 9, fontWeight: 800, color: T.purple, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>🤖 Score Isolation Forest</p>
            <p style={{ fontSize: 24, fontWeight: 900, color: T.purple, margin: 0 }}>{score.toFixed(4)}</p>
            <div style={{ marginTop: 6, height: 5, background: '#ddd6fe', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ width: `${sl.bar}%`, height: '100%', background: sl.color, borderRadius: 99, transition: 'width .4s' }} />
            </div>
            <p style={{ fontSize: 9, color: T.muted, marginTop: 4 }}>Seuil : -0.08 · Plus négatif = plus anormal</p>
          </div>
        )}
      </div>

      {/* Explication transparente */}
      {isIF && ifExplain && (
        <div style={{ background: T.tealBg, border: '1px solid #5eead4', borderRadius: 8, padding: '13px 16px' }}>
          <p style={{ fontSize: 10, fontWeight: 800, color: T.teal, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>🤖 Comment IF a détecté cette anomalie ?</p>
          <p style={{ fontSize: 12, color: '#134E4A', lineHeight: 1.7, margin: 0 }}>{ifExplain}</p>
          <div style={{ marginTop: 8, padding: '8px 12px', background: 'white', borderRadius: 6, border: '1px solid #5eead4' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: T.teal, margin: '0 0 4px' }}>📊 D'où vient le "coût normal" ({fmtEuro(expected)}) ?</p>
            <p style={{ fontSize: 11, color: '#134E4A', margin: 0, lineHeight: 1.6 }}>
              C'est la <strong>MOYENNE EXACTE des coûts totaux de {nServices} services</strong> sur 90 jours.
              Formule : SUM(total par service) / {nServices} = {fmtEuro(expected)} €
              <br/>
              ✅ Cette valeur est <strong>vérifiable et transparente</strong> — voir logs du serveur.
            </p>
          </div>
        </div>
      )}

      {/* Conseil FinOps */}
      <div style={{ background: advice.bg, border: `1px solid ${advice.color}44`, borderRadius: 8, padding: '13px 16px' }}>
        <p style={{ fontSize: 12, color: advice.color, fontWeight: 600, lineHeight: 1.6, margin: 0 }}>{advice.text}</p>
      </div>
    </div>
  );
}
// ─── SummaryCard ──────────────────────────────────────────────────────────────
function SummaryCard({ label, value, icon: Icon, color, subtitle }) {
  return (
    <div style={{ flex: '1 1 150px', background: 'white', border: `1px solid ${T.border}`, borderRadius: 14, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: '14px 14px 0 0' }} />
      <div style={{ width: 44, height: 44, borderRadius: 11, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 4px 10px ${color}44` }}>
        <Icon size={20} color="white" />
      </div>
      <div>
        <p style={{ fontSize: 10, fontWeight: 800, color: T.muted, textTransform: 'uppercase', letterSpacing: '.08em', margin: 0 }}>{label}</p>
        <p style={{ fontSize: 28, fontWeight: 900, color: T.slate, lineHeight: 1, margin: '2px 0' }}>{value}</p>
        {subtitle && <p style={{ fontSize: 10, color: T.muted, margin: 0 }}>{subtitle}</p>}
      </div>
    </div>
  );
}

// ─── MoM mini-badge ───────────────────────────────────────────────────────────
function MomBadge({ variation, diff }) {
  if (variation == null) return <Minus size={11} color={T.muted} />;
  const isUp  = variation > 0;
  const color = isUp ? T.red : T.green;
  const bg    = isUp ? T.redBg : T.greenBg;
  const Icon  = isUp ? TrendingUp : TrendingDown;
  const sign  = isUp ? '+' : '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 800, background: bg, color, border: `1px solid ${color}33` }}>
        <Icon size={9} /> {sign}{variation.toFixed(1)}%
      </span>
      {diff != null && <span style={{ fontSize: 10, color, fontWeight: 600 }}>{sign}{diff.toFixed(2)}€</span>}
    </div>
  );
}

// ─── AnomalyRow ───────────────────────────────────────────────────────────────
function AnomalyRow({ anomaly, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const sev     = SEV[anomaly.severity] || SEV.low;
  const SIcon   = sev.icon;
  const sl      = scoreLevel(anomaly.anomaly_score);
  const refCode = resolveRef(anomaly);
  const { isIF, isMom } = anomalySignals(anomaly);
  const parsed  = parseDesc(anomaly.description);
  const tt      = anomaly.threshold_type ?? '';
  const momFromTt = parseMomFromThreshold(tt);
  const momVar  = parsed.momVariation ?? momFromTt?.variation;
  const momDiff = parsed.momDiff      ?? momFromTt?.diff;

  return (
    <>
      <tr
        style={{ borderBottom: `1px solid ${T.border}`, cursor: 'pointer', transition: 'background .15s' }}
        onClick={() => setExpanded(e => !e)}
        onMouseEnter={e => e.currentTarget.style.background = '#FAFFFE'}
        onMouseLeave={e => e.currentTarget.style.background = 'white'}
      >
        {/* Sévérité */}
        <td style={{ padding: '14px 14px', width: 110 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: sev.bg, color: sev.color, border: `1px solid ${sev.color}44` }}>
            <SIcon size={11} /> {sev.label}
          </span>
        </td>

        {/* Référence + Service */}
        <td style={{ padding: '14px 16px', maxWidth: 260 }}>
          {refCode ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 900, color: T.slate, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", letterSpacing: '0.03em', display: 'flex', alignItems: 'center', gap: 6, wordBreak: 'break-all' }}>
                <Hash size={11} color={T.teal} strokeWidth={2.5} />
                {refCode}
              </div>
              <div style={{ fontSize: 10, color: T.muted, marginTop: 3, display: 'flex', alignItems: 'center', gap: 4, wordBreak: 'break-all' }}>
                <DollarSign size={8} /> {anomaly.entity_name}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 700, color: T.slate, wordBreak: 'break-word', display: 'flex', alignItems: 'center', gap: 6 }}>
              <DollarSign size={12} color={T.muted} />
              {anomaly.entity_name}
            </div>
          )}
          <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
            {isIF  && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: T.tealBg,   color: T.teal,   border: '1px solid #5eead4' }}>🤖 IF</span>}
            {isMom && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: T.orangeBg, color: T.orange, border: `1px solid ${T.orange}44` }}>📅 MoM</span>}
          </div>
        </td>

        {/* Coût réel + date */}
        <td style={{ padding: '14px 14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 900, color: sev.color }}>
              {anomaly.observed_value?.toFixed(2)}<span style={{ fontSize: 11, color: T.muted, fontWeight: 400 }}> €</span>
            </span>
            <span style={{ fontSize: 10, color: T.muted, display: 'flex', alignItems: 'center', gap: 3 }}>
              <Calendar size={9} /> {fmtDate(anomaly.detected_at)}
            </span>
          </div>
        </td>

        {/* Δ MoM */}
        <td style={{ padding: '14px 12px', textAlign: 'right', minWidth: 100 }}>
          <MomBadge variation={momVar} diff={momDiff} />
        </td>

        {/* Score IF */}
        <td style={{ padding: '14px 14px', textAlign: 'right', minWidth: 120 }}>
          {anomaly.anomaly_score != null ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: sl.color, fontFamily: 'monospace' }}>{anomaly.anomaly_score.toFixed(4)}</span>
              <span style={{ fontSize: 9, color: T.muted, background: sl.bg, padding: '1px 7px', borderRadius: 99, border: `1px solid ${sl.color}33` }}>{sl.emoji} {sl.label}</span>
              <div style={{ width: 70, height: 3, background: '#e5e7eb', borderRadius: 99, overflow: 'hidden', marginTop: 1 }}>
                <div style={{ width: `${sl.bar}%`, height: '100%', background: sl.color, borderRadius: 99 }} />
              </div>
            </div>
          ) : (
            <span style={{ fontSize: 10, color: T.muted, fontStyle: 'italic' }}>MoM only</span>
          )}
        </td>

        {/* Méthode */}
        <td style={{ padding: '14px 14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {isIF  && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: T.tealBg,   color: T.teal,   border: '1px solid #5eead4'         }}><Brain    size={9} /> Isolation Forest</span>}
            {isMom && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: T.orangeBg, color: T.orange, border: `1px solid ${T.orange}44`     }}><Calendar size={9} /> MoM Temporal</span>}
          </div>
        </td>

        {/* Date */}
        <td style={{ padding: '14px 14px', fontSize: 11, color: T.muted, whiteSpace: 'nowrap' }}>
          {fmtDateTime(anomaly.detected_at)}
        </td>

        {/* Actions */}
        <td style={{ padding: '14px 14px' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              onClick={e => { e.stopPropagation(); onDelete(anomaly.id); }}
              style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: T.redBg, color: T.red, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              title="Supprimer"
            >
              <Trash2 size={12} />
            </button>
            {expanded ? <ChevronUp size={14} color={T.muted} /> : <ChevronDown size={14} color={T.muted} />}
          </div>
        </td>
      </tr>

      {expanded && (
        <tr style={{ background: '#F8FDFC' }}>
          <td colSpan={8} style={{ padding: '10px 20px 18px 48px', borderBottom: `1px solid ${T.border}` }}>
            {anomaly.description && (
              <div style={{ fontSize: 12, color: T.muted, marginBottom: 10 }}>
                <strong style={{ color: T.slate }}>Description : </strong>{anomaly.description}
                {anomaly.threshold_type && (
                  <span style={{ marginLeft: 10, padding: '1px 8px', borderRadius: 4, background: T.bg, border: `1px solid ${T.border}`, fontSize: 11, fontFamily: 'monospace' }}>
                    {anomaly.threshold_type}
                    {anomaly.threshold_value != null && ` (seuil : ${anomaly.threshold_value.toFixed(2)} €)`}
                  </span>
                )}
              </div>
            )}
            <CostInsightPanel anomaly={anomaly} />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── ML Steps ticker ──────────────────────────────────────────────────────────
const ML_STEPS = [
  'Chargement des données de coût…',
  'Calcul MoM : mois courant vs mois précédent…',
  'Agrégat cross-service (total, avg, volatilité, tendance)…',
  'Normalisation RobustScaler…',
  'Entraînement Isolation Forest (coûts services)…',
  'Calcul des scores d\'anomalie IF…',
  'Double-gate : pred==-1 ET score < -0.08…',
  'Détection MoM pur : variation > 50%…',
  'Fusion IF + MoM — escalade sévérité…',
  'Déduplication et tri par score…',
  'Sauvegarde des anomalies en base…',
];

function useDetectionTicker(active) {
  const [step, setStep] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    if (!active) { setStep(0); return; }
    setStep(0);
    ref.current = setInterval(() => setStep(s => s + 1 < ML_STEPS.length ? s + 1 : s), 900);
    return () => clearInterval(ref.current);
  }, [active]);
  return ML_STEPS[step];
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Anomalies() {
  const [anomalies,    setAnomalies]   = useState([]);
  const [summary,      setSummary]     = useState(null);
  const [loading,      setLoading]     = useState(true);
  const [detecting,    setDetecting]   = useState(false);
  const [detectingML,  setDetectingML] = useState(false);
  const [sevFilter,    setSevFilter]   = useState('all');
  const [signalFilter, setSignalFilter]= useState('all');
  const [search,       setSearch]      = useState('');
  const [sortByScore,  setSortByScore] = useState(false);
  const [lastMLRun,    setLastMLRun]   = useState(null);

  // ── NOUVEAU : mode MoM — 'service' (par service_name) ou 'ref' (par ref serveur exacte)
  const [momGroupBy, setMomGroupBy] = useState('service');

  const mlStep = useDetectionTicker(detectingML);

  const loadData = async () => {
    setLoading(true);
    try {
      const [anomRes, sumRes] = await Promise.all([
        api.get('/anomalies/', { params: { limit: 500 } }),
        api.get('/anomalies/summary'),
      ]);
      const costOnly = (Array.isArray(anomRes.data) ? anomRes.data : [])
        .filter(a => a.entity_type === 'cost_service' || a.anomaly_type === 'cost_spike');
      setAnomalies(costOnly);
      setSummary(sumRes.data);
    } catch {
      toast.error('Erreur chargement anomalies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const runDetection = async () => {
    setDetecting(true);
    setDetectingML(true);
    try {
      // Passe mom_groupby à l'API pour choisir le mode MoM
      const res   = await api.post('/anomalies/detect/ml', {
        save:        true,
        mom_groupby: momGroupBy,   // 'service' ou 'ref'
      });
      const count = Array.isArray(res.data) ? res.data.length : 0;
      setLastMLRun(new Date());
      const modeLabel = momGroupBy === 'ref'
        ? 'MoM par référence serveur'
        : 'MoM par service';
      toast.success(`${count} anomalie(s) de coût détectée(s) (IF + ${modeLabel})`);
      await loadData();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Erreur détection ML');
    } finally {
      setDetecting(false);
      setDetectingML(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Supprimer cette anomalie ?')) return;
    try {
      await api.delete(`/anomalies/${id}`);
      toast.success('Anomalie supprimée');
      await loadData();
    } catch {
      toast.error('Erreur suppression');
    }
  };

  const handlePurge = async () => {
    if (!window.confirm('Supprimer TOUTES les anomalies de coût ?')) return;
    try {
      const res = await api.delete('/anomalies/');
      toast.success(res.data?.message || 'Purge effectuée');
      await loadData();
    } catch {
      toast.error('Erreur purge');
    }
  };

  const filtered = useMemo(() => {
    let list = anomalies.filter(a => {
      if (sevFilter !== 'all' && a.severity !== sevFilter) return false;

      if (signalFilter !== 'all') {
        const { isIF, isMom } = anomalySignals(a);
        if (signalFilter === 'if'   && !isIF)          return false;
        if (signalFilter === 'mom'  && !isMom)         return false;
        if (signalFilter === 'both' && !(isIF && isMom)) return false;
      }

      if (search.trim()) {
        const q   = search.toLowerCase();
        const ref = resolveRef(a) ?? '';
        if (
          !a.entity_name.toLowerCase().includes(q) &&
          !ref.toLowerCase().includes(q) &&
          !a.description?.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });

    if (sortByScore) {
      list = [...list].sort((a, b) => {
        if (a.anomaly_score == null && b.anomaly_score == null) return 0;
        if (a.anomaly_score == null) return 1;
        if (b.anomaly_score == null) return -1;
        return a.anomaly_score - b.anomaly_score;
      });
    }
    return list;
  }, [anomalies, sevFilter, signalFilter, search, sortByScore]);

  const critCount      = anomalies.filter(a => a.severity === 'critical').length;
  const highCount      = anomalies.filter(a => a.severity === 'high').length;
  const momCount       = anomalies.filter(a => anomalySignals(a).isMom).length;
  const ifCount        = anomalies.filter(a => anomalySignals(a).isIF).length;
  const totalAnormal   = anomalies.reduce((sum, a) => sum + (a.observed_value ?? 0), 0);
  const totalNormal    = anomalies.reduce((sum, a) => sum + (a.expected_value ?? 0), 0);
  const surcouttotal   = totalAnormal - totalNormal;
  const surcouttotalMom = anomalies.reduce((sum, a) => {
    const { isMom } = anomalySignals(a);
    if (!isMom) return sum;
    const parsed = parseDesc(a.description);
    const oc = parsed.overcost ?? (parsed.momDiff != null && parsed.momDiff > 0 ? parsed.momDiff : 0);
    return sum + oc;
  }, 0);

  return (
    <Layout>
      <div style={{ padding: '0 32px 48px', maxWidth: 1600, margin: '0 auto', fontFamily: "'Inter', sans-serif" }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '28px 0 24px', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 50, height: 50, borderRadius: 14, background: `linear-gradient(135deg, ${T.teal}, #0d9488)`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 6px 18px ${T.teal}44` }}>
              <Brain size={24} color="white" />
            </div>
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 900, color: T.slate, letterSpacing: '-0.5px', margin: 0 }}>Détection d'Anomalies Budgétaires</h1>
              <p style={{ fontSize: 13, color: T.muted, margin: '3px 0 0', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Brain size={11} color={T.teal} />
                Isolation Forest ML · Peer Comparison · Month-over-Month · FinOps v6
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={loadData} disabled={loading} style={{ padding: '10px 18px', borderRadius: 9, background: T.bg, border: `1.5px solid ${T.border}`, color: T.slate, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit' }}>
              <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Actualiser
            </button>
            <button onClick={handlePurge} style={{ padding: '10px 18px', borderRadius: 9, background: T.redBg, border: '1.5px solid #fca5a5', color: T.red, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit' }}>
              <Trash2 size={14} /> Purger tout
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
          <SummaryCard label="Anomalies détectées"    value={anomalies.length}  icon={AlertTriangle} color={T.muted}   subtitle="Coûts uniquement" />
          <SummaryCard label="Critique"               value={critCount}         icon={AlertCircle}   color={T.red}     subtitle="Action requise" />
          <SummaryCard label="Élevée"                 value={highCount}         icon={AlertTriangle} color={T.orange}  subtitle="À surveiller" />
          <SummaryCard label="Détection IF"           value={ifCount}           icon={Brain}         color={T.teal}    subtitle="Isolation Forest" />
          <SummaryCard label="Détection MoM"          value={momCount}          icon={Calendar}      color={T.orange}  subtitle="Month-over-Month" />
          <SummaryCard
            label="Surcoût vs norme pairs"
            value={surcouttotal > 0 ? `+${surcouttotal.toFixed(0)} €` : '—'}
            icon={DollarSign}
            color={surcouttotal > 0 ? T.red : T.green}
            subtitle="vs coût normal inter-services"
          />
          <SummaryCard
            label="Surcoût vs mois dernier"
            value={surcouttotalMom > 0 ? `+${surcouttotalMom.toFixed(0)} €` : '—'}
            icon={TrendingUp}
            color={surcouttotalMom > 0 ? T.orange : T.green}
            subtitle="Hausse MoM cumulée"
          />
        </div>

        {/* Panel de détection */}
        <div style={{ background: 'white', borderRadius: 14, border: `1px solid ${T.border}`, padding: '22px 26px', marginBottom: 22, boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
          <h2 style={{ fontSize: 14, fontWeight: 800, color: T.slate, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={15} color={T.teal} /> Lancer la détection d'anomalies budgétaires
          </h2>

          {/* ── NOUVEAU : Sélecteur de catégorie MoM ─────────────────────── */}
          <div style={{ marginBottom: 16, padding: '14px 16px', background: T.bg, borderRadius: 10, border: `1px solid ${T.border}` }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: T.slate, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Server size={12} color={T.teal} />
              Catégorie MoM — Comment regrouper les données Month-over-Month ?
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setMomGroupBy('service')}
                style={{
                  padding: '10px 18px', borderRadius: 9,
                  background: momGroupBy === 'service' ? T.tealBg : 'white',
                  border: `2px solid ${momGroupBy === 'service' ? T.teal : T.border}`,
                  color: momGroupBy === 'service' ? T.teal : T.muted,
                  fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 7,
                  transition: 'all .15s',
                }}
              >
                <DollarSign size={13} />
                Par service (nom global)
                {momGroupBy === 'service' && <span style={{ fontSize: 9, background: T.teal, color: 'white', borderRadius: 4, padding: '1px 5px' }}>ACTIF</span>}
              </button>
              <button
                onClick={() => setMomGroupBy('ref')}
                style={{
                  padding: '10px 18px', borderRadius: 9,
                  background: momGroupBy === 'ref' ? T.purpleBg : 'white',
                  border: `2px solid ${momGroupBy === 'ref' ? T.purple : T.border}`,
                  color: momGroupBy === 'ref' ? T.purple : T.muted,
                  fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 7,
                  transition: 'all .15s',
                }}
              >
                <Server size={13} />
                Par référence serveur (ns31546254.ip-… exact)
                {momGroupBy === 'ref' && <span style={{ fontSize: 9, background: T.purple, color: 'white', borderRadius: 4, padding: '1px 5px' }}>ACTIF</span>}
              </button>
            </div>
            <p style={{ fontSize: 10, color: T.muted, marginTop: 8, lineHeight: 1.5 }}>
              {momGroupBy === 'service'
                ? '📊 Mode service : regroupe toutes les lignes d\'un même service_name. Vue agrégée — ex: total de toutes les lignes "RISE-3" sur le mois.'
                : '🖥️ Mode référence : regroupe par référence OVH exacte (ex: ns31546254.ip-141-94-196.eu). Vue serveur précis — détecte si UN serveur spécifique a changé de coût.'
              }
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={runDetection}
              disabled={detecting}
              style={{
                padding: '13px 28px', borderRadius: 10,
                background: detecting ? T.bg : `linear-gradient(135deg, ${T.teal}, #0d9488)`,
                border: 'none', color: detecting ? T.muted : 'white',
                fontWeight: 700, fontSize: 14, cursor: detecting ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 9,
                boxShadow: detecting ? 'none' : `0 4px 14px ${T.teal}55`,
                transition: 'all .2s',
              }}
            >
              {detecting
                ? <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} />
                : <Brain size={15} />
              }
              Lancer Isolation Forest ML + MoM — Coûts
              {!detecting && (
                <span style={{ fontSize: 10, background: 'rgba(255,255,255,0.2)', borderRadius: 4, padding: '2px 7px' }}>
                  {momGroupBy === 'ref' ? '🖥️ par ref' : '📊 par service'}
                </span>
              )}
            </button>

            {detectingML && (
              <span style={{ fontSize: 11, color: T.teal, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: T.tealBg, borderRadius: 8, border: '1px solid #5eead4' }}>
                <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> {mlStep}
              </span>
            )}
            {lastMLRun && !detectingML && (
              <span style={{ fontSize: 11, color: T.muted, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Clock size={11} /> Dernière analyse : {fmtDateTime(lastMLRun)}
              </span>
            )}
          </div>

          {/* Architecture 3 signaux */}
          <div style={{ marginTop: 16, padding: '14px 16px', background: T.tealBg, borderRadius: 10, border: '1px solid #5eead4', fontSize: 11, color: '#134E4A', lineHeight: 1.8 }}>
            <Brain size={11} style={{ display: 'inline', marginRight: 6 }} />
            <strong>Architecture 3 signaux :</strong>
            <div style={{ marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ background: T.tealBg, border: '1px solid #5eead4', borderRadius: 6, padding: '4px 10px', fontSize: 11, color: T.teal, fontWeight: 700 }}>
                🤖 Signal 1 — Isolation Forest : outlier parmi tous les services (score &lt; -0.08)
              </span>
              <span style={{ background: T.greenBg, border: '1px solid #6ee7b7', borderRadius: 6, padding: '4px 10px', fontSize: 11, color: T.green, fontWeight: 700 }}>
                📊 Signal 2 — Peer Comparison : % vs moyenne inter-services (expected_value = mean de {anomalies.length > 0 ? `~${anomalies.length}` : 'N'} services)
              </span>
              <span style={{ background: T.orangeBg, border: `1px solid ${T.orange}44`, borderRadius: 6, padding: '4px 10px', fontSize: 11, color: T.orange, fontWeight: 700 }}>
                📅 Signal 3 — MoM : variation &gt; 50% vs mois précédent → surcoût exact
              </span>
            </div>
          </div>
        </div>

        {/* Filtres */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            placeholder="Rechercher par référence, service ou montant…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ padding: '9px 14px', borderRadius: 9, border: `1.5px solid ${T.border}`, fontSize: 13, minWidth: 280, fontFamily: 'inherit', outline: 'none' }}
          />
          <select value={sevFilter} onChange={e => setSevFilter(e.target.value)}
            style={{ padding: '9px 12px', borderRadius: 9, border: `1.5px solid ${T.border}`, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', background: 'white' }}>
            <option value="all">Toutes sévérités</option>
            <option value="critical">🔴 Critique</option>
            <option value="high">🟠 Élevée</option>
            <option value="medium">🟡 Moyenne</option>
            <option value="low">🔵 Faible</option>
          </select>
          <select value={signalFilter} onChange={e => setSignalFilter(e.target.value)}
            style={{ padding: '9px 12px', borderRadius: 9, border: `1.5px solid ${T.border}`, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', background: 'white' }}>
            <option value="all">Tous signaux</option>
            <option value="if">🤖 IF seulement</option>
            <option value="mom">📅 MoM seulement</option>
            <option value="both">🎯 IF + MoM</option>
          </select>
          <button
            onClick={() => setSortByScore(s => !s)}
            style={{ padding: '9px 13px', borderRadius: 9, border: `1.5px solid ${sortByScore ? T.teal : T.border}`, background: sortByScore ? T.tealBg : 'white', color: sortByScore ? T.teal : T.muted, fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}
          >
            <ArrowUpDown size={12} /> Trier par score IF
          </button>
          <div style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: T.muted, padding: '8px 14px', borderRadius: 9, background: T.bg, border: `1px solid ${T.border}` }}>
            {filtered.length} anomalie{filtered.length !== 1 ? 's' : ''} détectée{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Tableau */}
        <div style={{ background: 'white', borderRadius: 14, border: `1px solid ${T.border}`, overflow: 'hidden', boxShadow: '0 2px 14px rgba(0,0,0,0.05)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: T.bg, borderBottom: `2px solid ${T.border}` }}>
                {[
                  { label: 'Sévérité',             align: 'left'  },
                  { label: 'Référence & Service',  align: 'left'  },
                  { label: 'Coût Réel & Date',     align: 'left'  },
                  { label: 'Δ % MoM',              align: 'right', tip: 'Variation Month-over-Month' },
                  { label: 'Score IF',              align: 'right', sortable: true },
                  { label: 'Méthode',              align: 'left'  },
                  { label: 'Détecté le',           align: 'left'  },
                  { label: '',                     align: 'left'  },
                ].map(h => (
                  <th key={h.label}
                    onClick={h.sortable ? () => setSortByScore(s => !s) : undefined}
                    title={h.tip}
                    style={{ padding: '12px 14px', textAlign: h.align, fontSize: 10, fontWeight: 800, color: h.sortable && sortByScore ? T.teal : '#94a3b8', textTransform: 'uppercase', letterSpacing: '.08em', cursor: h.sortable ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap' }}
                  >
                    {h.label}
                    {h.sortable && <ArrowUpDown size={9} style={{ marginLeft: 3, verticalAlign: 'middle', opacity: .6 }} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>
                  <RefreshCw size={28} style={{ margin: '0 auto 12px', display: 'block', animation: 'spin 1s linear infinite', opacity: 0.3 }} />
                  <p>Chargement des anomalies…</p>
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 64, textAlign: 'center', color: '#94a3b8' }}>
                  <Brain size={48} style={{ margin: '0 auto 16px', display: 'block', opacity: 0.12 }} />
                  <p style={{ fontWeight: 800, fontSize: 15, color: '#374151', marginBottom: 6 }}>Aucune anomalie de coût détectée</p>
                  <p style={{ fontSize: 12 }}>Cliquez sur <strong>Lancer Isolation Forest ML + MoM — Coûts</strong> pour analyser toutes vos références.</p>
                </td></tr>
              )}
              {!loading && filtered.map(a => (
                <AnomalyRow key={a.id} anomaly={a} onDelete={handleDelete} />
              ))}
            </tbody>
          </table>
        </div>

        <style>{`
          @keyframes spin   { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        `}</style>
      </div>
    </Layout>
  );
}