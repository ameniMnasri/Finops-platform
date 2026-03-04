import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, ArrowRight, TrendingDown, BarChart2, Shield } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

// ─── Panneau droit — visuel décoratif ───────────────────────────────
function RightPanel() {
  return (
    <div style={{
      flex: 1,
      background: 'linear-gradient(145deg, #1B5E46 0%, #2A8659 40%, #3d9e6e 70%, #4CAF50 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '60px 40px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Cercles décoratifs */}
      <div style={{
        position: 'absolute', width: 400, height: 400, borderRadius: '50%',
        background: 'rgba(255,255,255,.05)', top: -100, right: -100,
      }} />
      <div style={{
        position: 'absolute', width: 300, height: 300, borderRadius: '50%',
        background: 'rgba(255,255,255,.04)', bottom: -80, left: -80,
      }} />
      <div style={{
        position: 'absolute', width: 200, height: 200, borderRadius: '50%',
        background: 'rgba(255,255,255,.06)', top: '40%', right: '10%',
      }} />

      {/* Contenu */}
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: 420 }}>

        {/* Titre */}
        <h2 style={{
          color: 'white', fontSize: 32, fontWeight: 800,
          letterSpacing: '-.5px', marginBottom: 12, lineHeight: 1.2,
        }}>
          Optimisez vos coûts<br />cloud en temps réel
        </h2>
        <p style={{ color: 'rgba(255,255,255,.75)', fontSize: 15, marginBottom: 48, lineHeight: 1.6 }}>
          Analysez, suivez et réduisez vos dépenses cloud<br />avec la plateforme FinOps de TeamWill.
        </p>

        {/* Mock dashboard card */}
        <div style={{
          background: 'rgba(255,255,255,.12)',
          backdropFilter: 'blur(12px)',
          borderRadius: 20,
          padding: '24px',
          border: '1px solid rgba(255,255,255,.2)',
          marginBottom: 32,
        }}>
          {/* Mini header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <span style={{ color: 'white', fontWeight: 700, fontSize: 14 }}>Vue d'ensemble</span>
            <span style={{ color: 'rgba(255,255,255,.6)', fontSize: 12 }}>Ce mois</span>
          </div>

          {/* Mini KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Coût total',  value: '12 450 €', trend: '-8%',  up: false },
              { label: 'Services',    value: '24',       trend: '+3',   up: true  },
              { label: 'Projets',     value: '7',        trend: '+1',   up: true  },
              { label: 'Économies',   value: '2 300 €',  trend: '+15%', up: true  },
            ].map((k, i) => (
              <div key={i} style={{
                background: 'rgba(255,255,255,.1)',
                borderRadius: 12, padding: '12px 14px',
              }}>
                <p style={{ color: 'rgba(255,255,255,.65)', fontSize: 11, marginBottom: 4 }}>{k.label}</p>
                <p style={{ color: 'white', fontWeight: 800, fontSize: 18 }}>{k.value}</p>
                <p style={{ color: k.up ? '#86efac' : '#fca5a5', fontSize: 11, marginTop: 2, fontWeight: 600 }}>
                  {k.trend}
                </p>
              </div>
            ))}
          </div>

          {/* Mini bar chart simulé */}
          <div style={{ marginBottom: 8 }}>
            <p style={{ color: 'rgba(255,255,255,.6)', fontSize: 11, marginBottom: 8 }}>Évolution des coûts</p>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 50 }}>
              {[35, 55, 40, 70, 45, 80, 60, 75, 50, 90, 65, 85].map((h, i) => (
                <div key={i} style={{
                  flex: 1, height: `${h}%`, borderRadius: '4px 4px 0 0',
                  background: i === 11 ? 'white' : 'rgba(255,255,255,.35)',
                  transition: 'height .3s',
                }} />
              ))}
            </div>
          </div>
        </div>

        {/* Features */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { icon: BarChart2,   text: 'Tableaux de bord en temps réel'    },
            { icon: TrendingDown, text: 'Réduction automatique des coûts'   },
            { icon: Shield,      text: 'Sécurité et conformité garanties'   },
          ].map(({ icon: Icon, text }, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10,
                background: 'rgba(255,255,255,.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Icon size={16} color="white" />
              </div>
              <span style={{ color: 'rgba(255,255,255,.85)', fontSize: 13, fontWeight: 500 }}>{text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Composant Login ─────────────────────────────────────────────────
export default function Login() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const { login } = useAuth();
  const navigate  = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success('Bienvenue !');
      navigate('/dashboard');
    } catch {
      toast.error('Email ou mot de passe incorrect');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      background: '#f8fafc',
      fontFamily: 'Inter, sans-serif',
    }}>

      {/* ── Panneau gauche — formulaire ── */}
      <div style={{
        width: '100%',
        maxWidth: 520,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '60px 56px',
        background: 'white',
        boxShadow: '4px 0 32px rgba(0,0,0,.06)',
        position: 'relative',
        zIndex: 1,
      }}>

        {/* Logo */}
        <div style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'linear-gradient(135deg, #1B5E46, #4CAF50)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 900, fontSize: 20, color: 'white',
              boxShadow: '0 4px 12px rgba(27,94,70,.3)',
            }}>T</div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a202c', lineHeight: 1 }}>TeamWill</h1>
              <span style={{
                fontSize: 10, fontWeight: 700, color: '#1B5E46',
                background: '#E8F5E9', padding: '2px 8px', borderRadius: 99,
                textTransform: 'uppercase', letterSpacing: '.08em',
              }}>FinOps Platform</span>
            </div>
          </div>
        </div>

        {/* Titre */}
        <div style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: '#1a202c', marginBottom: 6, letterSpacing: '-.4px' }}>
            Connectez-vous
          </h2>
          <p style={{ fontSize: 14, color: '#64748b' }}>
            Accédez à votre dashboard FinOps
          </p>
        </div>

        {/* Formulaire */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Email */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
              Email
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="email@teamwill.com"
                style={{
                  width: '100%', padding: '12px 44px 12px 16px',
                  border: '1.5px solid #e2e8f0', borderRadius: 10,
                  fontSize: 14, color: '#1a202c', outline: 'none',
                  transition: 'border-color .2s, box-shadow .2s',
                  background: '#fafbfc', fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
                onFocus={e => { e.target.style.borderColor = '#1B5E46'; e.target.style.boxShadow = '0 0 0 3px rgba(27,94,70,.1)'; e.target.style.background = 'white'; }}
                onBlur={e  => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#fafbfc'; }}
              />
              <Mail size={16} style={{
                position: 'absolute', right: 14, top: '50%',
                transform: 'translateY(-50%)', color: '#94a3b8',
              }} />
            </div>
          </div>

          {/* Mot de passe */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                Mot de passe
              </label>
              <a href="#" style={{ fontSize: 12, color: '#1B5E46', fontWeight: 500, textDecoration: 'none' }}
                onClick={e => e.preventDefault()}>
                Oublié ?
              </a>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                style={{
                  width: '100%', padding: '12px 44px 12px 16px',
                  border: '1.5px solid #e2e8f0', borderRadius: 10,
                  fontSize: 14, color: '#1a202c', outline: 'none',
                  transition: 'border-color .2s, box-shadow .2s',
                  background: '#fafbfc', fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
                onFocus={e => { e.target.style.borderColor = '#1B5E46'; e.target.style.boxShadow = '0 0 0 3px rgba(27,94,70,.1)'; e.target.style.background = 'white'; }}
                onBlur={e  => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#fafbfc'; }}
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8',
                  padding: 4, display: 'flex', alignItems: 'center',
                }}
              >
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Bouton */}
          <button
            type="submit"
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '13px 24px', marginTop: 4,
              background: loading ? '#94a3b8' : 'linear-gradient(135deg, #1B5E46, #2A8659)',
              color: 'white', fontWeight: 700, fontSize: 15,
              border: 'none', borderRadius: 10, cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all .2s',
              boxShadow: loading ? 'none' : '0 4px 16px rgba(27,94,70,.35)',
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}
          >
            {loading ? (
              <>
                <div style={{
                  width: 16, height: 16, borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,.4)',
                  borderTopColor: 'white',
                  animation: 'spin .7s linear infinite',
                }} />
                Connexion...
              </>
            ) : (
              <>Se connecter <ArrowRight size={16} /></>
            )}
          </button>
        </form>

        {/* Lien inscription */}
        <p style={{ textAlign: 'center', fontSize: 13, color: '#64748b', marginTop: 28 }}>
          Pas de compte ?{' '}
          <Link to="/register" style={{ color: '#1B5E46', fontWeight: 700, textDecoration: 'none' }}>
            S'inscrire gratuitement
          </Link>
        </p>

        {/* Footer */}
        <p style={{
          position: 'absolute', bottom: 28, left: 0, right: 0,
          textAlign: 'center', fontSize: 11, color: '#94a3b8',
        }}>
          © 2024 TeamWill Consulting | FinOps Platform v1.0
        </p>
      </div>

      {/* ── Panneau droit — visuel ── */}
      <RightPanel />
    </div>
  );
}