// Anomalies.jsx — Détection d'Anomalies Budgétaires FinOps v9
// BUG FIX v9:
//   FIX 4 — Coût prorata : monthlyCost utilisait observed_value (=0€ pour COST_DROP)
//            FIX : monthlyCost = expected_value (coût réel mois précédent) si > 0
//            Résultat : les serveurs expirés affichent 18.38€, 58.34€... au lieu de 0€
//   FIX 5 — calcProrata : diviseur = prorataJours (période réelle OVH) au lieu de daysInMonth
// FIXES v8 :
//  FIX 1 — momMode : parsé depuis "_mom=service" ou "_mom=ref" dans threshold_type
//           (backend v7 encode toujours ce tag → "inconnu" disparaît)
//  FIX 2 — data_gap guard : si variation == -100% ET expected > 0 ET observed == 0
//           → card neutre "Données indisponibles" au lieu de "-100.0%"
//  FIX 3 — scope label : affiche "service global (toutes refs)" ou "référence exacte"
//           pour clarifier que observed et expected sont au même niveau d'agrégation
import { useState, useEffect, useMemo, useRef } from 'react';
import {
  AlertTriangle, AlertCircle, CheckCircle, Brain,
  RefreshCw, DollarSign, BarChart2,
  ChevronDown, ChevronUp, Trash2, ArrowUpDown,
  Clock, TrendingUp, TrendingDown, Minus, Zap,
  Calendar, Hash, ArrowRight, Server, FileText,
} from 'lucide-react';
import Layout from '../Layout/Layout';
import api from '../../services/api';
import toast from 'react-hot-toast';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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
const _r          = (v, d = 2) => v == null ? 0 : Math.round(v * 10 ** d) / 10 ** d;
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
// Supporte les deux formats backend :
//   "MoM: +12.34% (+56.78€, prev=100.00€ → cur=156.78€)"
//   "Hausse de 12.34% (+56.78€)"
function parseDesc(desc) {
  if (!desc) return {};

  // ref= dans la description (format "ref=ns31546254.ip-…")
  const refMatch = desc.match(/\bref=([^\s|,]+)/i);

  // MoM variation % — deux formats possibles
  const varPctMatch = desc.match(/MoM\s*:\s*([+-]?[\d.]+)%/i)
                   || desc.match(/hausse de ([+-]?[\d.]+)%/i);

  // Diff monetaire — entre parenthèses : (+56.78€)
  const diffMatch = desc.match(/MoM\s*:\s*[+-]?[\d.]+%\s*\(([+-]?[\d.]+)€/i)
                 || desc.match(/\(([+-]?[\d.]+)€\)/);

  // prev= et cur= dans la description (format backend v7)
  const prevMatch = desc.match(/prev=([\d.]+)€/i);
  const curMatch  = desc.match(/cur=([\d.]+)€/i);

  // Formats legacy (Mois précédent: / Mois courant:)
  const prevLegacy = desc.match(/Mois précédent\s*:\s*([\d.]+)€/i);
  const curLegacy  = desc.match(/(?:Mois courant|Courant)\s*:\s*([\d.]+)€/i);

  const overcostMatch = desc.match(/Surcoût\s*(?:MoM)?\s*:\s*\+?([\d.]+)€/i);
  const nMatch        = desc.match(/_n=(\d+)/i);

  return {
    ref:          refMatch      ? refMatch[1]                             : null,
    momVariation: varPctMatch   ? parseFloat(varPctMatch[1])             : null,
    momDiff:      diffMatch     ? parseFloat(diffMatch[1])               : null,
    previousCost: prevMatch     ? parseFloat(prevMatch[1])
                : prevLegacy    ? parseFloat(prevLegacy[1])              : null,
    currentCost:  curMatch      ? parseFloat(curMatch[1])
                : curLegacy     ? parseFloat(curLegacy[1])               : null,
    overcost:     overcostMatch ? parseFloat(overcostMatch[1])           : null,
    n:            nMatch        ? parseInt(nMatch[1])                    : null,
  };
}

// ─── FIX 1 — Parse momMode depuis threshold_type ──────────────────────────────
// Backend v7 encode : "if_score<-0.08_n=59_mom=service" ou "_mom=ref"
//                     "mom_service>50%"  ou  "mom_ref>50%"
function parseMomMode(tt) {
  if (!tt) return 'service';   // défaut sûr

  // Format IF v7 : _mom=service | _mom=ref
  const ifMomMatch = tt.match(/_mom=(service|ref)/i);
  if (ifMomMatch) return ifMomMatch[1];

  // Format MoM pur : mom_service>… | mom_ref>…
  if (tt.includes('mom_ref'))     return 'ref';
  if (tt.includes('mom_service')) return 'service';

  return 'service';   // fallback
}

// Parse variation + diff depuis threshold_type (MoM pur uniquement)
function parseMomFromThreshold(tt) {
  if (!tt) return null;
  if (tt.includes('_new_cost') || tt.includes('_cost_drop')) return null;
  const momMatch  = tt.match(/mom_(?:service|ref)>([\d.]+)%/);
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
  const isMom = tt.includes('mom_service') || tt.includes('mom_ref') ||
                mom?.variation != null ||
                parseDesc(anomaly.description).momVariation != null;
  return { isIF, isMom, mom };
}

// ─── FIX v9 — Data gap vs COST_DROP ─────────────────────────────────────────
// AVANT : observed==0 et expected>0 → toujours "Données manquantes" (FAUX)
// APRÈS :
//   • COST_DROP = service disparu (prev>0, cur=0, description = "Chute MoM")
//     → afficher "0.00€ — Service non facturé ce mois" avec la variation correcte
//   • DATA_GAP  = facture pas encore émise (début de mois seulement)
//     → afficher "⚠️ Mois courant vide"
function isDataGap(anomaly) {
  const desc = (anomaly.description || '').toLowerCase();
  if (desc.includes('chute mom') || desc.includes('cost_drop') || desc.includes('disappeared')) {
    return false;   // c'est un vrai COST_DROP, pas un gap de données
  }
  if (desc.includes('data_gap') || desc.includes('pas encore')) {
    return true;    // explicitement marqué data_gap par le backend
  }
  // Fallback : observed=0 uniquement en tout début de mois (≤ 5e jour)
  const det = anomaly.detected_at ? new Date(anomaly.detected_at) : null;
  const earlyMonth = det ? det.getDate() <= 5 : false;
  return (anomaly.observed_value ?? 0) === 0 && (anomaly.expected_value ?? 0) > 0 && earlyMonth;
}

// Vrai COST_DROP = service qui existait le mois dernier mais plus ce mois
function isCostDrop(anomaly) {
  const desc = (anomaly.description || '').toLowerCase();
  if (desc.includes('chute mom') || desc.includes('cost_drop')) return true;
  return (anomaly.observed_value ?? 0) === 0 && (anomaly.expected_value ?? 0) > 0 && !isDataGap(anomaly);
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

  if (isIF && expected != null) {
    const dir = observed > expected ? 'supérieur' : 'inférieur';
    parts.push(
      `[Signal 1 — IF] Score IF : ${score?.toFixed(4)} (seuil : -0.08). `
      + `Ce service a été isolé comme outlier. `
      + `Coût ce mois : ${fmtEuro(observed)} vs ${fmtEuro(expected)} le mois précédent `
      + `(${dir} de ${Math.abs(deviationPct ?? 0).toFixed(1)}%).`
    );
  } else if (isIF) {
    parts.push(
      `[Signal 1 — IF] Score IF : ${score?.toFixed(4)} (seuil : -0.08). `
      + `Ce service est outlier — aucun historique MoM disponible pour comparaison temporelle.`
    );
  }

  if (isMom) {
    const v  = parsed.momVariation ?? parseMomFromThreshold(anomaly.threshold_type)?.variation;
    const d  = parsed.momDiff ?? parseMomFromThreshold(anomaly.threshold_type)?.diff;
    if (v != null) {
      const sign = v >= 0 ? '+' : '';
      parts.push(
        `[Signal 2 — MoM] Coût ${v >= 0 ? 'en hausse' : 'en baisse'} de `
        + `${sign}${v.toFixed(1)}% vs le mois précédent`
        + (d != null ? ` (${sign}${d.toFixed(2)}€).` : '.')
      );
    }
  }

  return parts.join('\n\n') ||
    `Isolation Forest a détecté un profil budgétaire atypique. Score : ${score?.toFixed(4)}.`;
}

// ─── Conseil FinOps ───────────────────────────────────────────────────────────
function getAdvice(anomaly) {
  // NEW_COST — first billing month, no prior reference → dedicated advice
  const tt = anomaly.threshold_type ?? '';
  const isNewCost = tt.includes('_new_cost')
    || (anomaly.description ?? '').toLowerCase().includes('[nouveau coût]');
  if (isNewCost) {
    const cur = anomaly.observed_value ?? 0;
    return {
      text: `🆕 Nouveau service apparu ce mois (${fmtEuro(cur)}). `
          + `Vérifiez qu'il a été provisionné intentionnellement `
          + `et qu'il entre dans le budget prévu.`,
      color: T.blue,
      bg:    T.blueBg,
    };
  }

  const parsed       = parseDesc(anomaly.description);
  const observed     = anomaly.observed_value;
  const expected     = anomaly.expected_value;
  const deviationPct = expected && expected > 0
    ? ((observed - expected) / expected * 100) : null;
  const momVar       = parsed.momVariation ?? parseMomFromThreshold(anomaly.threshold_type)?.variation;

  if (momVar != null && momVar >= 100)
    return { text: `🚨 Forte hausse MoM : +${momVar.toFixed(0)}% vs le mois dernier. Vérifiez immédiatement : nouvelles ressources, auto-scaling, ou erreur de facturation.`, color: T.red, bg: T.redBg };
  if (momVar != null && momVar >= 50)
    return { text: `📈 Dérive budgétaire MoM : +${momVar.toFixed(0)}% vs mois dernier. Bloquez l'auto-scaling ou vérifiez les nouvelles ressources ajoutées récemment.`, color: T.orange, bg: T.orangeBg };
  if (deviationPct != null && deviationPct > 150)
    return { text: `🚨 Action urgente : ce service coûte plus du double du mois précédent. Vérifiez immédiatement s'il est actif et si ses options sont justifiées.`, color: T.red, bg: T.redBg };
  if (deviationPct != null && deviationPct > 75)
    return { text: `⚠️ Audit recommandé : ce service a augmenté de plus de 75% vs le mois dernier. Comparez avec des services équivalents et vérifiez la tendance sur 3 mois.`, color: T.orange, bg: T.orangeBg };
  return { text: `💡 Profil budgétaire atypique détecté. Surveillez l'évolution sur les prochaines périodes.`, color: T.teal, bg: T.tealBg };
}

// ─── CostInsightPanel ─────────────────────────────────────────────────────────
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

  // FIX 1 — momMode toujours résolu
  const momMode  = parseMomMode(anomaly.threshold_type);

  // FIX 3 — scope label clair
  const scopeLabel = momMode === 'ref'
    ? 'référence exacte'
    : 'service global (toutes refs)';

  const normalLabel = expected != null
    ? `Coût mois précédent — ${scopeLabel}`
    : null;

  // FIX v9 — distinguer data_gap vs cost_drop
  const dataGap  = isDataGap(anomaly);
  const costDrop = isCostDrop(anomaly);

  const nServices = anomaly.threshold_type?.match(/_n=(\d+)/)?.[1] ?? '?';

  // Prorata = mois précédent partiel → comparaison MoM non fiable
  // Supprimé pour NEW_COST : pas de comparaison MoM → warning prorata non pertinent
  const ttPanel    = anomaly.threshold_type ?? '';
  const isNewCostPanel = ttPanel.includes('_new_cost')
    || (anomaly.description ?? '').toLowerCase().includes('[nouveau coût]');
  const isProrata  = !isNewCostPanel && (
    (anomaly.entity_name ?? '').toLowerCase().includes('prorata')
    || (anomaly.description ?? '').toLowerCase().includes('prorata')
  );

  // Diff négligeable = faux positif IF basé sur volatilité historique
  const diffAbs = expected != null ? Math.abs(observed - expected) : null;
  const isNegligibleDiff = diffAbs != null && diffAbs < 2
    && Math.abs(deviationPct ?? 0) < 5;

  const ifExplain = isIF
    ? `Isolation Forest a entraîné des arbres de décision aléatoires sur ${nServices} services. `
      + `Les points normaux sont difficiles à isoler (ils ressemblent à leurs voisins). `
      + `Ce service a été isolé très rapidement → score très négatif (${score?.toFixed(4)}). `
      + `Double-gate appliqué : pred == -1 ET score < -0.08.`
    : null;

  return (
    <div style={{ marginTop: 10, background: 'white', border: `1px solid ${T.border}`, borderLeft: `4px solid ${sl.color}`, borderRadius: 10, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Brain size={14} color={T.teal} />
        <span style={{ fontSize: 11, fontWeight: 800, color: T.teal, textTransform: 'uppercase', letterSpacing: '.08em' }}>
          Analyse FinOps — {isIF && isMom ? 'IF + MoM' : isIF ? 'IF Seul' : 'MoM Temporal'}
        </span>
        <span style={{ padding: '2px 10px', borderRadius: 99, fontSize: 10, fontWeight: 700, background: sl.bg, color: sl.color, border: `1px solid ${sl.color}44` }}>
          {sl.emoji} {sl.label}
        </span>
        {isIF && (
          <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, background: T.tealBg, color: T.teal, border: '1px solid #5eead4' }}>
            🤖 IF
          </span>
        )}
        {isMom && !dataGap && (
          <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, background: T.orangeBg, color: T.orange, border: `1px solid ${T.orange}44` }}>
            {/* FIX 1 — momMode jamais "inconnu" */}
            📅 MoM {momMode === 'ref' ? '🖥️ ref' : '📊 service'}
          </span>
        )}
        {dataGap && (
          <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, background: T.amberBg, color: T.amber, border: `1px solid ${T.amber}44` }}>
            ⚠️ Données manquantes ce mois
          </span>
        )}
        {costDrop && !dataGap && (
          <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, background: T.redBg, color: T.red, border: `1px solid ${T.red}44` }}>
            📉 Chute de coût — service non facturé ce mois
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

        {/* Mois précédent — 4 cas : data gap / cost drop / valeur réelle / aucune */}
        {dataGap ? (
          <div style={{ background: T.amberBg, borderRadius: 10, padding: '14px 16px', border: `1px solid ${T.amber}44` }}>
            <p style={{ fontSize: 9, fontWeight: 800, color: T.amber, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>
              ⚠️ Données Manquantes
            </p>
            <p style={{ fontSize: 13, fontWeight: 700, color: T.amber, margin: 0 }}>Mois courant vide</p>
            <p style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>
              Facturation pas encore émise — mois précédent : {fmtEuro(expected)}
            </p>
          </div>
        ) : expected != null ? (
          <div style={{ background: T.greenBg, borderRadius: 10, padding: '14px 16px', border: '1px solid #6ee7b7' }}>
            <p style={{ fontSize: 9, fontWeight: 800, color: T.green, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>
              📅 Mois Précédent (Référence MoM)
            </p>
            <p style={{ fontSize: 24, fontWeight: 900, color: T.green, margin: 0 }}>{fmtEuro(expected)}</p>
            <p style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>
              {normalLabel}
              {costDrop && <span style={{ color: T.red, fontWeight: 700 }}> — absent ce mois</span>}
            </p>
          </div>
        ) : (
          <div style={{ background: T.bg, borderRadius: 10, padding: '14px 16px', border: `1px solid ${T.border}` }}>
            <p style={{ fontSize: 9, fontWeight: 800, color: T.muted, textTransform: 'uppercase' }}>
              📊 Référence Temporelle
            </p>
            <p style={{ fontSize: 13, fontWeight: 700, color: T.muted, margin: 0 }}>Non disponible</p>
            <p style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>
              IF a détecté via score seul — aucun historique MoM trouvé
            </p>
          </div>
        )}

        {/* Δ mois précédent → mois courant — carte unifiée, sans ratio % */}
        {expected != null && !dataGap && (
          (() => {
            const diff    = _r(observed - expected);
            const isUp    = diff >= 0;
            const acColor = isUp ? T.red   : T.green;
            const acBg    = isUp ? T.redBg : T.greenBg;
            const acBor   = isUp ? '#fca5a5' : '#6ee7b7';
            const scopeTip = momMode === 'ref' ? 'ref exacte' : 'service global';
            return (
              <div style={{ background: 'white', borderRadius: 10, padding: '14px 16px', border: `1px solid ${T.border}` }}>
                <p style={{ fontSize: 9, fontWeight: 800, color: T.muted, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>
                  📅 Évolution mois sur mois — {scopeTip}
                </p>
                {/* Ligne prev → cur */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1, background: T.bg, borderRadius: 8, padding: '8px 12px', textAlign: 'center', border: `1px solid ${T.border}` }}>
                    <p style={{ fontSize: 9, color: T.muted, margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '.05em' }}>Mois précédent</p>
                    <p style={{ fontSize: 16, fontWeight: 800, color: T.slate, margin: 0 }}>{fmtEuro(expected)}</p>
                  </div>
                  <div style={{ color: acColor, fontSize: 16, fontWeight: 800, lineHeight: 1 }}>→</div>
                  <div style={{ flex: 1, background: acBg, borderRadius: 8, padding: '8px 12px', textAlign: 'center', border: `1px solid ${acBor}` }}>
                    <p style={{ fontSize: 9, color: acColor, margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '.05em' }}>Mois courant</p>
                    <p style={{ fontSize: 16, fontWeight: 800, color: acColor, margin: 0 }}>{fmtEuro(observed)}</p>
                  </div>
                </div>
                {/* Diff € en gros */}
                <div style={{ background: acBg, borderRadius: 8, padding: '8px 14px', border: `1px solid ${acBor}`, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isUp
                    ? <TrendingUp   size={14} color={acColor} />
                    : <TrendingDown size={14} color={acColor} />
                  }
                  <span style={{ fontSize: 18, fontWeight: 900, color: acColor }}>
                    {diff >= 0 ? '+' : ''}{diff.toFixed(2)} €
                  </span>
                  <span style={{ fontSize: 11, color: acColor, opacity: 0.8 }}>
                    {isUp ? 'de plus' : 'de moins'} que le mois précédent
                  </span>
                </div>
              </div>
            );
          })()
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

      {/* Explication IF */}
      {isIF && ifExplain && (
        <div style={{ background: T.tealBg, border: '1px solid #5eead4', borderRadius: 8, padding: '13px 16px' }}>
          <p style={{ fontSize: 10, fontWeight: 800, color: T.teal, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>🤖 Comment IF a détecté cette anomalie ?</p>
          <p style={{ fontSize: 12, color: '#134E4A', lineHeight: 1.7, margin: 0 }}>{ifExplain}</p>
          {expected != null && !dataGap && (
            <div style={{ marginTop: 8, padding: '8px 12px', background: 'white', borderRadius: 6, border: '1px solid #5eead4' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: T.teal, margin: '0 0 4px' }}>
                📅 Référence temporelle utilisée — {scopeLabel}
              </p>
              <p style={{ fontSize: 11, color: '#134E4A', margin: 0, lineHeight: 1.6 }}>
                Coût mois précédent : <strong>{fmtEuro(expected)}</strong> → Ce mois : <strong>{fmtEuro(observed)}</strong>
                <br/>
                IF a détecté ce service comme outlier indépendamment de cette comparaison.
                Le mois précédent sert uniquement de repère temporel.
              </p>
            </div>
          )}
          {dataGap && (
            <div style={{ marginTop: 8, padding: '8px 12px', background: T.amberBg, borderRadius: 6, border: `1px solid ${T.amber}44` }}>
              <p style={{ fontSize: 11, color: T.amber, margin: 0 }}>
                ⚠️ Aucune donnée de facturation pour le mois courant — IF a détecté sur la base des données historiques.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Conseil FinOps */}
      {!dataGap && !costDrop && (
        <div style={{ background: advice.bg, border: `1px solid ${advice.color}44`, borderRadius: 8, padding: '13px 16px' }}>
          <p style={{ fontSize: 12, color: advice.color, fontWeight: 600, lineHeight: 1.6, margin: 0 }}>{advice.text}</p>
        </div>
      )}
      {costDrop && !dataGap && (
        <div style={{ background: T.redBg, border: `1px solid ${T.red}44`, borderRadius: 8, padding: '13px 16px' }}>
          <p style={{ fontSize: 12, color: T.red, fontWeight: 600, lineHeight: 1.6, margin: 0 }}>
            📉 Ce service était facturé le mois dernier ({fmtEuro(expected)}) mais n'apparaît pas ce mois.
            Vérifiez si la ressource a été résiliée, migrée, ou si la facture est en retard.
          </p>
        </div>
      )}
      {dataGap && (
        <div style={{ background: T.amberBg, border: `1px solid ${T.amber}44`, borderRadius: 8, padding: '13px 16px' }}>
          <p style={{ fontSize: 12, color: T.amber, fontWeight: 600, lineHeight: 1.6, margin: 0 }}>
            ⚠️ Mois courant sans données de facturation. Attendez la prochaine émission de facture avant d'agir.
          </p>
        </div>
      )}
      {/* Warning : variation négligeable — faux positif IF volatilité */}
      {isNegligibleDiff && !dataGap && !costDrop && (
        <div style={{ background: T.amberBg, border: `1px solid ${T.amber}44`, borderRadius: 8, padding: '13px 16px' }}>
          <p style={{ fontSize: 12, color: T.amber, fontWeight: 700, margin: '0 0 4px' }}>
            ⚠️ Variation négligeable ({fmtEuro(diffAbs)} de différence)
          </p>
          <p style={{ fontSize: 12, color: T.amber, lineHeight: 1.6, margin: 0 }}>
            IF a détecté ce service à cause de sa volatilité historique sur 90 jours,
            pas d'une vraie anomalie de coût ce mois. Le coût actuel est quasi-identique au mois précédent.
          </p>
        </div>
      )}

      {/* Warning : prorata — mois précédent partiel */}
      {isProrata && !dataGap && (
        <div style={{ background: T.amberBg, border: `1px solid ${T.amber}44`, borderRadius: 8, padding: '13px 16px' }}>
          <p style={{ fontSize: 12, color: T.amber, fontWeight: 700, margin: '0 0 4px' }}>
            ⚠️ Mois précédent = facturation prorata (partielle)
          </p>
          <p style={{ fontSize: 12, color: T.amber, lineHeight: 1.6, margin: 0 }}>
            La référence MoM correspond à une mise en service en cours de mois.
            La comparaison est biaisée — ce n'est probablement pas une vraie anomalie budgétaire.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Renewal helpers ─────────────────────────────────────────────────────────
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const now    = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

function renewalUrgency(days) {
  if (days == null) return { color: T.muted, bg: T.bg, border: T.border, label: '—', dot: T.muted };
  if (days <= 3)  return { color: T.red,    bg: T.redBg,    border: '#fca5a5', label: 'Urgent',   dot: T.red    };
  if (days <= 7)  return { color: T.orange, bg: T.orangeBg, border: `${T.orange}66`, label: 'Proche',  dot: T.orange };
  if (days <= 30) return { color: T.amber,  bg: T.amberBg,  border: `${T.amber}55`,  label: 'Planifier', dot: T.amber  };
  return               { color: T.green,  bg: T.greenBg,  border: '#6ee7b7',    label: 'OK',       dot: T.green  };
}

// Prorata = montant mensuel × (jours restants dans le mois / jours totaux dans le mois)
function prorataAmount(monthlyCost, renewalDateStr) {
  if (!monthlyCost || !renewalDateStr) return null;
  const renewal = new Date(renewalDateStr);
  const today   = new Date();
  const daysLeft = daysUntil(renewalDateStr);
  if (daysLeft == null || daysLeft < 0) return null;
  // Days in the current billing month
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return (monthlyCost / daysInMonth) * daysLeft;
}

// ─── RenewalRow ───────────────────────────────────────────────────────────────
function RenewalRow({ server }) {
  const days      = daysUntil(server.renewal_date || server.engagement_end_date || server.next_renewal);
  const urg       = renewalUrgency(days);
  const monthly   = server.price || server.monthly_price || server.cost;
  const prorata   = prorataAmount(monthly, server.renewal_date || server.engagement_end_date || server.next_renewal);
  const ref       = server.reference || server.ref || server.hostname || server.name || `REF-${server.id}`;
  const type      = server.type || server.server_type || 'Serveur';
  const renewDate = server.renewal_date || server.engagement_end_date || server.next_renewal;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '13px 16px',
      borderRadius: 10,
      border: `1.5px solid ${urg.border}`,
      background: days != null && days <= 7 ? urg.bg : 'white',
      transition: 'all .15s',
    }}>
      {/* Urgency dot + days badge */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 52, flexShrink: 0 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: urg.bg, border: `2px solid ${urg.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column',
        }}>
          <span style={{ fontSize: 15, fontWeight: 900, color: urg.color, lineHeight: 1 }}>
            {days != null ? days : '—'}
          </span>
          <span style={{ fontSize: 8, color: urg.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            {days === 1 ? 'jour' : 'jours'}
          </span>
        </div>
        <span style={{ fontSize: 9, fontWeight: 800, color: urg.color, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          {urg.label}
        </span>
      </div>

      {/* Server info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: T.slate, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", letterSpacing: '0.02em', wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: 5 }}>
          <Server size={10} color={T.teal} />
          {ref}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: T.muted, display: 'flex', alignItems: 'center', gap: 3 }}>
            <Calendar size={9} /> Renouvellement : <strong style={{ color: T.slate }}>{fmtDate(renewDate)}</strong>
          </span>
          {type && (
            <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 99, background: T.tealBg, color: T.teal, fontWeight: 700, border: '1px solid #5eead4' }}>
              {type}
            </span>
          )}
        </div>
      </div>

      {/* Cost + prorata */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        {monthly != null && (
          <span style={{ fontSize: 15, fontWeight: 900, color: T.slate }}>
            {Number(monthly).toFixed(2)}<span style={{ fontSize: 10, color: T.muted, fontWeight: 400 }}> €/mois</span>
          </span>
        )}
        {prorata != null && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
            <span style={{ fontSize: 9, color: T.muted, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em' }}>
              Prorata ({days}j)
            </span>
            <span style={{ fontSize: 12, fontWeight: 800, color: urg.color, background: urg.bg, border: `1px solid ${urg.border}`, borderRadius: 6, padding: '2px 8px' }}>
              ≈ {prorata.toFixed(2)} €
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── parseRenewalInfo ─────────────────────────────────────────────────────────
// Parses prorata billing info from anomaly entity_name + description.
// entity_name format (OVH): "RISE-S-2 | AMD RYZEN 7 9700x au prorata : 16 jours (01/04/2026-16/04/2026)"
// IMPORTANT: backend used to truncate at 60 chars (now fixed to 120 in ml_anomaly_service.py).
// We handle both cases with multiple fallback strategies.
function parseRenewalInfo(anomaly) {
  const entityName  = anomaly.entity_name  ?? '';
  const description = anomaly.description  ?? '';

  if (!/prorata/i.test(entityName)) return null;

  // "au prorata : 16 jours" or "prorata : 11 jours"
  const joursMatch   = entityName.match(/prorata\s*:\s*(\d+)\s*jours/i);
  const prorataJours = joursMatch ? parseInt(joursMatch[1], 10) : null;

  // Full range "(01/04/2026-16/04/2026)" — present when entity_name is long enough
  const rangeMatch   = entityName.match(/\((\d{2}\/\d{2}\/\d{4})-(\d{2}\/\d{2}\/\d{4})\)/);

  // Partial start only — entity_name was truncated: "(01/04/2026" without closing paren+end date
  const partialStart = !rangeMatch ? entityName.match(/\((\d{2}\/\d{2}\/\d{4})/) : null;

  const prorataRange = rangeMatch ? `${rangeMatch[1]}-${rangeMatch[2]}` : null;

  let engagementEndDate = null;

  // a) description: "Date de fin d'engagement : 17/04/2026"
  const descEnd = description.match(/fin\s+d['\u2019']engagement\s*:\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (descEnd) {
    const [d, m, y] = descEnd[1].split('/');
    engagementEndDate = new Date(`${y}-${m}-${d}`);
  }

  // b) full date range — use end date directly
  if (!engagementEndDate && rangeMatch) {
    const [d, m, y] = rangeMatch[2].split('/');
    engagementEndDate = new Date(`${y}-${m}-${d}`);
  }

  // c) partial start + prorataJours → end = start + N days
  if (!engagementEndDate && partialStart && prorataJours) {
    const [d, m, y] = partialStart[1].split('/');
    const start = new Date(`${y}-${m}-${d}`);
    start.setHours(0, 0, 0, 0);
    engagementEndDate = new Date(start.getTime() + prorataJours * 86400000);
  }

  // d) billing date (detected_at) = start of prorata period → end = detected_at + N days
  if (!engagementEndDate && prorataJours && anomaly.detected_at) {
    const billingStart = new Date(anomaly.detected_at);
    billingStart.setHours(0, 0, 0, 0);
    engagementEndDate = new Date(billingStart.getTime() + prorataJours * 86400000);
  }

  // Days from today to engagement end (negative = already expired)
  let daysUntilEnd = null;
  if (engagementEndDate) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const end = new Date(engagementEndDate); end.setHours(0, 0, 0, 0);
    daysUntilEnd = Math.round((end - now) / 86400000);
  }

  // Service label = everything before "au prorata" / "prorata"
  const labelMatch   = entityName.match(/^(.*?)\s+(?:au\s+)?prorata/i);
  const serviceLabel = labelMatch ? labelMatch[1].trim() : entityName;

  // BUG FIX: For prorata servers detected via COST_DROP (observed=0, expected=real cost),
  // the monthly cost reference must be expected_value (last known billing = real monthly rate).
  // observed_value is 0.00€ when the service disappeared → always produces 0.00 €/mois.
  // Priority: expected_value (prev month real cost) > observed_value (only if > 0) > null
  const observed = anomaly.observed_value ?? 0;
  const expected = anomaly.expected_value ?? null;
  const monthlyCost = (expected != null && expected > 0)
    ? expected
    : (observed > 0 ? observed : null);

  return {
    isProrataServer: true,
    prorataJours,
    prorataRange,
    engagementEndDate,
    daysUntilEnd,
    monthlyCost,
    serviceLabel,
  };
}
// ─── AnomalyRenewalPanel ──────────────────────────────────────────────────────
function AnomalyRenewalPanel({ anomalies }) {
  const [horizon,   setHorizon]   = useState(30);
  const [collapsed, setCollapsed] = useState(false);
  const [sortBy,    setSortBy]    = useState('urgency'); // 'urgency' | 'cost'

  const today       = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

  // FIX 3: contextual, non-aggressive action wording
  // FIX 2: countdown field replaces the large text — never repeats the badge label
  const urgStyle = days =>
    days <  0  ? { color: T.red,    bg: T.redBg,    border: '#fca5a5',       dot: '#DC2626', label: 'Expiré',    countdown: `+${Math.abs(days)}j`,  action: '🔍 Vérifier ressource',   actionBg: '#FFF1F2', actionColor: '#9B1C1C' } :
    days <= 3  ? { color: T.red,    bg: T.redBg,    border: '#fca5a5',       dot: '#DC2626', label: 'Urgent',    countdown: `J-${days}`,             action: '🔔 Planifier maintenant', actionBg: T.redBg,   actionColor: T.red    } :
    days <= 7  ? { color: T.orange, bg: T.orangeBg, border: `${T.orange}66`, dot: '#EA580C', label: 'Proche',    countdown: `J-${days}`,             action: '📅 Renouveler / Résilier',actionBg: '#FFF7ED', actionColor: T.orange } :
    days <= 30 ? { color: T.amber,  bg: T.amberBg,  border: `${T.amber}55`,  dot: '#B45309', label: 'Planifier', countdown: `J-${days}`,             action: '📋 À programmer',         actionBg: T.amberBg,  actionColor: T.amber  } :
                 { color: T.green,  bg: T.greenBg,  border: '#6ee7b7',       dot: '#059669', label: 'OK',        countdown: `J-${days}`,             action: '✅ Sous contrôle',        actionBg: T.greenBg,  actionColor: T.green  };

  const endFmt = d => d
    ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    : '—';

  // FIX: for expired prorata servers, show monthly cost instead of 0
  // Use prorataJours (actual billing days) as divisor when available
  const calcProrata = (monthlyCost, daysLeft, prorataJours) => {
    if (!monthlyCost || daysLeft == null || daysLeft < 0) return null;
    const divisor = prorataJours && prorataJours > 0 ? prorataJours : daysInMonth;
    return (monthlyCost / divisor) * daysLeft;
  };

  // Bonus: cost impact tag based on prorata amount
  const costImpactTag = prorata => {
    if (prorata == null || prorata < 50) return null;
    if (prorata >= 200) return { label: '💰 Impact élevé',  color: T.red,    bg: '#FFF1F2',  border: '#fca5a5'        };
    if (prorata >= 100) return { label: '💰 Impact moyen',  color: T.orange, bg: T.orangeBg, border: `${T.orange}44`  };
    return                   { label: '💰 Impact faible', color: T.amber,  bg: T.amberBg,  border: `${T.amber}44`   };
  };

  // FIX 1: separate expired (always shown) from upcoming (filtered by horizon)
  const { upcomingItems, expiredItems } = useMemo(() => {
    const parsed = anomalies
      .map(a => ({ anomaly: a, info: parseRenewalInfo(a) }))
      .filter(({ info }) => info !== null && info.daysUntilEnd != null);

    const calcP = info =>
      info.monthlyCost && info.daysUntilEnd >= 0
        ? (info.monthlyCost / (info.prorataJours || daysInMonth)) * info.daysUntilEnd
        : 0;

    const upcoming = parsed
      .filter(({ info }) => info.daysUntilEnd >= 0 && info.daysUntilEnd <= horizon);

    upcoming.sort(sortBy === 'cost'
      ? (a, b) => calcP(b.info) - calcP(a.info)
      : (a, b) => a.info.daysUntilEnd - b.info.daysUntilEnd
    );

    const expired = parsed
      .filter(({ info }) => info.daysUntilEnd < 0)
      .sort((a, b) => b.info.daysUntilEnd - a.info.daysUntilEnd);

    return { upcomingItems: upcoming, expiredItems: expired };
  }, [anomalies, horizon, sortBy, daysInMonth]);

  const urgent     = upcomingItems.filter(({ info }) => info.daysUntilEnd <= 3).length;
  const hasExpired = expiredItems.length > 0;
  const totalItems = upcomingItems.length + expiredItems.length;

  // Row renderer (plain function, no hooks — safe to call inside map)
  const renderRow = ({ anomaly, info }, rowKey) => {
    const urg       = urgStyle(info.daysUntilEnd);
    const prorata   = calcProrata(info.monthlyCost, info.daysUntilEnd, info.prorataJours);
    const impact    = costImpactTag(prorata ?? info.monthlyCost);
    const rangeDisp = info.prorataRange ? info.prorataRange.replace('-', ' → ') : null;

    return (
      <tr
        key={rowKey}
        style={{ borderBottom: `1px solid ${T.border}`, transition: 'background .12s' }}
        onMouseEnter={e => e.currentTarget.style.background = '#F8FDFC'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {/* Statut — FIX 2: badge shows label, countdown shows J-N or +Nj (never duplicates "Expiré") */}
        <td style={{ padding: '13px 16px', whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 800, background: urg.bg, color: urg.color, border: `1.5px solid ${urg.border}` }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: urg.dot, flexShrink: 0 }} />
              {urg.label}
            </span>
            <span style={{ fontSize: 19, fontWeight: 900, color: urg.color, fontFamily: 'monospace', letterSpacing: '-0.02em' }}>
              {urg.countdown}
            </span>
            {info.daysUntilEnd < 0 && (
              <span style={{ fontSize: 9, color: '#9B1C1C', fontWeight: 700, letterSpacing: '.04em' }}>
                expiré depuis {Math.abs(info.daysUntilEnd)}j
              </span>
            )}
          </div>
        </td>

        {/* Serveur / Service */}
        <td style={{ padding: '13px 16px', maxWidth: 240 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: T.slate, fontFamily: "'JetBrains Mono','Fira Code',monospace", letterSpacing: '0.02em', wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Server size={10} color={T.teal} />
            {info.serviceLabel}
          </div>
          {anomaly.entity_name && anomaly.entity_name !== info.serviceLabel && (
            <div style={{ fontSize: 10, color: T.muted, marginTop: 3, wordBreak: 'break-all', paddingLeft: 15 }}>
              {anomaly.entity_name}
            </div>
          )}
          {impact && (
            <span style={{ display: 'inline-block', marginTop: 5, fontSize: 9, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: impact.bg, color: impact.color, border: `1px solid ${impact.border}` }}>
              {impact.label}
            </span>
          )}
        </td>

        {/* Période prorata */}
        <td style={{ padding: '13px 16px', textAlign: 'center' }}>
          {rangeDisp ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: T.tealBg, color: T.teal, border: '1px solid #5eead4', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
              <ArrowRight size={9} />
              {rangeDisp}
            </span>
          ) : info.prorataJours ? (
            <span style={{ fontSize: 12, color: T.muted, fontWeight: 600 }}>{info.prorataJours} jours</span>
          ) : (
            <span style={{ color: T.muted, fontSize: 12 }}>—</span>
          )}
        </td>

        {/* Fin d'engagement */}
        <td style={{ padding: '13px 16px', textAlign: 'center' }}>
          {info.engagementEndDate ? (
            <span style={{ fontSize: 12, fontWeight: 800, color: urg.color, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Calendar size={11} color={urg.color} />
              {endFmt(info.engagementEndDate)}
            </span>
          ) : (
            <span style={{ color: T.muted, fontSize: 12 }}>—</span>
          )}
        </td>

       

        {/* Coût prorata */}
        <td style={{ padding: '13px 16px', textAlign: 'right' }}>
          {prorata != null ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 900, color: T.slate }}>
                ≈ {prorata.toFixed(2)}<span style={{ fontSize: 11, color: T.muted, fontWeight: 400 }}> €</span>
              </span>
              {info.monthlyCost != null && (
                <span style={{ fontSize: 10, color: T.muted }}>
                  {Number(info.monthlyCost).toFixed(2)} €/mois × {info.prorataJours ?? '?'}j/{info.prorataJours || daysInMonth}j
                </span>
              )}
            </div>
          ) : info.monthlyCost != null ? (
            <span style={{ fontSize: 14, fontWeight: 800, color: T.slate }}>
              {Number(info.monthlyCost).toFixed(2)}<span style={{ fontSize: 11, color: T.muted, fontWeight: 400 }}> €/mois</span>
            </span>
          ) : (
            <span style={{ color: T.muted, fontSize: 12 }}>—</span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div style={{ background: 'white', borderRadius: 14, border: `1.5px solid ${urgent > 0 || hasExpired ? '#fca5a5' : T.border}`, marginBottom: 22, overflow: 'hidden', boxShadow: urgent > 0 ? `0 4px 20px ${T.red}1a` : '0 2px 10px rgba(0,0,0,0.05)' }}>

      {/* Header */}
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{ padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', background: urgent > 0 || hasExpired ? T.redBg : T.bg, borderBottom: collapsed ? 'none' : `1px solid ${T.border}` }}
      >
        <div style={{ width: 38, height: 38, borderRadius: 10, background: urgent > 0 || hasExpired ? T.red : T.amber, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 3px 10px ${urgent > 0 || hasExpired ? T.red : T.amber}44`, flexShrink: 0 }}>
          <Clock size={18} color="white" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 14, fontWeight: 900, color: T.slate, margin: 0 }}>
              Fins d&apos;engagement à venir
            </h2>
            {upcomingItems.length > 0 && (
              <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 10px', borderRadius: 99, background: urgent > 0 ? T.red : T.amber, color: 'white' }}>
                {upcomingItems.length} à venir
              </span>
            )}
            {urgent > 0 && (
              <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 10px', borderRadius: 99, background: T.redBg, color: T.red, border: '1px solid #fca5a5' }}>
                🔔 {urgent} urgent{urgent > 1 ? 's' : ''}
              </span>
            )}
            {hasExpired && (
              <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 10px', borderRadius: 99, background: T.redBg, color: T.red, border: '1px solid #fca5a5' }}>
                ⚠️ {expiredItems.length} expiré{expiredItems.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p style={{ fontSize: 11, color: T.muted, margin: '3px 0 0' }}>
            Serveurs facturés au prorata — fins d&apos;engagement détectées depuis les anomalies MoM
          </p>
        </div>

        {/* FIX 1: stopPropagation on each button prevents header collapse toggle */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
          <span style={{ fontSize: 10, color: T.muted, fontWeight: 600, marginRight: 2 }}>Horizon :</span>
          {[7, 14, 30, 60, 90].map(d => (
            <button
              key={d}
              onClick={e => { e.stopPropagation(); setHorizon(d); }}
              style={{ padding: '5px 10px', borderRadius: 7, border: `1.5px solid ${horizon === d ? T.teal : T.border}`, background: horizon === d ? T.tealBg : 'white', color: horizon === d ? T.teal : T.muted, fontWeight: 700, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}
            >
              {d}j
            </button>
          ))}
          {/* Bonus: sort toggle */}
          <button
            onClick={e => { e.stopPropagation(); setSortBy(s => s === 'urgency' ? 'cost' : 'urgency'); }}
            title={sortBy === 'cost' ? 'Trier par urgence' : 'Trier par impact coût'}
            style={{ padding: '5px 10px', borderRadius: 7, border: `1.5px solid ${sortBy === 'cost' ? T.purple : T.border}`, background: sortBy === 'cost' ? T.purpleBg : 'white', color: sortBy === 'cost' ? T.purple : T.muted, fontWeight: 700, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4, transition: 'all .15s' }}
          >
            <ArrowUpDown size={10} /> {sortBy === 'cost' ? '€ Impact' : 'Urgence'}
          </button>
        </div>

        <div style={{ color: T.muted, marginLeft: 4 }}>
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </div>
      </div>

      {!collapsed && (
        <>
          {totalItems === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 0', color: T.muted }}>
              <Clock size={28} color={T.border} style={{ display: 'block', margin: '0 auto 10px' }} />
              <p style={{ fontWeight: 700, color: '#374151', marginBottom: 4 }}>
                Aucune fin d&apos;engagement dans les {horizon} prochains jours
              </p>
              <p style={{ fontSize: 12 }}>Les renouvellements détectés via anomalies MoM apparaîtront ici.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: T.bg, borderBottom: `2px solid ${T.border}` }}>
                    {[
                      { label: 'Statut',            align: 'left',   tip: "Urgence selon le délai restant avant fin d'engagement" },
                      { label: 'Serveur / Service', align: 'left',   tip: 'Label du service facturé et référence OVH complète' },
                      { label: 'Période prorata',   align: 'center', tip: 'Plage de facturation au prorata. Appliqué quand le service démarre en cours de mois.' },
                      { label: "Fin d'engagement",  align: 'center', tip: 'Date limite — à renouveler ou résilier avant cette échéance' },
                      { label: 'Coût prorata',      align: 'right',  tip: 'Estimation coût = mensuel × jours restants ÷ jours dans le mois' },
                    ].map(h => (
                      <th key={h.label} title={h.tip}
                        style={{ padding: '11px 16px', textAlign: h.align, fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.08em', whiteSpace: 'nowrap', cursor: 'help' }}>
                        {h.label} <span style={{ fontSize: 9, opacity: 0.5 }}>ⓘ</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Upcoming section */}
                  {upcomingItems.length > 0 && expiredItems.length > 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: '5px 16px', background: '#F1F5F9', borderBottom: `1px solid ${T.border}` }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: T.muted, textTransform: 'uppercase', letterSpacing: '.1em' }}>
                          À venir — {upcomingItems.length} engagement{upcomingItems.length > 1 ? 's' : ''} dans les {horizon}j
                        </span>
                      </td>
                    </tr>
                  )}
                  {upcomingItems.map((item, i) => renderRow(item, `up-${item.anomaly.id ?? i}`))}

                  {/* Expired section — always shown regardless of horizon */}
                  {expiredItems.length > 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: '5px 16px', background: '#FFF1F2', borderBottom: `1px solid #fca5a5`, borderTop: `2px solid ${T.border}` }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: T.red, textTransform: 'uppercase', letterSpacing: '.1em' }}>
                          ⚠️ Expirés — {expiredItems.length} engagement{expiredItems.length > 1 ? 's' : ''} à vérifier
                        </span>
                      </td>
                    </tr>
                  )}
                  {expiredItems.map((item, i) => renderRow(item, `exp-${item.anomaly.id ?? i}`))}
                </tbody>
              </table>

              {/* Footer */}
              <div style={{ padding: '10px 22px', borderTop: `1px solid ${T.border}`, background: T.bg, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {[
                  { label: 'Expiré',         color: T.red,    bg: T.redBg,    border: '#fca5a5'       },
                  { label: 'Urgent ≤3j',     color: T.red,    bg: T.redBg,    border: '#fca5a5'       },
                  { label: 'Proche ≤7j',     color: T.orange, bg: T.orangeBg, border: `${T.orange}66` },
                  { label: 'Planifier ≤30j', color: T.amber,  bg: T.amberBg,  border: `${T.amber}55`  },
                  { label: 'OK',             color: T.green,  bg: T.greenBg,  border: '#6ee7b7'       },
                ].map(l => (
                  <span key={l.label} style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: l.bg, color: l.color, border: `1px solid ${l.border}` }}>
                    {l.label}
                  </span>
                ))}
                <span style={{ fontSize: 10, color: T.muted, marginLeft: 'auto', fontStyle: 'italic' }}>
                  Prorata = mensuel × jours restants / jours de la période prorata (ou du mois) · Expirés : coût mensuel affiché (plus de jours restants)
                </span>
              </div>
            </div>
          )}
        </>
      )}
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
function MomBadge({ variation, diff, dataGap, observed, expected }) {
  if (dataGap) return (
    <span style={{ fontSize: 10, color: T.amber, fontStyle: 'italic' }}>⚠️ vide</span>
  );
  // Diff € = priorité sur variation %
  const diffEur = diff != null
    ? diff
    : (observed != null && expected != null ? observed - expected : null);

  if (diffEur == null && variation == null) return <Minus size={11} color={T.muted} />;

  // Variation négligeable → stable
  const absDiff = Math.abs(diffEur ?? 0);
  const absPct  = Math.abs(variation ?? 0);
  if (absDiff < 2 && absPct < 5) return (
    <span style={{ fontSize: 10, color: T.muted, fontStyle: 'italic' }}>stable</span>
  );

  const isUp  = (diffEur ?? variation ?? 0) > 0;
  const color = isUp ? T.red : T.green;
  const bg    = isUp ? T.redBg : T.greenBg;
  const Icon  = isUp ? TrendingUp : TrendingDown;
  const sign  = isUp ? '+' : '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 800, background: bg, color, border: `1px solid ${color}33` }}>
        <Icon size={9} /> {sign}{(diffEur ?? 0).toFixed(2)} €
      </span>
    </div>
  );
}

// ─── AnomalyRow ───────────────────────────────────────────────────────────────
function AnomalyRow({ anomaly, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const sev       = SEV[anomaly.severity] || SEV.low;
  const SIcon     = sev.icon;
  const sl        = scoreLevel(anomaly.anomaly_score);
  const refCode   = resolveRef(anomaly);
  const { isIF, isMom } = anomalySignals(anomaly);
  const parsed    = parseDesc(anomaly.description);
  const tt        = anomaly.threshold_type ?? '';
  const momFromTt = parseMomFromThreshold(tt);
  const momVar    = parsed.momVariation ?? momFromTt?.variation;
  const momDiff   = parsed.momDiff      ?? momFromTt?.diff;
  const dataGap   = isDataGap(anomaly);

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
            {isIF    && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: T.tealBg,   color: T.teal,   border: '1px solid #5eead4' }}>🤖 IF</span>}
            {isMom   && !dataGap && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: T.orangeBg, color: T.orange, border: `1px solid ${T.orange}44` }}>📅 MoM</span>}
            {dataGap && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: T.amberBg,  color: T.amber,  border: `1px solid ${T.amber}44` }}>⚠️ vide</span>}
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

        {/* Δ MoM — FIX 2 : badge neutre si data gap */}
        <td style={{ padding: '14px 12px', textAlign: 'right', minWidth: 100 }}>
          <MomBadge variation={momVar} diff={momDiff} dataGap={dataGap} observed={anomaly.observed_value} expected={anomaly.expected_value} />
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
            {isIF  && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: T.tealBg,   color: T.teal,   border: '1px solid #5eead4'     }}><Brain    size={9} /> Isolation Forest</span>}
            {isMom && !dataGap && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: T.orangeBg, color: T.orange, border: `1px solid ${T.orange}44` }}><Calendar size={9} /> MoM Temporal</span>}
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

