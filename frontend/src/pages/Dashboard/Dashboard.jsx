import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import {
  DollarSign, Zap, FolderOpen, TrendingUp, FileText,
  Activity, Download, RefreshCw, ArrowUpRight, ArrowDownRight,
  AlertTriangle, BarChart2, Receipt, Percent,
} from 'lucide-react';
import Layout from '../Layout/Layout';
import { costsService } from '../../services/costs';
import toast from 'react-hot-toast';

// ─── Palette ──────────────────────────────────────────────────────────────────
const COLORS = ['#1B5E46', '#2e7d52', '#43a06b', '#6abf8a', '#a0dbb5', '#d0f0e0'];

// ─── Constants ────────────────────────────────────────────────────────────────
const TVA_RATE = 0.20;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt2 = (n) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// ─── Sub-components ───────────────────────────────────────────────────────────
function KPICard({ label, value, icon: Icon, topColor = '#1B5E46', iconBg = '#1B5E46', sub, trend }) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: 16,
      overflow: 'hidden',
      boxShadow: '0 2px 12px rgba(0,0,0,.07)',
      flex: '1 1 180px',
      minWidth: 180,
    }}>
      <div style={{ height: 5, background: topColor }} />
      <div style={{ padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{label}</p>
            <p style={{ fontSize: 26, fontWeight: 900, color: '#0f172a', margin: 0 }}>{value}</p>
            {sub && <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{sub}</p>}
          </div>
          <div style={{ background: iconBg, borderRadius: 12, padding: 10, display: 'flex' }}>
            {Icon && <Icon size={20} color="#fff" />}
          </div>
        </div>
        {trend !== null && trend !== undefined && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
            {trend >= 0
              ? <ArrowUpRight size={14} color="#ef4444" />
              : <ArrowDownRight size={14} color="#22c55e" />}
            <span style={{ fontSize: 12, color: trend >= 0 ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
              {Math.abs(trend).toFixed(1)}%
            </span>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>vs mois précédent</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ChartCard({ title, sub, children, style }) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: 16,
      padding: '20px 24px',
      boxShadow: '0 2px 12px rgba(0,0,0,.07)',
      ...style,
    }}>
      {title && <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: '0 0 2px' }}>{title}</h3>}
      {sub && <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 16px' }}>{sub}</p>}
      {children}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [analytics, setAnalytics] = useState(null);
  const [costs, setCosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  const loadData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const [analyticsData, costsData] = await Promise.all([
        costsService.getAnalytics(),
        costsService.getCosts({ limit: 100 }),
      ]);
      setAnalytics(analyticsData);
      setCosts(costsData?.items || costsData || []);
    } catch (e) {
      toast.error('Erreur de chargement des données');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Derived chart data ──
  const monthlyData = useMemo(() => {
    const map = {};
    costs.forEach(c => {
      const key = c.cost_date?.slice(0, 7) || 'N/A';
      map[key] = (map[key] || 0) + (c.amount || 0);
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, total]) => ({ month, total: +total.toFixed(2) }));
  }, [costs]);

  const serviceData = useMemo(() => {
    const map = {};
    costs.forEach(c => {
      const svc = c.service_name || 'Inconnu';
      map[svc] = (map[svc] || 0) + (c.amount || 0);
    });
    return Object.entries(map)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([name, value]) => ({ name, value: +value.toFixed(2) }));
  }, [costs]);

  if (loading) {
    return (
      <Layout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
          <div style={{ textAlign: 'center' }}>
            <RefreshCw size={32} color="#1B5E46" style={{ animation: 'spin 1s linear infinite' }} />
            <p style={{ marginTop: 12, color: '#64748b' }}>Chargement du tableau de bord…</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div style={{ padding: '24px 28px', background: '#f8fafc', minHeight: '100vh' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 900, color: '#0f172a', margin: 0 }}>FinOps Dashboard</h1>
            <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Vue d'ensemble de vos coûts cloud OVH</p>
          </div>
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#1B5E46', color: '#fff', border: 'none',
              borderRadius: 10, padding: '9px 18px', cursor: 'pointer',
              fontSize: 13, fontWeight: 600,
            }}
          >
            <RefreshCw size={15} style={refreshing ? { animation: 'spin 1s linear infinite' } : {}} />
            {refreshing ? 'Actualisation…' : 'Actualiser'}
          </button>
        </div>

        {/* ── KPI Cards ── */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <KPICard
            label="Coût total"
            value={`${fmt2(analytics?.total || 0)} €`}
            icon={DollarSign}
            topColor="#1B5E46"
            iconBg="#1B5E46"
            sub="Total HT"
            trend={analytics?.trend ?? null}
          />
          <KPICard
            label="Total TTC"
            value={`${fmt2((analytics?.total || 0) * (1 + TVA_RATE))} €`}
            icon={Receipt}
            topColor="#f59e0b"
            iconBg="#f59e0b"
            sub="TVA 20% incluse"
            trend={null}
          />
          <KPICard
            label="TVA (20%)"
            value={`${fmt2((analytics?.total || 0) * TVA_RATE)} €`}
            icon={Percent}
            topColor="#8b5cf6"
            iconBg="#8b5cf6"
            sub="Montant TVA"
            trend={null}
          />
          <KPICard
            label="Nb de services"
            value={analytics?.service_count ?? (costs.length > 0 ? serviceData.length : 0)}
            icon={FolderOpen}
            topColor="#0ea5e9"
            iconBg="#0ea5e9"
            sub="Services actifs"
            trend={null}
          />
          <KPICard
            label="Nb de coûts"
            value={analytics?.count ?? costs.length}
            icon={FileText}
            topColor="#6366f1"
            iconBg="#6366f1"
            sub="Entrées enregistrées"
            trend={null}
          />
        </div>

        {/* ── TVA Breakdown Section ── */}
        <ChartCard title="Récapitulatif Fiscal" sub="Décomposition HT / TVA / TTC" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* HT block */}
            <div style={{ flex: 1, minWidth: 140, background: '#f0fdf4', borderRadius: 14, padding: '16px 20px', border: '1.5px solid #bbf7d0' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Total HT</p>
              <p style={{ fontSize: 28, fontWeight: 900, color: '#0f172a', margin: 0 }}>{fmt2(analytics?.total || 0)} <span style={{ fontSize: 14, color: '#94a3b8' }}>€</span></p>
              <p style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Hors taxes</p>
            </div>
            {/* TVA block */}
            <div style={{ fontSize: 22, color: '#94a3b8', fontWeight: 300 }}>+</div>
            <div style={{ flex: 1, minWidth: 140, background: '#faf5ff', borderRadius: 14, padding: '16px 20px', border: '1.5px solid #e9d5ff' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>TVA 20%</p>
              <p style={{ fontSize: 28, fontWeight: 900, color: '#0f172a', margin: 0 }}>{fmt2((analytics?.total || 0) * TVA_RATE)} <span style={{ fontSize: 14, color: '#94a3b8' }}>€</span></p>
              <p style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Taxe sur la valeur ajoutée</p>
            </div>
            {/* = sign */}
            <div style={{ fontSize: 22, color: '#94a3b8', fontWeight: 300 }}>=</div>
            {/* TTC block */}
            <div style={{ flex: 1, minWidth: 140, background: '#fffbeb', borderRadius: 14, padding: '16px 20px', border: '1.5px solid #fde68a' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Total TTC</p>
              <p style={{ fontSize: 28, fontWeight: 900, color: '#0f172a', margin: 0 }}>{fmt2((analytics?.total || 0) * (1 + TVA_RATE))} <span style={{ fontSize: 14, color: '#94a3b8' }}>€</span></p>
              <p style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Toutes taxes comprises</p>
            </div>
            {/* Info note */}
            <div style={{ flex: 2, minWidth: 200, background: '#f8fafc', borderRadius: 14, padding: '16px 20px', border: '1.5px solid #e2e8f0' }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>ℹ️ Calcul TVA</p>
              <p style={{ fontSize: 11, color: '#64748b', lineHeight: 1.6 }}>
                Les montants affichés dans la liste des coûts sont <strong>Hors Taxes (HT)</strong>.<br />
                La TVA française au taux de <strong>20%</strong> est appliquée sur le total HT.<br />
                Le montant TTC correspond au débit réel sur votre compte.
              </p>
            </div>
          </div>
        </ChartCard>

        {/* ── Charts ── */}
        {analytics && (
          <div>
            {/* Row 1: Monthly trend + Service breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
              <ChartCard title="Évolution mensuelle" sub="Coûts HT par mois">
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={monthlyData}>
                    <defs>
                      <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1B5E46" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#1B5E46" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v} €`} />
                    <Tooltip formatter={v => [`${fmt2(v)} €`, 'Total HT']} />
                    <Area type="monotone" dataKey="total" stroke="#1B5E46" strokeWidth={2} fill="url(#colorTotal)" />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Répartition par service" sub="Top 6 services">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={serviceData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {serviceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={v => [`${fmt2(v)} €`]} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Row 2: Bar chart */}
            <ChartCard title="Coûts par service" sub="Montants HT" style={{ marginBottom: 20 }}>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={serviceData} margin={{ top: 10, right: 20, left: 0, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v} €`} />
                  <Tooltip formatter={v => [`${fmt2(v)} €`, 'Coût HT']} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {serviceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        )}
      </div>
    </Layout>
  );
}
