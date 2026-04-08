import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../Layout/Layout';
import {
  FileText, Plus, Trash2, Download, ChevronDown,
  User, Calendar, Percent, ArrowLeft, Building2, Check, Server,
} from 'lucide-react';
import { costsService } from '../../services/costs';

// ─── Logos base64 ─────────────────────────────────────────────────────
const TW_LOGO='teawmill.png';
const EF_LOGO='efloo.png';
const fmt2 = v => Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BRANDS = [
  { id: 'teamwill',    label: 'TEAMWILL DIGITAL',  color: '#96B055', logo: TW_LOGO },
  { id: 'efloconnect', label: 'EFLOCONNECT',        color: '#ba992c', logo: EF_LOGO },
];

// ─── Line type: "prestation" (free text bullets) or "server" (from costs) ─
let lineCounter = 100;
function newPrestation() {
  return { id: lineCounter++, type: 'prestation', bullets: [''], qty: '1', unitPrice: '0', discount: '0', tva: '20' };
}
function newServerLine(srv) {
  return {
    id: lineCounter++, type: 'server',
    serverId: srv.id, serverName: srv.service_name || srv.name,
    specs: srv.specs || '',
    qty: '1', unitPrice: String(Number(srv.amount || srv.price || 0).toFixed(2)), discount: '0', tva: '20',
  };
}

// ─── LineRow ────────────────────────────────────────────────────────────────
function LineRow({ line, onChange, onRemove, idx, brandColor, costsData }) {
  const tvaPct = Number(line.tva ?? 20);
  const baseHT = Number(line.qty) * Number(line.unitPrice) * (1 - Number(line.discount) / 100);
  const tvaAmt = baseHT * tvaPct / 100;
  const ttcAmt = baseHT + tvaAmt;

  const inputSm = {
    padding: '6px 9px', border: '1px solid #e2e8f0', borderRadius: 7,
    fontSize: 12, fontFamily: 'inherit', outline: 'none', background: 'white', color: '#0f172a',
  };

  const addBullet = () => onChange({ ...line, bullets: [...(line.bullets || ['']), ''] });
  const removeBullet = i => onChange({ ...line, bullets: line.bullets.filter((_, j) => j !== i) });
  const editBullet = (i, val) => onChange({ ...line, bullets: line.bullets.map((b, j) => j === i ? val : b) });

  return (
    <div style={{
      borderBottom: '1px solid #f1f5f9',
      background: idx % 2 === 0 ? 'white' : '#fafbfc',
    }}>
      {/* grid: description | qty | unitPrice | discount | tva% | total HT | remove */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 70px 120px 70px 80px 110px 36px',
        gap: 8, alignItems: 'start', padding: '12px 16px',
      }}>
        {/* Description column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {line.type === 'prestation' ? (
            <>
              {(line.bullets || ['']).map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>•</span>
                  <input
                    value={b}
                    onChange={e => editBullet(i, e.target.value)}
                    placeholder={`Ligne ${i + 1}…`}
                    style={{ ...inputSm, flex: 1 }}
                  />
                  {(line.bullets || []).length > 1 && (
                    <button onClick={() => removeBullet(i)} style={{
                      width: 20, height: 20, borderRadius: 5, background: '#fff5f5',
                      border: '1px solid #fca5a5', cursor: 'pointer', color: '#dc2626',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11,
                    }}>×</button>
                  )}
                </div>
              ))}
              <button onClick={addBullet} style={{
                alignSelf: 'flex-start', fontSize: 11, color: brandColor, background: 'none',
                border: 'none', cursor: 'pointer', padding: '2px 0', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 3,
              }}>
                <Plus size={11}/> ajouter une ligne
              </button>
            </>
          ) : (
            /* Editable server name */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <input
                value={line.serverName}
                onChange={e => onChange({ ...line, serverName: e.target.value })}
                style={{ ...inputSm, fontWeight: 700, fontSize: 12 }}
              />
              {line.specs && <div style={{ fontSize: 11, color: '#64748b', paddingLeft: 2 }}>{line.specs}</div>}
            </div>
          )}
        </div>

        {/* Qty */}
        <input type="number" min="0" step="0.5" value={line.qty}
          onChange={e => onChange({ ...line, qty: e.target.value })}
          style={{ ...inputSm, textAlign: 'center', width: '100%' }}/>

        {/* Unit price */}
        <div style={{ position: 'relative' }}>
          <input type="number" min="0" step="0.01" value={line.unitPrice}
            onChange={e => onChange({ ...line, unitPrice: e.target.value })}
            style={{ ...inputSm, width: '100%', textAlign: 'right', paddingRight: 20 }}/>
          <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#94a3b8', pointerEvents: 'none' }}>€</span>
        </div>

        {/* Discount */}
        <div style={{ position: 'relative' }}>
          <input type="number" min="0" max="100" step="1" value={line.discount}
            onChange={e => onChange({ ...line, discount: e.target.value })}
            style={{ ...inputSm, width: '100%', textAlign: 'right', paddingRight: 18 }}/>
          <span style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#94a3b8', pointerEvents: 'none' }}>%</span>
        </div>

        {/* TVA % — editable */}
        <div style={{ position: 'relative' }}>
          <input type="number" min="0" max="100" step="0.5" value={line.tva ?? '20'}
            onChange={e => onChange({ ...line, tva: e.target.value })}
            style={{ ...inputSm, width: '100%', textAlign: 'right', paddingRight: 20, borderColor: '#ddd6fe' }}/>
          <span style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#7C3AED', pointerEvents: 'none', fontWeight: 700 }}>%</span>
        </div>

        {/* Total HT */}
        <div style={{ textAlign: 'right', paddingTop: 7 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>{fmt2(baseHT)} €</div>
          <div style={{ fontSize: 10, color: '#7C3AED', marginTop: 1 }}>TTC {fmt2(ttcAmt)} €</div>
        </div>

        {/* Remove */}
        <button onClick={onRemove} style={{
          width: 32, height: 32, borderRadius: 8, background: '#fff5f5',
          border: '1px solid #fca5a5', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center', color: '#dc2626', marginTop: 2, flexShrink: 0,
        }}>
          <Trash2 size={13}/>
        </button>
      </div>
    </div>
  );
}