// ─── PDF Export ───────────────────────────────────────────────────────────────
function exportPDF({ filtered, anomalies, lastMLRun, momGroupBy }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fileDate = now.toISOString().slice(0, 10);

  const TEAL   = [15, 118, 110];
  const SLATE  = [30, 41, 59];
  const MUTED  = [100, 116, 139];
  const RED    = [220, 38,  38];
  const ORANGE = [234, 88,  12];
  const AMBER  = [180, 83,  9];
  const BLUE   = [29,  78, 216];
  const GREEN  = [5,  150, 105];
  const WHITE  = [255, 255, 255];
  const BG     = [248, 250, 252];
  const BORDER = [226, 232, 240];

  const sevColor = sev => ({
    critical: RED, high: ORANGE, medium: AMBER, low: BLUE,
  }[sev] || MUTED);

  const sevLabel = sev => ({
    critical: 'Critique', high: 'Élevée', medium: 'Moyenne', low: 'Faible',
  }[sev] || sev);

  const addFooter = (pageNum, totalPages) => {
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'normal');
    const footer = `FinOps Anomaly Report — Confidentiel — Généré le ${dateStr}`;
    doc.text(footer, W / 2, H - 6, { align: 'center' });
    doc.text(`${pageNum} / ${totalPages}`, W - 14, H - 6, { align: 'right' });
    doc.setDrawColor(...BORDER);
    doc.line(14, H - 10, W - 14, H - 10);
  };

  // ── PAGE 1 : Couverture ──────────────────────────────────────────────────
  // Hero banner
  doc.setFillColor(...TEAL);
  doc.rect(0, 0, W, 52, 'F');

  // Accent stripe
  doc.setFillColor(13, 148, 136);
  doc.rect(0, 48, W, 4, 'F');

  // Logo block
  doc.setFillColor(255, 255, 255, 0.15);
  doc.roundedRect(14, 8, 34, 34, 4, 4, 'F');
  doc.setFontSize(20);
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.text('FO', 31, 30, { align: 'center' });

  // Title
  doc.setFontSize(22);
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.text('Rapport de Détection d\'Anomalies Budgétaires', 56, 22);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text('FinOps — Isolation Forest ML + Month-over-Month', 56, 32);
  doc.setFontSize(9);
  doc.setTextColor(204, 251, 241);
  doc.text(`Généré le ${dateStr}`, 56, 42);

  // Classification badge
  doc.setFillColor(220, 38, 38);
  doc.roundedRect(W - 50, 14, 36, 10, 2, 2, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...WHITE);
  doc.text('CONFIDENTIEL', W - 32, 20, { align: 'center' });

  // ── KPI cards ──────────────────────────────────────────────────────────
  const critCount = anomalies.filter(a => a.severity === 'critical').length;
  const highCount = anomalies.filter(a => a.severity === 'high').length;
  const medCount  = anomalies.filter(a => a.severity === 'medium').length;
  const lowCount  = anomalies.filter(a => a.severity === 'low').length;
  const ifCount   = anomalies.filter(a => anomalySignals(a).isIF).length;
  const momCount  = anomalies.filter(a => anomalySignals(a).isMom).length;
  const bothCount = anomalies.filter(a => { const s = anomalySignals(a); return s.isIF && s.isMom; }).length;
  const surcouttotalMom = anomalies.reduce((sum, a) => {
    const { isMom } = anomalySignals(a);
    if (!isMom || isDataGap(a)) return sum;
    const parsed = parseDesc(a.description);
    const oc = parsed.momDiff != null && parsed.momDiff > 0 ? parsed.momDiff : 0;
    return sum + oc;
  }, 0);

  const kpis = [
    { label: 'Total anomalies',   value: String(anomalies.length),  color: TEAL  },
    { label: 'Critique',          value: String(critCount),          color: RED   },
    { label: 'Élevée',            value: String(highCount),          color: ORANGE},
    { label: 'Signal IF',         value: String(ifCount),            color: TEAL  },
    { label: 'Signal MoM',        value: String(momCount),           color: ORANGE},
    { label: 'Surcoût MoM cumulé',value: surcouttotalMom > 0 ? `+${surcouttotalMom.toFixed(0)} EUR` : '0 EUR', color: surcouttotalMom > 0 ? RED : GREEN },
  ];

  const cardW = (W - 28 - 10 * 5) / 6;
  kpis.forEach((k, i) => {
    const x = 14 + i * (cardW + 10);
    doc.setFillColor(...WHITE);
    doc.setDrawColor(...k.color);
    doc.roundedRect(x, 60, cardW, 28, 3, 3, 'FD');
    doc.setFillColor(...k.color);
    doc.rect(x, 60, cardW, 3, 'F');
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...k.color);
    doc.text(k.value, x + cardW / 2, 78, { align: 'center' });
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    doc.text(k.label, x + cardW / 2, 84, { align: 'center' });
  });

  // ── Severity breakdown bar ──────────────────────────────────────────────
  const barY = 100;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...SLATE);
  doc.text('Répartition par sévérité', 14, barY);

  const sevData = [
    { label: 'Critique', count: critCount, color: RED    },
    { label: 'Élevée',   count: highCount, color: ORANGE },
    { label: 'Moyenne',  count: medCount,  color: AMBER  },
    { label: 'Faible',   count: lowCount,  color: BLUE   },
  ];
  const barTotalW = W - 28;
  const total = anomalies.length || 1;
  let barX = 14;
  sevData.forEach(s => {
    const w = Math.max((s.count / total) * barTotalW, s.count > 0 ? 2 : 0);
    doc.setFillColor(...s.color);
    doc.roundedRect(barX, barY + 4, w, 7, 1, 1, 'F');
    barX += w;
  });

  // Legend
  let legX = 14;
  sevData.forEach(s => {
    doc.setFillColor(...s.color);
    doc.roundedRect(legX, barY + 15, 10, 5, 1, 1, 'F');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`${s.label} (${s.count})`, legX + 12, barY + 19.5);
    legX += 52;
  });

  // ── Methodology section ─────────────────────────────────────────────────
  const methY = 128;
  doc.setFillColor(...BG);
  doc.setDrawColor(...BORDER);
  doc.roundedRect(14, methY, W - 28, 48, 3, 3, 'FD');
  doc.setFillColor(...TEAL);
  doc.roundedRect(14, methY, W - 28, 8, 3, 3, 'F');
  doc.rect(14, methY + 5, W - 28, 3, 'F');

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...WHITE);
  doc.text('Architecture & Méthodologie de Détection', 20, methY + 5.5);

  const methLines = [
    'Ce rapport a été généré par le moteur FinOps utilisant deux signaux complémentaires de détection des anomalies budgétaires :',
    '',
    '  Signal 1 — Isolation Forest (ML) : Algorithme non-supervisé qui entraîne des arbres de décision aléatoires sur l\'ensemble des services.',
    '  Les services dont les coûts sont difficiles à isoler sont considérés normaux. Score seuil : -0.08. Double-gate : pred==-1 ET score < -0.08.',
    '',
    '  Signal 2 — MoM Temporel : Comparaison mois sur mois (Month-over-Month). Seuil de déclenchement : variation > 50% vs le mois précédent.',
    `  Mode de regroupement actif : ${momGroupBy === 'ref' ? 'Par référence OVH exacte (comparaison 1-to-1 précise)' : 'Par service global (toutes références agrégées)'}`,
    '',
    `  Dernière analyse ML : ${lastMLRun ? new Date(lastMLRun).toLocaleString('fr-FR') : 'Non disponible'}   —   Anomalies affichées dans ce rapport : ${filtered.length} (filtres actifs)`,
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(...SLATE);
  methLines.forEach((line, i) => {
    doc.text(line, 18, methY + 13 + i * 4.2);
  });

  // ── PAGE 2+ : Anomaly table ─────────────────────────────────────────────
  doc.addPage();

  doc.setFillColor(...TEAL);
  doc.rect(0, 0, W, 16, 'F');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...WHITE);
  doc.text('Détail des Anomalies Détectées', 14, 10);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(204, 251, 241);
  doc.text(`${filtered.length} anomalie${filtered.length !== 1 ? 's' : ''} — export du ${dateStr}`, W - 14, 10, { align: 'right' });

  const tableRows = filtered.map(a => {
    const { isIF, isMom } = anomalySignals(a);
    const parsed = parseDesc(a.description);
    const tt = a.threshold_type ?? '';
    const momFromTt = parseMomFromThreshold(tt);
    const momVar = parsed.momVariation ?? momFromTt?.variation;
    const momDiff = parsed.momDiff ?? momFromTt?.diff;
    const diff = (a.observed_value != null && a.expected_value != null)
      ? a.observed_value - a.expected_value
      : (momDiff ?? null);
    const refCode = resolveRef(a) ?? '—';
    const method  = isIF && isMom ? 'IF + MoM' : isIF ? 'IF' : 'MoM';
    const scoreStr = a.anomaly_score != null ? a.anomaly_score.toFixed(4) : 'MoM seul';
    const varStr = momVar != null ? `${momVar >= 0 ? '+' : ''}${momVar.toFixed(1)}%` : '—';
    const diffStr = diff != null ? `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} €` : '—';

    return [
      sevLabel(a.severity),
      refCode,
      a.entity_name ?? '—',
      fmtEuro(a.observed_value),
      fmtEuro(a.expected_value),
      varStr,
      diffStr,
      scoreStr,
      method,
      fmtDate(a.detected_at),
    ];
  });

  autoTable(doc, {
    startY: 20,
    head: [[
      'Sévérité', 'Référence OVH', 'Service',
      'Coût observé', 'Coût attendu',
      'Var. MoM %', 'Δ € MoM',
      'Score IF', 'Méthode', 'Détecté le',
    ]],
    body: tableRows,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 7.5,
      cellPadding: { top: 3, right: 4, bottom: 3, left: 4 },
      lineColor: BORDER,
      lineWidth: 0.2,
      textColor: SLATE,
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: SLATE,
      textColor: WHITE,
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center',
    },
    alternateRowStyles: {
      fillColor: BG,
    },
    columnStyles: {
      0: { halign: 'center', fontStyle: 'bold', cellWidth: 18 },
      1: { fontStyle: 'bold', fontSize: 7, cellWidth: 36 },
      2: { cellWidth: 38 },
      3: { halign: 'right', cellWidth: 20 },
      4: { halign: 'right', cellWidth: 20 },
      5: { halign: 'right', cellWidth: 16 },
      6: { halign: 'right', cellWidth: 18 },
      7: { halign: 'right', fontStyle: 'bold', cellWidth: 18 },
      8: { halign: 'center', cellWidth: 18 },
      9: { halign: 'center', cellWidth: 22 },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 0) {
        const sev = filtered[data.row.index]?.severity;
        const color = sevColor(sev);
        data.cell.styles.textColor = color;
        data.cell.styles.fillColor = [...color.map(c => Math.min(255, c + 210))];
      }
      if (data.section === 'body' && data.column.index === 6) {
        const raw = data.cell.raw;
        if (typeof raw === 'string' && raw.startsWith('+')) {
          data.cell.styles.textColor = RED;
          data.cell.styles.fontStyle = 'bold';
        } else if (typeof raw === 'string' && raw.startsWith('-')) {
          data.cell.styles.textColor = GREEN;
          data.cell.styles.fontStyle = 'bold';
        }
      }
      if (data.section === 'body' && data.column.index === 8) {
        const method = data.cell.raw;
        if (method === 'IF + MoM') data.cell.styles.textColor = TEAL;
        else if (method === 'IF')  data.cell.styles.textColor = [15, 118, 110];
        else                       data.cell.styles.textColor = ORANGE;
        data.cell.styles.fontStyle = 'bold';
      }
    },
    margin: { left: 14, right: 14 },
  });

  // ── PAGE RENOUVELLEMENTS ─────────────────────────────────────────────────
  const renewals = anomalies
    .map(a => ({ anomaly: a, info: parseRenewalInfo(a) }))
    .filter(({ info }) => info !== null && info.daysUntilEnd != null);

  if (renewals.length > 0) {
    doc.addPage();

    doc.setFillColor(220, 38, 38);
    doc.rect(0, 0, W, 16, 'F');
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...WHITE);
    doc.text('Fins d\'Engagement & Renouvellements à Venir', 14, 10);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`${renewals.length} serveur${renewals.length !== 1 ? 's' : ''} concerné${renewals.length !== 1 ? 's' : ''}`, W - 14, 10, { align: 'right' });

    const renewRows = renewals
      .sort((a, b) => a.info.daysUntilEnd - b.info.daysUntilEnd)
      .map(({ anomaly, info }) => {
        const days = info.daysUntilEnd;
        const statusStr = days < 0
          ? `Expiré (+${Math.abs(days)}j)`
          : days === 0 ? 'Aujourd\'hui'
          : `J-${days}`;
        const endDateStr = info.engagementEndDate
          ? info.engagementEndDate.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
          : '—';
        const prorata = info.monthlyCost && info.daysUntilEnd >= 0
          ? ((info.monthlyCost / (info.prorataJours || 30)) * info.daysUntilEnd).toFixed(2) + ' €'
          : info.monthlyCost ? `${Number(info.monthlyCost).toFixed(2)} €/mois` : '—';
        return [
          statusStr,
          info.serviceLabel ?? '—',
          info.prorataRange ? info.prorataRange.replace('-', ' → ') : (info.prorataJours ? `${info.prorataJours} jours` : '—'),
          endDateStr,
          prorata,
        ];
      });

    autoTable(doc, {
      startY: 22,
      head: [['Statut', 'Serveur / Service', 'Période Prorata', 'Fin d\'engagement', 'Coût estimé']],
      body: renewRows,
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8.5,
        cellPadding: { top: 4, right: 5, bottom: 4, left: 5 },
        lineColor: BORDER,
        lineWidth: 0.2,
        textColor: SLATE,
        valign: 'middle',
      },
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: WHITE,
        fontStyle: 'bold',
        fontSize: 9,
      },
      alternateRowStyles: { fillColor: BG },
      columnStyles: {
        0: { halign: 'center', fontStyle: 'bold', cellWidth: 28 },
        1: { fontStyle: 'bold', cellWidth: 70 },
        2: { halign: 'center', cellWidth: 40 },
        3: { halign: 'center', cellWidth: 44 },
        4: { halign: 'right', fontStyle: 'bold', cellWidth: 34 },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 0) {
          const raw = String(data.cell.raw ?? '');
          if (raw.startsWith('Expiré')) { data.cell.styles.textColor = RED; data.cell.styles.fontStyle = 'bold'; }
          else if (raw.startsWith('J-0') || raw.startsWith('Aujourd')) { data.cell.styles.textColor = RED; }
          else if (raw.match(/J-[1-3]$/)) { data.cell.styles.textColor = RED; }
          else if (raw.match(/J-[4-7]$/)) { data.cell.styles.textColor = ORANGE; }
          else if (raw.match(/J-[0-9]+/) && parseInt(raw.replace('J-','')) <= 30) { data.cell.styles.textColor = AMBER; }
          else { data.cell.styles.textColor = GREEN; }
        }
      },
      margin: { left: 14, right: 14 },
    });
  }

  // ── Add footers on all pages ──────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    addFooter(p, totalPages);
  }

  doc.save(`rapport-anomalies-finops-${fileDate}.pdf`);
  toast.success(`Rapport PDF exporté — ${filtered.length} anomalies`, { icon: '📄' });
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
  const [momGroupBy,   setMomGroupBy]  = useState('service');

  const mlStep = useDetectionTicker(detectingML);

  const loadData = async () => {
    setLoading(true);
    try {
      const [anomRes, sumRes] = await Promise.all([
        api.get('/anomalies/', { params: { limit: 500 } }),
        api.get('/anomalies/summary'),
      ]);
      const costOnly = (Array.isArray(anomRes.data) ? anomRes.data : [])
        .filter(a => a.entity_type === 'cost_service' || a.entity_type === 'cost_ref' || a.anomaly_type === 'cost_spike');
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
      const res   = await api.post('/anomalies/detect/ml', {
        save:        true,
        mom_groupby: momGroupBy,
      });
      const count = Array.isArray(res.data) ? res.data.length : 0;
      setLastMLRun(new Date());
      toast.success(`${count} anomalie(s) détectée(s) (IF + MoM ${momGroupBy})`);
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
        if (signalFilter === 'if'   && !isIF)            return false;
        if (signalFilter === 'mom'  && !isMom)           return false;
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

  const critCount     = anomalies.filter(a => a.severity === 'critical').length;
  const highCount     = anomalies.filter(a => a.severity === 'high').length;
  const momCount      = anomalies.filter(a => anomalySignals(a).isMom).length;
  const ifCount       = anomalies.filter(a => anomalySignals(a).isIF).length;
  const surcouttotalMom = anomalies.reduce((sum, a) => {
    const { isMom } = anomalySignals(a);
    if (!isMom || isDataGap(a)) return sum;
    const parsed = parseDesc(a.description);
    const oc = parsed.momDiff != null && parsed.momDiff > 0 ? parsed.momDiff : 0;
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
                Isolation Forest ML · Month-over-Month · FinOps v8
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={loadData} disabled={loading} style={{ padding: '10px 18px', borderRadius: 9, background: T.bg, border: `1.5px solid ${T.border}`, color: T.slate, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit' }}>
              <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Actualiser
            </button>
            <button
              onClick={() => exportPDF({ filtered, anomalies, lastMLRun, momGroupBy })}
              disabled={anomalies.length === 0}
              style={{ padding: '10px 18px', borderRadius: 9, background: anomalies.length === 0 ? T.bg : `linear-gradient(135deg, #1D4ED8, #2563EB)`, border: `1.5px solid ${anomalies.length === 0 ? T.border : '#2563EB'}`, color: anomalies.length === 0 ? T.muted : 'white', fontWeight: 700, fontSize: 13, cursor: anomalies.length === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit', boxShadow: anomalies.length > 0 ? '0 4px 14px #1D4ED844' : 'none', transition: 'all .2s' }}
              title="Exporter un rapport PDF professionnel"
            >
              <FileText size={14} /> Exporter PDF
            </button>
            <button onClick={handlePurge} style={{ padding: '10px 18px', borderRadius: 9, background: T.redBg, border: '1.5px solid #fca5a5', color: T.red, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit' }}>
              <Trash2 size={14} /> Purger tout
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
          <SummaryCard label="Anomalies détectées"  value={anomalies.length} icon={AlertTriangle} color={T.muted}   subtitle="Coûts uniquement" />
          <SummaryCard label="Critique"              value={critCount}        icon={AlertCircle}   color={T.red}     subtitle="Action requise" />
          <SummaryCard label="Élevée"                value={highCount}        icon={AlertTriangle} color={T.orange}  subtitle="À surveiller" />
          <SummaryCard label="Détection IF"          value={ifCount}          icon={Brain}         color={T.teal}    subtitle="Isolation Forest" />
          <SummaryCard label="Détection MoM"         value={momCount}         icon={Calendar}      color={T.orange}  subtitle="Month-over-Month" />
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

          {/* Sélecteur mode MoM */}
          <div style={{ marginBottom: 16, padding: '14px 16px', background: T.bg, borderRadius: 10, border: `1px solid ${T.border}` }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: T.slate, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Server size={12} color={T.teal} />
              Catégorie MoM — Comment regrouper les données Month-over-Month ?
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setMomGroupBy('service')}
                style={{ padding: '10px 18px', borderRadius: 9, background: momGroupBy === 'service' ? T.tealBg : 'white', border: `2px solid ${momGroupBy === 'service' ? T.teal : T.border}`, color: momGroupBy === 'service' ? T.teal : T.muted, fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 7, transition: 'all .15s' }}
              >
                <DollarSign size={13} />
                Par service (nom global)
                {momGroupBy === 'service' && <span style={{ fontSize: 9, background: T.teal, color: 'white', borderRadius: 4, padding: '1px 5px' }}>ACTIF</span>}
              </button>
              <button
                onClick={() => setMomGroupBy('ref')}
                style={{ padding: '10px 18px', borderRadius: 9, background: momGroupBy === 'ref' ? T.purpleBg : 'white', border: `2px solid ${momGroupBy === 'ref' ? T.purple : T.border}`, color: momGroupBy === 'ref' ? T.purple : T.muted, fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 7, transition: 'all .15s' }}
              >
                <Server size={13} />
                Par référence serveur (ns31546254.ip-… exact)
                {momGroupBy === 'ref' && <span style={{ fontSize: 9, background: T.purple, color: 'white', borderRadius: 4, padding: '1px 5px' }}>ACTIF</span>}
              </button>
            </div>
            <p style={{ fontSize: 10, color: T.muted, marginTop: 8, lineHeight: 1.5 }}>
              {momGroupBy === 'service'
                ? '📊 Mode service : regroupe toutes les lignes d\'un même service_name. observed et expected sont tous les deux au niveau service — même scope de comparaison.'
                : '🖥️ Mode référence : regroupe par référence OVH exacte. observed et expected sont tous les deux pour la même ref — comparaison 1-to-1 précise.'
              }
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={runDetection}
              disabled={detecting}
              style={{ padding: '13px 28px', borderRadius: 10, background: detecting ? T.bg : `linear-gradient(135deg, ${T.teal}, #0d9488)`, border: 'none', color: detecting ? T.muted : 'white', fontWeight: 700, fontSize: 14, cursor: detecting ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 9, boxShadow: detecting ? 'none' : `0 4px 14px ${T.teal}55`, transition: 'all .2s' }}
            >
              {detecting ? <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Brain size={15} />}
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

          {/* Architecture signaux */}
          <div style={{ marginTop: 16, padding: '14px 16px', background: T.tealBg, borderRadius: 10, border: '1px solid #5eead4', fontSize: 11, color: '#134E4A', lineHeight: 1.8 }}>
            <Brain size={11} style={{ display: 'inline', marginRight: 6 }} />
            <strong>Architecture 2 signaux :</strong>
            <div style={{ marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ background: T.tealBg, border: '1px solid #5eead4', borderRadius: 6, padding: '4px 10px', fontSize: 11, color: T.teal, fontWeight: 700 }}>
                🤖 Signal 1 — Isolation Forest : outlier parmi tous les services (score &lt; -0.08)
              </span>
              <span style={{ background: T.orangeBg, border: `1px solid ${T.orange}44`, borderRadius: 6, padding: '4px 10px', fontSize: 11, color: T.orange, fontWeight: 700 }}>
                📅 Signal 2 — MoM Temporel : variation &gt; 50% vs mois précédent — même scope (service ou ref)
              </span>
            </div>
          </div>
        </div>

        {/* Fins d'engagement à venir */}
        <AnomalyRenewalPanel anomalies={anomalies} />

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
                  { label: 'Δ € MoM',              align: 'right', tip: 'Différence € vs mois précédent' },
                  { label: 'Score IF',             align: 'right', sortable: true },
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