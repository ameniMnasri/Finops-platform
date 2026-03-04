import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, User, ArrowRight, CheckCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

function RightPanel() {
  return (
    <div style={{
      flex: 1,
      background: 'linear-gradient(145deg, #1B5E46 0%, #2A8659 40%, #3d9e6e 70%, #4CAF50 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '60px 40px', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', width: 400, height: 400, borderRadius: '50%', background: 'rgba(255,255,255,.05)', top: -100, right: -100 }} />
      <div style={{ position: 'absolute', width: 300, height: 300, borderRadius: '50%', background: 'rgba(255,255,255,.04)', bottom: -80, left: -80 }} />

      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: 400 }}>
        <h2 style={{ color: 'white', fontSize: 30, fontWeight: 800, marginBottom: 12, lineHeight: 1.2 }}>
          Rejoignez TeamWill<br />FinOps dès aujourd'hui
        </h2>
        <p style={{ color: 'rgba(255,255,255,.75)', fontSize: 14, marginBottom: 48, lineHeight: 1.6 }}>
          Créez votre compte et commencez à optimiser vos coûts cloud immédiatement.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, textAlign: 'left' }}>
          {[
            'Tableau de bord personnalisé',
            'Import CSV, Excel et PDF',
            'Rapports automatiques',
            'Alertes de dépassement',
            'Collaboration en équipe',
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <CheckCircle size={18} color="#86efac" style={{ flexShrink: 0 }} />
              <span style={{ color: 'rgba(255,255,255,.85)', fontSize: 14, fontWeight: 500 }}>{item}</span>
            </div>
          ))}
        </div>

        <div style={{
          marginTop: 48, padding: '20px 24px',
          background: 'rgba(255,255,255,.1)', borderRadius: 16,
          border: '1px solid rgba(255,255,255,.2)',
        }}>
          <p style={{ color: 'white', fontSize: 13, fontStyle: 'italic', marginBottom: 12, lineHeight: 1.6 }}>
            "TeamWill FinOps nous a permis de réduire nos coûts cloud de 30% en seulement 3 mois."
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'rgba(255,255,255,.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, color: 'white', fontSize: 14,
            }}>M</div>
            <div>
              <p style={{ color: 'white', fontWeight: 700, fontSize: 13 }}>Marie Dupont</p>
              <p style={{ color: 'rgba(255,255,255,.6)', fontSize: 11 }}>CTO, TechCorp</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Register() {
  const [email,    setEmail]    = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 6) { toast.error('Mot de passe trop court (6 caractères min)'); return; }
    setLoading(true);
    try {
      await register(email, fullName, password);
      toast.success('Compte créé avec succès !');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Erreur lors de l'inscription");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '12px 44px 12px 16px',
    border: '1.5px solid #e2e8f0', borderRadius: 10,
    fontSize: 14, color: '#1a202c', outline: 'none',
    transition: 'border-color .2s, box-shadow .2s',
    background: '#fafbfc', fontFamily: 'inherit',
    boxSizing: 'border-box',
  };

  const onFocus = e => { e.target.style.borderColor = '#1B5E46'; e.target.style.boxShadow = '0 0 0 3px rgba(27,94,70,.1)'; e.target.style.background = 'white'; };
  const onBlur  = e => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#fafbfc'; };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: '#f8fafc', fontFamily: 'Inter, sans-serif' }}>

      {/* Formulaire */}
      <div style={{
        width: '100%', maxWidth: 520,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '60px 56px', background: 'white',
        boxShadow: '4px 0 32px rgba(0,0,0,.06)',
        position: 'relative', zIndex: 1,
      }}>
        {/* Logo */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'linear-gradient(135deg, #1B5E46, #4CAF50)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 900, fontSize: 20, color: 'white',
              boxShadow: '0 4px 12px rgba(27,94,70,.3)',
            }}>T</div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a202c', lineHeight: 1 }}>TeamWill</h1>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#1B5E46', background: '#E8F5E9', padding: '2px 8px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                FinOps Platform
              </span>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: '#1a202c', marginBottom: 6, letterSpacing: '-.4px' }}>
            Créer un compte
          </h2>
          <p style={{ fontSize: 14, color: '#64748b' }}>Commencez à optimiser vos coûts cloud</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Nom */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Nom complet</label>
            <div style={{ position: 'relative' }}>
              <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                required placeholder="Jean Dupont" style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
              <User size={16} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            </div>
          </div>

          {/* Email */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Email</label>
            <div style={{ position: 'relative' }}>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                required placeholder="email@teamwill.com" style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
              <Mail size={16} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            </div>
          </div>

          {/* Mot de passe */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Mot de passe</label>
            <div style={{ position: 'relative' }}>
              <input type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                required placeholder="Min. 6 caractères" style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
              <button type="button" onClick={() => setShowPwd(!showPwd)} style={{
                position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4,
              }}>
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {password.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', gap: 4 }}>
                {[1,2,3,4].map(i => (
                  <div key={i} style={{
                    flex: 1, height: 3, borderRadius: 99,
                    background: password.length >= i * 3
                      ? i <= 1 ? '#ef4444' : i === 2 ? '#f97316' : i === 3 ? '#eab308' : '#16a34a'
                      : '#e2e8f0',
                    transition: 'background .3s',
                  }} />
                ))}
              </div>
            )}
          </div>

          <button type="submit" disabled={loading} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '13px 24px', marginTop: 4,
            background: loading ? '#94a3b8' : 'linear-gradient(135deg, #1B5E46, #2A8659)',
            color: 'white', fontWeight: 700, fontSize: 15,
            border: 'none', borderRadius: 10, cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'all .2s', boxShadow: loading ? 'none' : '0 4px 16px rgba(27,94,70,.35)',
            fontFamily: 'inherit',
          }}>
            {loading ? (
              <><div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(255,255,255,.4)', borderTopColor: 'white', animation: 'spin .7s linear infinite' }} /> Création...</>
            ) : (
              <>Créer mon compte <ArrowRight size={16} /></>
            )}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: 13, color: '#64748b', marginTop: 24 }}>
          Déjà un compte ?{' '}
          <Link to="/login" style={{ color: '#1B5E46', fontWeight: 700, textDecoration: 'none' }}>
            Se connecter
          </Link>
        </p>

        <p style={{ position: 'absolute', bottom: 28, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: '#94a3b8' }}>
          © 2026 TeamWill Consulting | FinOps Platform v1.0
        </p>
      </div>

      <RightPanel />
    </div>
  );
}