// ─── Category detection (mirrors Costs.jsx logic) ────────────────────────────
const CAT_COLOR = { VPS: '#7C3AED', Dedicated: '#2563EB' };
const CAT_BG_C  = { VPS: '#f5f3ff', Dedicated: '#eff6ff' };

function detectServerCategory(name) {
  if (!name) return null;
  const n = name.toUpperCase();
  if (n.includes('VPS')) return 'VPS';
  if (
    n.includes('SERVER') || n.includes('RENTAL') ||
    n.includes('EG-')    || n.includes('ADVANCE') ||
    n.includes('RISE')   || n.includes('BIG-')    ||
    n.includes('SP-')    || n.includes('HG-')     ||
    n.includes('SCALE-') || n.includes('HGR-')    ||
    n.includes('KS-')    || n.includes('SYS-')    ||
    n.includes('HOST-')  || n.includes('DEDIBOX')
  ) return 'Dedicated';
  return null; // not a server
}

// ─── Server picker from costs (auto-detected, grouped by category) ────────────
function CostServerPicker({ costsData, onSelect, brandColor }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Deduplicate by service_name, keep the most recent / highest-amount entry
  const serverMap = {};
  (costsData || []).forEach(c => {
    const cat = detectServerCategory(c.service_name);
    if (!cat || !c.service_name || Number(c.amount || 0) <= 0) return;
    const key = c.service_name.trim();
    if (!serverMap[key] || Number(c.amount) > Number(serverMap[key].amount)) {
      serverMap[key] = { ...c, _cat: cat };
    }
  });

  const allServers = Object.values(serverMap).sort((a, b) => {
    if (a._cat !== b._cat) return a._cat === 'VPS' ? -1 : 1;
    return Number(b.amount) - Number(a.amount);
  });

  const filtered = search.trim()
    ? allServers.filter(c =>
        c.service_name.toLowerCase().includes(search.toLowerCase()) ||
        (c.reference || '').toLowerCase().includes(search.toLowerCase())
      )
    : allServers;

  const vpsItems  = filtered.filter(c => c._cat === 'VPS');
  const dedItems  = filtered.filter(c => c._cat === 'Dedicated');

  const totalServers = allServers.length;

  const renderGroup = (label, items, cat) => {
    if (!items.length) return null;
    const color = CAT_COLOR[cat];
    const bg    = CAT_BG_C[cat];
    return (
      <>
        <div style={{
          padding: '6px 14px 4px', fontSize: 9, fontWeight: 800,
          color: color, textTransform: 'uppercase', letterSpacing: '.1em',
          background: bg, borderBottom: `1px solid ${color}20`,
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          {cat === 'VPS' ? '🖥️' : '🗄️'} {label}
          <span style={{ fontSize: 9, fontWeight: 700, background: color + '18', color, padding: '1px 6px', borderRadius: 99, border: `1px solid ${color}30` }}>
            {items.length}
          </span>
        </div>
        {items.map((c, i) => {
          const ref = c.reference || c.resource_id || c.external_id || null;
          return (
            <div key={c.id || i}
              onClick={() => { onSelect(c); setOpen(false); setSearch(''); }}
              style={{
                padding: '9px 14px', cursor: 'pointer',
                borderBottom: '1px solid #f8fafc', transition: 'background .1s',
                display: 'flex', flexDirection: 'column', gap: 3,
              }}
              onMouseEnter={e => e.currentTarget.style.background = bg}
              onMouseLeave={e => e.currentTarget.style.background = 'white'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', flex: 1, lineHeight: 1.3,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}
                  title={c.service_name}>
                  {c.service_name}
                </span>
                <span style={{
                  fontSize: 12, fontWeight: 800, color, whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  {fmt2(c.amount)} €
                </span>
              </div>
              {ref && (
                <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ref}
                </span>
              )}
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
        background: brandColor + '12', color: brandColor,
        border: `1.5px solid ${brandColor}40`, borderRadius: 8,
        cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
      }}>
        <Server size={12}/> Serveurs depuis les coûts
        <span style={{
          fontSize: 10, fontWeight: 700,
          background: brandColor + '22', color: brandColor,
          padding: '1px 7px', borderRadius: 99, border: `1px solid ${brandColor}30`,
        }}>
          {totalServers}
        </span>
        <ChevronDown size={11}/>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 1000,
          background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,.14)', marginTop: 6, width: 360,
          maxHeight: 420, display: 'flex', flexDirection: 'column',
        }}>
          {/* Search header */}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9' }}>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher un serveur VPS / Dédié…"
              style={{
                width: '100%', padding: '6px 10px', border: '1px solid #e2e8f0',
                borderRadius: 7, fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
              }}
            />
            <div style={{ marginTop: 6, fontSize: 10, color: '#94a3b8', display: 'flex', gap: 8 }}>
              <span>🖥️ VPS: <strong>{vpsItems.length}</strong></span>
              <span>🗄️ Dédiés: <strong>{dedItems.length}</strong></span>
              {search && <span style={{ color: '#7C3AED' }}>· filtrés sur « {search} »</span>}
            </div>
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>🔍</div>
                Aucun serveur VPS / Dédié trouvé
              </div>
            ) : (
              <>
                {renderGroup('VPS', vpsItems, 'VPS')}
                {renderGroup('Serveurs Dédiés', dedItems, 'Dedicated')}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PDF generation ────────────────────────────────────────────────────────
function generatePDF(devis, brand, asWord = false) {
  const lines = devis.lines;
  const totalHT = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice) * (1 - Number(l.discount) / 100), 0);
  const afterGlobal = totalHT * (1 - Number(devis.globalDiscount || 0) / 100);
  const globalRatio = totalHT > 0 ? afterGlobal / totalHT : 1;
  const tva = lines.reduce((s, l) => {
    const lineHT = Number(l.qty) * Number(l.unitPrice) * (1 - Number(l.discount) / 100);

    const tvaPct = Number(l.tva ?? 20);
    return s + lineHT * globalRatio * tvaPct / 100;
  }, 0);
  const ttc = afterGlobal + tva;

  const linesHTML = lines.map(l => {
    const ht = Number(l.qty) * Number(l.unitPrice) * (1 - Number(l.discount) / 100);
    const tvaPct = Number(l.tva ?? 20);
    const tvaLine = ht * tvaPct / 100;
    const descHTML = l.type === 'prestation'
      ? `<ul style="margin:0;padding-left:16px;">${(l.bullets || []).filter(b => b.trim()).map(b => `<li style="margin:2px 0;">${b}</li>`).join('')}</ul>`
      : `<div style="font-weight:600;">${l.serverName}</div>${l.specs ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${l.specs}</div>` : ''}`;
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e8edf5;vertical-align:top;font-size:12.5px;">${descHTML}${Number(l.discount) > 0 ? `<div style="font-size:10px;color:#dc2626;margin-top:3px;">Remise : ${l.discount}%</div>` : ''}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e8edf5;text-align:center;font-size:12.5px;color:#374151;">${l.qty}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e8edf5;text-align:right;font-size:12.5px;color:#374151;">${fmt2(l.unitPrice)} €</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e8edf5;text-align:center;font-size:12.5px;color:#7C3AED;font-weight:700;">${tvaPct}%</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e8edf5;text-align:right;font-size:13px;font-weight:700;color:#0f172a;">${fmt2(ht)} €</td>
    </tr>`;
  }).join('');

  const devisNum = `TWD_${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}${String(new Date().getDate()).padStart(2,'0')}`;
  const today = new Date().toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' });

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:Arial,sans-serif;font-size:12.5px;color:#0f172a;background:white;}
@page{size:A4;margin:16mm 18mm 18mm;}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
.page{max-width:794px;margin:0 auto;}
table{width:100%;border-collapse:collapse;}
thead th{padding:9px 12px;color:white;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;background:${brand.color};}
.tr-alt{background:#f8fafc;}
</style></head><body><div class="page">

  <!-- TOP COLOR BAR -->
  <div style="height:5px;background:${brand.color};margin-bottom:24px;border-radius:2px;"></div>

  <!-- HEADER -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:26px;">
    <div>
      <img src="${brand.logo}" style="height:52px;object-fit:contain;margin-bottom:10px;" alt="${brand.label}"/>
      <div style="font-size:11px;color:#64748b;">Tour EQHO – 2 Avenue Gambetta, 92400 Courbevoie</div>
      <div style="font-size:11px;color:#64748b;">TVA : FR26401048186</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:30px;font-weight:900;color:${brand.color};letter-spacing:-1.5px;line-height:1;">DEVIS</div>
      <div style="font-size:12px;color:#374151;margin-top:5px;font-weight:600;">N° ${devisNum}</div>
      <div style="font-size:11.5px;color:#64748b;">Paris, le ${today}</div>
      <div style="margin-top:5px;display:inline-block;background:#fffbeb;border:1px solid #fcd34d;border-radius:5px;padding:3px 10px;font-size:10.5px;font-weight:700;color:#92400e;">Proposition valable 30 jours</div>
    </div>
  </div>

  <!-- CLIENT + INTERLOCUTEUR -->
  <div style="display:flex;gap:18px;margin-bottom:22px;">
    <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;padding:14px 16px;">
      <div style="font-size:9.5px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:7px;">Nom du client</div>
      <div style="font-size:14px;font-weight:800;color:#0f172a;">${devis.clientName || '—'}</div>
      ${devis.clientContact ? `<div style="font-size:11.5px;color:#64748b;margin-top:3px;">À l'attention de ${devis.clientContact}</div>` : ''}
      ${devis.clientEmail ? `<div style="font-size:11px;color:#2563eb;margin-top:2px;">${devis.clientEmail}</div>` : ''}
    </div>
    <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;padding:14px 16px;">
      <div style="font-size:9.5px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:7px;">A retourner à</div>
      <div style="font-size:13px;font-weight:800;color:${brand.color};">${brand.label}</div>
      <div style="font-size:11.5px;color:#374151;margin-top:4px;font-weight:600;">Votre interlocuteur : ${devis.contactName || '—'}</div>
      ${devis.contactEmail ? `<div style="font-size:11px;color:#2563eb;margin-top:2px;">E-mail : ${devis.contactEmail}</div>` : ''}
      ${devis.contactPhone ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">Tél : ${devis.contactPhone}</div>` : ''}
    </div>
  </div>

  <!-- META ROW -->
  <div style="display:flex;gap:14px;margin-bottom:20px;">
    ${[
      ['Devis N°', devisNum],
      ['Proposition valable', '30 jours'],
      ['Affaire', devis.affair || devis.clientName || '—'],
      ['Date livraison', devis.deliveryDate ? new Date(devis.deliveryDate).toLocaleDateString('fr-FR') : '—'],
    ].map(([l,v]) => `<div style="flex:1;background:#f1f5f9;border-radius:7px;padding:8px 12px;">
      <div style="font-size:9px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;">${l}</div>
      <div style="font-size:12px;font-weight:700;color:#0f172a;margin-top:3px;">${v}</div>
    </div>`).join('')}
  </div>

  <!-- TABLE -->
  <table style="border:1px solid #e2e8f0;border-radius:8px 8px 0 0;overflow:hidden;border-bottom:none;">
    <thead><tr>
      <th style="width:40%;text-align:left;">Description</th>
      <th style="width:8%;text-align:center;">Quantité</th>
      <th style="width:14%;text-align:right;">Montant € HT</th>
      <th style="width:10%;text-align:center;">TVA</th>
      <th style="width:18%;text-align:right;">Total HT</th>
    </tr></thead>
    <tbody>${linesHTML}</tbody>
  </table>

  <!-- TOTALS -->
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;overflow:hidden;margin-bottom:20px;">
    ${Number(devis.globalDiscount) > 0 ? `<div style="display:flex;justify-content:space-between;padding:8px 14px;border-top:1px solid #f1f5f9;font-size:12px;"><span style="color:#64748b;">Remise globale (${devis.globalDiscount}%)</span><span style="font-weight:600;color:#dc2626;">- ${fmt2(totalHT - afterGlobal)} €</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;padding:9px 14px;border-top:1px solid #f1f5f9;font-size:12.5px;"><span style="color:#374151;font-weight:600;">Total € HT :</span><span style="font-weight:700;">${fmt2(afterGlobal)} €</span></div>
    <div style="display:flex;justify-content:space-between;padding:9px 14px;border-top:1px solid #f1f5f9;font-size:12.5px;"><span style="color:#374151;font-weight:600;">Total € TVA (${afterGlobal > 0 ? (tva/afterGlobal*100).toFixed(afterGlobal > 0 && (tva/afterGlobal*100) % 1 === 0 ? 0 : 1) : 0}%) :</span><span style="font-weight:700;">${fmt2(tva)} €</span></div>
    <div style="display:flex;justify-content:space-between;padding:11px 14px;background:${brand.color};border-top:1px solid ${brand.color};font-size:14px;"><span style="color:white;font-weight:800;">Total € TTC :</span><span style="color:white;font-weight:900;">${fmt2(ttc)} €</span></div>
  </div>

  <!-- CONDITIONS -->
  ${devis.conditions ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:13px 16px;margin-bottom:14px;">
    <div style="font-size:10px;font-weight:800;color:#92400e;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">Conditions de facturation</div>
    <div style="font-size:11.5px;color:#78350f;white-space:pre-wrap;">${devis.conditions}</div>
  </div>` : ''}

  ${devis.notes ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin-bottom:14px;">
    <div style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px;">Commentaires</div>
    <div style="font-size:11.5px;color:#374151;white-space:pre-wrap;">${devis.notes}</div>
  </div>` : ''}
  <!-- SIGNATURE -->
  <div style="display:flex;gap:24px;margin-top:28px;margin-bottom:8px;">
    <div style="flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;">
      <div style="font-size:9.5px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">Bon pour accord — Client</div>
      <div style="font-size:10.5px;color:#374151;margin-bottom:6px;">Nom, prénom &amp; qualité du signataire :</div>
      <div style="font-size:12px;font-weight:700;color:#0f172a;min-height:18px;margin-bottom:8px;">${devis.clientSignerName || ''}</div>
      ${devis.clientSignature
        ? `<img src="${devis.clientSignature}" style="height:60px;max-width:100%;object-fit:contain;display:block;margin-bottom:8px;" alt="Signature"/>`
        : `<div style="height:60px;margin-bottom:8px;"></div>`
      }
      <div style="border-top:1px dashed #cbd5e1;padding-top:8px;display:flex;justify-content:space-between;">
        <span style="font-size:10px;color:#94a3b8;">Signature &amp; cachet</span>
        <span style="font-size:10px;color:#94a3b8;">Date : ${devis.clientSignatureDate ? new Date(devis.clientSignatureDate).toLocaleDateString('fr-FR') : '_____ / _____ / _________'}</span>
      </div>
    </div>
    <div style="flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;background:#f8fafc;">
      <div style="font-size:9.5px;font-weight:800;color:${brand.color};text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">Émis par — ${brand.label}</div>
      <div style="font-size:11px;font-weight:700;color:#0f172a;margin-bottom:2px;">${devis.contactName || '—'}</div>
      ${devis.contactEmail ? `<div style="font-size:10px;color:#2563eb;margin-bottom:2px;">${devis.contactEmail}</div>` : ''}
      ${devis.contactPhone ? `<div style="font-size:10px;color:#64748b;margin-bottom:8px;">${devis.contactPhone}</div>` : '<div style="margin-bottom:8px;"></div>'}
      ${devis.issuerSignature
        ? `<img src="${devis.issuerSignature}" style="height:60px;max-width:100%;object-fit:contain;display:block;margin-bottom:8px;" alt="Signature"/>`
        : `<div style="height:60px;margin-bottom:8px;"></div>`
      }
      <div style="border-top:1px dashed #cbd5e1;padding-top:8px;display:flex;justify-content:space-between;">
        <span style="font-size:10px;color:#94a3b8;">Signature</span>
        <span style="font-size:10px;color:#94a3b8;">Date : ${devis.issuerSignatureDate ? new Date(devis.issuerSignatureDate).toLocaleDateString('fr-FR') : '_____ / _____ / _________'}</span>
      </div>
    </div>
  </div>

  <div style="margin-top:24px;text-align:center;font-size:10px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:12px;">
    ${brand.label} · Tour EQHO – 2 Avenue Gambetta, 92400 Courbevoie · TVA : FR26401048186
  </div>
</div>
<script>window.onload=()=>window.print();</script>
</body></html>`;

  if (asWord) {
    // Word-compatible HTML blob (.doc)
    const wordHtml = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='UTF-8'><title>Devis ${devisNum}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>90</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
  body{font-family:Arial,sans-serif;font-size:12pt;color:#0f172a;}
  table{width:100%;border-collapse:collapse;}
  th{background:${brand.color};color:white;padding:7pt 10pt;font-size:10pt;text-transform:uppercase;}
  td{padding:7pt 10pt;border-bottom:1pt solid #e2e8f0;font-size:11pt;}
  .total-row{font-weight:bold;}
  .ttc-row{background:${brand.color};color:white;font-weight:bold;font-size:13pt;}
  h1{color:${brand.color};}
</style></head>
<body>
<h1 style="font-size:28pt;letter-spacing:-1pt;">DEVIS</h1>
<p><strong>N° ${devisNum}</strong> &nbsp;·&nbsp; Paris, le ${today} &nbsp;·&nbsp; Valable 30 jours</p>
<hr/>
<table><tr>
  <td style="width:50%;vertical-align:top;border:1pt solid #e2e8f0;padding:10pt;">
    <strong>Client</strong><br/>
    ${devis.clientName || '—'}<br/>
    ${devis.clientContact ? `À l'attention de ${devis.clientContact}<br/>` : ''}
    ${devis.clientEmail || ''}
  </td>
  <td style="width:50%;vertical-align:top;border:1pt solid #e2e8f0;padding:10pt;">
    <strong style="color:${brand.color};">${brand.label}</strong><br/>
    ${devis.contactName || '—'}<br/>
    ${devis.contactEmail || ''}<br/>
    ${devis.contactPhone || ''}
  </td>
</tr></table>
<br/>
<table>
  <thead><tr>
    <th style="text-align:left;width:40%;">Description</th>
    <th style="text-align:center;width:8%;">Qté</th>
    <th style="text-align:right;width:14%;">HT</th>
    <th style="text-align:center;width:10%;">TVA</th>
    <th style="text-align:right;width:18%;">Total HT</th>
  </tr></thead>
  <tbody>
    ${lines.map(l => {
      const ht = Number(l.qty) * Number(l.unitPrice) * (1 - Number(l.discount) / 100);
      const tvaPct = Number(l.tva ?? 20);
      const desc = l.type === 'prestation'
        ? (l.bullets || []).filter(b => b.trim()).map(b => `• ${b}`).join('<br/>')
        : `<strong>${l.serverName}</strong>${l.specs ? `<br/><span style="font-size:10pt;color:#64748b;">${l.specs}</span>` : ''}`;
      return `<tr>
        <td>${desc}${Number(l.discount) > 0 ? `<br/><span style="font-size:9pt;color:#dc2626;">Remise : ${l.discount}%</span>` : ''}</td>
        <td style="text-align:center;">${l.qty}</td>
        <td style="text-align:right;">${fmt2(l.unitPrice)} €</td>
        <td style="text-align:center;color:#7C3AED;font-weight:bold;">${tvaPct}%</td>
        <td style="text-align:right;font-weight:bold;">${fmt2(ht)} €</td>
      </tr>`;
    }).join('')}
  </tbody>
</table>
<table style="width:40%;margin-left:60%;margin-top:8pt;">
  ${Number(devis.globalDiscount) > 0 ? `<tr><td>Remise globale (${devis.globalDiscount}%)</td><td style="text-align:right;color:#dc2626;">- ${fmt2(totalHT - afterGlobal)} €</td></tr>` : ''}
  <tr class="total-row"><td>Total HT</td><td style="text-align:right;">${fmt2(afterGlobal)} €</td></tr>
  <tr class="total-row"><td>Total TVA (${devis.tvaPct || 20}%)</td><td style="text-align:right;">${fmt2(tva)} €</td></tr>
  <tr class="ttc-row"><td style="padding:7pt 10pt;">Total TTC</td><td style="text-align:right;padding:7pt 10pt;">${fmt2(ttc)} €</td></tr>
</table>
${devis.conditions ? `<br/><div style="background:#fffbeb;border:1pt solid #fcd34d;padding:10pt;"><strong>Conditions :</strong><br/>${devis.conditions.replace(/\n/g,'<br/>')}</div>` : ''}
${devis.notes ? `<br/><div style="background:#f8fafc;border:1pt solid #e2e8f0;padding:10pt;"><strong>Notes :</strong><br/>${devis.notes.replace(/\n/g,'<br/>')}</div>` : ''}
<br/>
<table style="width:100%;margin-top:20pt;">
  <tr>
    <td style="width:50%;border:1pt solid #e2e8f0;padding:12pt;vertical-align:top;">
      <strong>Bon pour accord — Client</strong><br/><br/>
      Nom, prénom &amp; qualité :<br/><br/><br/>
      <hr style="border-top:1pt dashed #cbd5e1;"/>
      Signature &amp; cachet &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date : ___/___/_______
    </td>
    <td style="width:50%;border:1pt solid #e2e8f0;padding:12pt;background:#f8fafc;vertical-align:top;">
      <strong style="color:${brand.color};">Émis par — ${brand.label}</strong><br/>
      ${devis.contactName || '—'}<br/>
      ${devis.contactEmail || ''}<br/>
      ${devis.contactPhone || ''}<br/><br/>
      <hr style="border-top:1pt dashed #cbd5e1;"/>
      Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date : ___/___/_______
    </td>
  </tr>
</table>
<br/><p style="text-align:center;font-size:9pt;color:#94a3b8;">${brand.label} · Tour EQHO – 2 Avenue Gambetta, 92400 Courbevoie · TVA : FR26401048186</p>
</body></html>`;
    const blob = new Blob([wordHtml], { type: 'application/msword' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `Devis_${devisNum}.doc`;
    a.click(); URL.revokeObjectURL(url);
    return;
  }

  const win = window.open('', '_blank');
  if (win) { win.document.write(html); win.document.close(); }
}

// ─── Signature Pad Component ─────────────────────────────────────────────────
function SignaturePad({ onSave, brandColor }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [hasSignature, setHasSignature] = useState(false);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e) => {
    e.preventDefault();
    drawing.current = true;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { x, y } = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e) => {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { x, y } = getPos(e, canvas);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDraw = (e) => {
    e?.preventDefault();
    drawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    onSave(null);
  };

  const save = () => {
    const canvas = canvasRef.current;
    onSave(canvas.toDataURL('image/png'));
  };

  return (
    <div>
      <div style={{ position: 'relative', border: '1.5px solid #e2e8f0', borderRadius: 8, background: '#fafbfc', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          width={500}
          height={120}
          style={{ width: '100%', height: 120, display: 'block', cursor: 'crosshair', touchAction: 'none' }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
        />
        {!hasSignature && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            fontSize: 11, color: '#cbd5e1', pointerEvents: 'none', userSelect: 'none', textAlign: 'center',
          }}>
            ✍️ Signez ici
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button onClick={clear} style={{
          fontSize: 11, padding: '4px 10px', border: '1px solid #e2e8f0', borderRadius: 6,
          background: 'white', cursor: 'pointer', color: '#64748b', fontFamily: 'inherit',
        }}>
          Effacer
        </button>
        {hasSignature && (
          <button onClick={save} style={{
            fontSize: 11, padding: '4px 10px', border: `1px solid ${brandColor}`,
            borderRadius: 6, background: brandColor + '12', cursor: 'pointer',
            color: brandColor, fontFamily: 'inherit', fontWeight: 700,
          }}>
            ✓ Valider
          </button>
        )}
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function Devis() {
  const navigate = useNavigate();
  const [step, setStep] = useState('brand');
  const [selectedBrand, setSelectedBrand] = useState(null);
  const [costsData, setCostsData] = useState([]);
  const [devis, setDevis] = useState({
    clientName: '', clientContact: '', clientEmail: '',
    clientSignerName: '', clientSignature: null,
    clientSignatureDate: '', issuerSignatureDate: '', issuerSignature: null,
    contactName: 'Marouen BEN HADJ',
    contactEmail: 'marouen.benhadj@teamwillgroup.com',
    contactPhone: '00216 51 470 389',
    affair: '', deliveryDate: '',
    globalDiscount: '0',
    conditions: '50% à la commande\n50% à la livraison',
    notes: '',
    lines: [newPrestation()],
  });

  // Load costs on mount
  useEffect(() => {
    costsService.getCosts(0, 5000)
      .then(data => setCostsData(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const brand = BRANDS.find(b => b.id === selectedBrand);

  const updateLine = useCallback((id, updated) =>
    setDevis(d => ({ ...d, lines: d.lines.map(l => l.id === id ? updated : l) })), []);
  const removeLine = useCallback(id =>
    setDevis(d => ({ ...d, lines: d.lines.filter(l => l.id !== id) })), []);

  const totalHT = devis.lines.reduce((s, l) =>
    s + Number(l.qty) * Number(l.unitPrice) * (1 - Number(l.discount) / 100), 0);
  const afterGlobal = totalHT * (1 - Number(devis.globalDiscount || 0) / 100);
  // Weighted TVA: sum of each line's tva amount after global discount ratio
  const globalRatio = totalHT > 0 ? afterGlobal / totalHT : 1;
  const totalTVA = devis.lines.reduce((s, l) => {
    const lineHT = Number(l.qty) * Number(l.unitPrice) * (1 - Number(l.discount) / 100);
    const tvaPct = Number(l.tva ?? 20);
    return s + lineHT * globalRatio * tvaPct / 100;
  }, 0);
  const tva = afterGlobal * (Number(devis.tvaPct || 20) / 100);
  const ttc = afterGlobal + tva;

  // ── STEP 1: Brand selection ─────────────────────────────────────────────
  if (step === 'brand') {
    return (
      <Layout>
        <div style={{ maxWidth: 640, margin: '0 auto', paddingTop: 24 }}>
          <button onClick={() => navigate('/costs')} style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 32,
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, color: '#64748b', fontFamily: 'inherit', padding: 0,
          }}>
            <ArrowLeft size={14}/> Retour aux coûts
          </button>

          <div style={{ textAlign: 'center', marginBottom: 44 }}>
            <div style={{
              width: 60, height: 60, borderRadius: 18, background: '#1B5E46',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px',
            }}>
              <FileText size={28} color="white"/>
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 900, color: '#0f172a', letterSpacing: '-0.6px', margin: 0 }}>
              Génération de devis
            </h1>
            <p style={{ fontSize: 14, color: '#64748b', marginTop: 10, lineHeight: 1.6 }}>
              Sélectionnez l'entité de facturation.<br/>Le logo correspondant apparaîtra sur le PDF.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 20, marginBottom: 36 }}>
            {BRANDS.map(b => (
              <button
                key={b.id}
                onClick={() => setSelectedBrand(b.id)}
                style={{
                  flex: 1, padding: '28px 20px', borderRadius: 20, cursor: 'pointer',
                  border: selectedBrand === b.id ? `2.5px solid ${b.color}` : '2px solid #e2e8f0',
                  background: selectedBrand === b.id ? b.color + '08' : 'white',
                  boxShadow: selectedBrand === b.id ? `0 6px 24px ${b.color}22` : '0 2px 8px rgba(0,0,0,.04)',
                  transition: 'all .18s', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
                  position: 'relative',
                }}
              >
                {selectedBrand === b.id && (
                  <div style={{
                    position: 'absolute', top: 12, right: 12,
                    width: 22, height: 22, borderRadius: '50%', background: b.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Check size={13} color="white" strokeWidth={3}/>
                  </div>
                )}
                {/* LOGO IMAGE */}
                <div style={{
                  width: '100%', height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: '#f8fafc', borderRadius: 12, padding: '10px 16px',
                }}>
                  <img src={b.logo} alt={b.label} style={{ maxHeight: 52, maxWidth: '100%', objectFit: 'contain' }}/>
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: b.color, letterSpacing: '-0.2px' }}>
                  {b.label}
                </div>
              </button>
            ))}
          </div>

          <button
            disabled={!selectedBrand}
            onClick={() => setStep('form')}
            style={{
              width: '100%', padding: '15px', borderRadius: 14,
              background: selectedBrand ? (brand?.color || '#1B5E46') : '#e2e8f0',
              color: selectedBrand ? 'white' : '#94a3b8',
              border: 'none', cursor: selectedBrand ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', fontSize: 15, fontWeight: 800,
              boxShadow: selectedBrand ? `0 6px 20px ${brand?.color || '#1B5E46'}35` : 'none',
              transition: 'all .15s',
            }}
          >
            Continuer — Remplir le devis →
          </button>
        </div>
      </Layout>
    );
  }

  // ── STEP 2: Form ────────────────────────────────────────────────────────
  const inputCss = {
    padding: '8px 12px', borderRadius: 8, border: '1.5px solid #e2e8f0',
    fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%',
    color: '#0f172a', background: 'white',
  };
  const labelCss = {
    fontSize: 11, fontWeight: 700, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5, display: 'block',
  };
  const sectionCss = {
    background: 'white', borderRadius: 18, border: '1px solid #e8edf5',
    boxShadow: '0 2px 12px rgba(0,0,0,.05)', padding: '20px 24px', marginBottom: 20,
  };

  return (
    <Layout>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 24, flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={() => setStep('brand')} style={{
            width: 36, height: 36, borderRadius: 10, background: '#f8fafc',
            border: '1.5px solid #e2e8f0', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ArrowLeft size={15} color="#64748b"/>
          </button>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', letterSpacing: '-0.5px', margin: 0 }}>
              Nouveau devis
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              {brand && (
                <img src={brand.logo} alt={brand.label}
                  style={{ height: 20, objectFit: 'contain', borderRadius: 3 }}/>
              )}
              <span style={{
                fontSize: 11, fontWeight: 700, color: brand?.color,
                background: brand?.color + '12', padding: '2px 10px', borderRadius: 99,
                border: `1px solid ${brand?.color}30`,
              }}>{brand?.label}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => generatePDF(devis, brand, false)} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px',
            background: brand?.color || '#96B055', color: 'white',
            border: 'none', borderRadius: 11, fontWeight: 700, fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: `0 4px 14px ${brand?.color || '#96B055'}35`,
          }}>
            <Download size={14}/> PDF
          </button>
          <button onClick={() => generatePDF(devis, brand, true)} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px',
            background: 'white', color: brand?.color || '#96B055',
            border: `2px solid ${brand?.color || '#96B055'}`, borderRadius: 11, fontWeight: 700, fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <Download size={14}/> Word
          </button>
        </div>
      </div>

      {/* Client + Interlocuteur */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 0 }}>
        <div style={sectionCss}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <User size={14} color={brand?.color}/><span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>Client</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <div><label style={labelCss}>Nom du client *</label>
              <input value={devis.clientName} onChange={e => setDevis(d => ({...d, clientName: e.target.value}))} placeholder="Ex: Rousseau Automobile" style={inputCss}/></div>
            <div><label style={labelCss}>À l'attention de</label>
              <input value={devis.clientContact} onChange={e => setDevis(d => ({...d, clientContact: e.target.value}))} placeholder="Nom du contact" style={inputCss}/></div>
            <div><label style={labelCss}>E-mail client</label>
              <input value={devis.clientEmail} onChange={e => setDevis(d => ({...d, clientEmail: e.target.value}))} placeholder="contact@client.com" style={inputCss}/></div>
            <div><label style={labelCss}>Affaire / Objet</label>
              <input value={devis.affair} onChange={e => setDevis(d => ({...d, affair: e.target.value}))} placeholder="Ex: Migration cloud Q1 2026" style={inputCss}/></div>
          </div>
        </div>
        <div style={sectionCss}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Building2 size={14} color={brand?.color}/><span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>Interlocuteur</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <div><label style={labelCss}>Nom complet</label>
              <input value={devis.contactName} onChange={e => setDevis(d => ({...d, contactName: e.target.value}))} placeholder="Prénom NOM" style={inputCss}/></div>
            <div><label style={labelCss}>E-mail</label>
              <input value={devis.contactEmail} onChange={e => setDevis(d => ({...d, contactEmail: e.target.value}))} placeholder="email@teamwillgroup.com" style={inputCss}/></div>
            <div><label style={labelCss}>Téléphone</label>
              <input value={devis.contactPhone} onChange={e => setDevis(d => ({...d, contactPhone: e.target.value}))} placeholder="00216 XX XXX XXX" style={inputCss}/></div>
            <div><label style={labelCss}>Date de livraison</label>
              <input type="date" value={devis.deliveryDate} onChange={e => setDevis(d => ({...d, deliveryDate: e.target.value}))} style={inputCss}/></div>
          </div>
        </div>
      </div>

      {/* Lines table */}
      <div style={{ background: 'white', borderRadius: 18, border: '1px solid #f1f1f8', boxShadow: '0 2px 12px rgba(0,0,0,.05)', overflow: 'hidden', marginBottom: 20 }}>
        {/* Table header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 70px 120px 70px 80px 110px 36px',
          gap: 8, padding: '10px 16px', background: brand?.color || '#96B055',
        }}>
          {['Description / Prestations', 'Qté', 'Montant € HT', 'Remise', 'TVA %', 'Total HT', ''].map((h, i) => (
            <div key={i} style={{
              fontSize: 10, fontWeight: 800, color: 'white',
              textTransform: 'uppercase', letterSpacing: '.05em',
              textAlign: i >= 1 && i <= 4 ? 'center' : 'left',
            }}>{h}</div>
          ))}
        </div>

        {/* Rows */}
        {devis.lines.length === 0 ? (
          <div style={{ padding: '28px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            Aucune ligne — cliquez sur "Ajouter une prestation"
          </div>
        ) : devis.lines.map((line, idx) => (
          <LineRow
            key={line.id} line={line} idx={idx}
            onChange={updated => updateLine(line.id, updated)}
            onRemove={() => removeLine(line.id)}
            brandColor={brand?.color || '#1B5E46'}
            costsData={costsData}
          />
        ))}

        {/* Actions row */}
        <div style={{
          padding: '12px 16px', borderTop: '1px solid #f1f5f9',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => setDevis(d => ({ ...d, lines: [...d.lines, newPrestation()] }))}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                background: (brand?.color || '#96B055') + '15', color: brand?.color || '#96B055',
                border: `1.5px dashed ${brand?.color || '#96B055'}80`, borderRadius: 8,
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
              }}
            >
              <Plus size={12}/> Ajouter une prestation
            </button>
            <CostServerPicker
              costsData={costsData}
              brandColor={brand?.color || '#1B5E46'}
              onSelect={c => setDevis(d => ({ ...d, lines: [...d.lines, newServerLine(c)] }))}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Percent size={13} color="#64748b"/>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap' }}>Remise globale</span>
            <div style={{ position: 'relative', width: 80 }}>
              <input type="number" min="0" max="100" step="1"
                value={devis.globalDiscount}
                onChange={e => setDevis(d => ({ ...d, globalDiscount: e.target.value }))}
                style={{ padding: '6px 22px 6px 8px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', width: '100%', outline: 'none' }}/>
              <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#94a3b8', pointerEvents: 'none' }}>%</span>
            </div>
          </div>
        </div>

        {/* Totals */}
        <div style={{ borderTop: '2px solid #f1f5f9', padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: 320 }}>
              {/* Remise globale — always visible when > 0 */}
              {Number(devis.globalDiscount) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 14px', marginBottom: 2, background: '#fff5f5', borderRadius: 8, border: '1px solid #fca5a580' }}>
                  <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>Remise globale ({devis.globalDiscount}%)</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626' }}>- {fmt2(totalHT - afterGlobal)} €</span>
                </div>
              )}
              {(() => {
                // Compute effective weighted TVA rate for display
                const effTvaRate = afterGlobal > 0 ? (tva / afterGlobal * 100) : 0;
                const tvaLabel = `Total TVA (${effTvaRate % 1 === 0 ? effTvaRate.toFixed(0) : effTvaRate.toFixed(1)}%)`;
                return [
                  { label: 'Total HT', value: fmt2(afterGlobal) + ' €', bold: false },
                  { label: tvaLabel, value: fmt2(tva) + ' €', bold: false },
                  { label: 'Total TTC', value: fmt2(ttc) + ' €', bold: true },
                ].map(row => (
                  <div key={row.label} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 14px', borderRadius: row.bold ? 10 : 0,
                    background: row.bold ? (brand?.color || '#96B055') : 'transparent',
                    marginTop: row.bold ? 6 : 0,
                  }}>
                    <span style={{ fontSize: row.bold ? 13 : 12, fontWeight: row.bold ? 800 : 600, color: row.bold ? 'white' : '#64748b' }}>{row.label}</span>
                    <span style={{ fontSize: row.bold ? 16 : 13, fontWeight: row.bold ? 900 : 700, color: row.bold ? 'white' : '#0f172a' }}>{row.value}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Conditions + Notes */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={sectionCss}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Calendar size={14} color="#f59e0b"/>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>Conditions de facturation</span>
          </div>
          <textarea value={devis.conditions} onChange={e => setDevis(d => ({...d, conditions: e.target.value}))}
            rows={4} placeholder="50% à la commande&#10;50% à la livraison"
            style={{ ...inputCss, resize: 'vertical', lineHeight: 1.6 }}/>
        </div>
        <div style={sectionCss}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <FileText size={14} color="#64748b"/>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>Commentaires / Notes</span>
          </div>
          <textarea value={devis.notes} onChange={e => setDevis(d => ({...d, notes: e.target.value}))}
            rows={4} placeholder="Remarques, conditions spéciales…"
            style={{ ...inputCss, resize: 'vertical', lineHeight: 1.6 }}/>
        </div>
      </div>
      {/* Signature block */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={sectionCss}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 16 }}>✍️</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>Bon pour accord — Client</span>
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>Nom, prénom & qualité du signataire :</div>
          <input
            value={devis.clientSignerName}
            onChange={e => setDevis(d => ({ ...d, clientSignerName: e.target.value }))}
            placeholder="Prénom Nom — Fonction"
            style={{ ...inputCss, marginBottom: 10, fontSize: 12 }}
          />
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>Signature & cachet :</div>
          <SignaturePad
            brandColor={brand?.color || '#96B055'}
            onSave={dataUrl => setDevis(d => ({ ...d, clientSignature: dataUrl }))}
          />
          {devis.clientSignature && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: '#10b981', fontWeight: 700 }}>✓ Signature enregistrée</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
            <span>Date :</span>
            <input
              type="date"
              value={devis.clientSignatureDate}
              onChange={e => setDevis(d => ({ ...d, clientSignatureDate: e.target.value }))}
              style={{ fontSize: 11, border: '1px solid #e2e8f0', borderRadius: 6, padding: '3px 6px', fontFamily: 'inherit', color: '#374151', outline: 'none', background: 'white' }}
            />
          </div>
        </div>
        <div style={{ ...sectionCss, background: brand?.color ? brand.color + '06' : '#f8fafc', border: `1px solid ${brand?.color ? brand.color + '30' : '#e8edf5'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 16 }}>🏢</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>Émis par — {brand?.label}</span>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>{devis.contactName || '—'}</div>
          {devis.contactEmail && <div style={{ fontSize: 11, color: '#2563eb', marginBottom: 2 }}>{devis.contactEmail}</div>}
          {devis.contactPhone && <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>{devis.contactPhone}</div>}
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>Signature :</div>
          <SignaturePad
            brandColor={brand?.color || '#96B055'}
            onSave={dataUrl => setDevis(d => ({ ...d, issuerSignature: dataUrl }))}
          />
          {devis.issuerSignature && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: '#10b981', fontWeight: 700 }}>✓ Signature enregistrée</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
            <span>Signature</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>Date :</span>
              <input
                type="date"
                value={devis.issuerSignatureDate}
                onChange={e => setDevis(d => ({ ...d, issuerSignatureDate: e.target.value }))}
                style={{ fontSize: 11, border: '1px solid #e2e8f0', borderRadius: 6, padding: '3px 6px', fontFamily: 'inherit', color: '#374151', outline: 'none', background: 'white' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom CTA */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingBottom: 28, marginTop: 4 }}>
        <button onClick={() => generatePDF(devis, brand, true)} style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '14px 28px',
          background: 'white', color: brand?.color || '#96B055',
          border: `2px solid ${brand?.color || '#96B055'}`, borderRadius: 13,
          fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <Download size={16}/> Télécharger Word (.doc)
        </button>
        <button onClick={() => generatePDF(devis, brand, false)} style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '14px 28px',
          background: brand?.color || '#96B055', color: 'white', border: 'none', borderRadius: 13,
          fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
          boxShadow: `0 6px 20px ${brand?.color || '#96B055'}35`,
        }}>
          <Download size={16}/> Générer &amp; Télécharger PDF
        </button>
      </div>
    </Layout>
  );
}
