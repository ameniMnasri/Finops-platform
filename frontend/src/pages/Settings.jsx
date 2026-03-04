import React, { useState } from 'react';
import {
  User, Bell, Shield, Globe, Palette,
  Database, Save, Check, Mail, Lock,
  Eye, EyeOff, AlertTriangle, Info,
  ChevronRight, Moon, Sun, Monitor,
} from 'lucide-react';
import Layout from '../components/Layout/Layout';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

// ─── Section card ────────────────────────────────────────────────────
function Section({ title, description, icon: Icon, children }) {
  return (
    <div style={{
      background: 'white', borderRadius: 16,
      border: '1px solid #e2e8f0',
      boxShadow: '0 1px 3px rgba(0,0,0,.04)',
      overflow: 'hidden', marginBottom: 20,
    }}>
      {/* Header section */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '20px 28px', borderBottom: '1px solid #f1f5f9',
        background: '#fafbfc',
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: 'linear-gradient(135deg, #1B5E46, #4CAF50)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Icon size={18} color="white" />
        </div>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1a202c' }}>{title}</h3>
          {description && <p style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>{description}</p>}
        </div>
      </div>
      <div style={{ padding: '24px 28px' }}>{children}</div>
    </div>
  );
}

// ─── Champ de paramètre ──────────────────────────────────────────────
function Field({ label, hint, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start',
      justifyContent: 'space-between', gap: 24,
      padding: '14px 0', borderBottom: '1px solid #f8fafc',
    }}>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{label}</p>
        {hint && <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>{hint}</p>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

// ─── Toggle switch ───────────────────────────────────────────────────
function Toggle({ checked, onChange, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {label && <span style={{ fontSize: 13, color: '#64748b' }}>{label}</span>}
      <button
        onClick={() => onChange(!checked)}
        style={{
          width: 44, height: 24, borderRadius: 99,
          background: checked ? '#1B5E46' : '#e2e8f0',
          border: 'none', cursor: 'pointer',
          position: 'relative', transition: 'background .2s',
          flexShrink: 0,
        }}
      >
        <div style={{
          width: 18, height: 18, borderRadius: '50%',
          background: 'white', position: 'absolute',
          top: 3, left: checked ? 23 : 3,
          transition: 'left .2s',
          boxShadow: '0 1px 4px rgba(0,0,0,.2)',
        }} />
      </button>
    </div>
  );
}

// ─── Badge version ───────────────────────────────────────────────────
function VersionBadge() {
  return (
    <div style={{
      background: 'linear-gradient(135deg, #1B5E46, #2A8659)',
      borderRadius: 12, padding: '16px 20px',
      display: 'flex', alignItems: 'center', gap: 16,
      marginBottom: 20, color: 'white',
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: 14,
        background: 'rgba(255,255,255,.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, fontWeight: 900,
      }}>T</div>
      <div>
        <p style={{ fontWeight: 800, fontSize: 16 }}>TeamWill FinOps Platform</p>
        <p style={{ opacity: .75, fontSize: 12, marginTop: 2 }}>Version 1.0.0 — Build 2024.02</p>
      </div>
      <div style={{ marginLeft: 'auto' }}>
        <span style={{
          background: 'rgba(255,255,255,.2)', padding: '4px 12px',
          borderRadius: 99, fontSize: 11, fontWeight: 700,
        }}>
          ✓ À jour
        </span>
      </div>
    </div>
  );
}

// ─── Composant principal ─────────────────────────────────────────────
export default function Settings() {
  const { user, logout } = useAuth();

  // Profil
  const [displayName, setDisplayName] = useState(user?.email?.split('@')[0] || '');
  const [email]                        = useState(user?.email || '');
  const [company,     setCompany]      = useState('TeamWill Consulting');
  const [role,        setRole]         = useState('Administrateur');

  // Mot de passe
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd,     setNewPwd]     = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPwds,   setShowPwds]   = useState({ current: false, new: false, confirm: false });

  // Notifications
  const [notifs, setNotifs] = useState({
    emailAlerts:    true,
    costThreshold:  true,
    weeklyReport:   true,
    newFile:        false,
    systemUpdates:  true,
  });

  // Apparence
  const [theme,    setTheme]    = useState('light');
  const [language, setLanguage] = useState('fr');
  const [currency, setCurrency] = useState('EUR');

  // API
  const [apiUrl,    setApiUrl]    = useState('http://localhost:8000');
  const [apiKey,    setApiKey]    = useState('••••••••••••••••••••••');
  const [showApiKey,setShowApiKey]= useState(false);

  // ── Handlers ──────────────────────────────────────────────────────
  const saveProfile = () => {
    toast.success('Profil mis à jour !');
  };

  const changePassword = () => {
    if (!currentPwd || !newPwd || !confirmPwd) { toast.error('Remplissez tous les champs'); return; }
    if (newPwd !== confirmPwd) { toast.error('Les mots de passe ne correspondent pas'); return; }
    if (newPwd.length < 6)    { toast.error('Mot de passe trop court'); return; }
    toast.success('Mot de passe modifié !');
    setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
  };

  const saveNotifs = () => toast.success('Préférences de notifications enregistrées !');
  const saveAppearance = () => toast.success('Apparence mise à jour !');
  const saveApi = () => toast.success('Configuration API sauvegardée !');

  const inputStyle = {
    width: '100%', padding: '10px 14px',
    border: '1.5px solid #e2e8f0', borderRadius: 10,
    fontSize: 14, color: '#1a202c', outline: 'none',
    background: '#fafbfc', fontFamily: 'inherit',
    boxSizing: 'border-box', transition: 'border-color .2s, box-shadow .2s',
  };

  const onFocus = e => { e.target.style.borderColor = '#1B5E46'; e.target.style.boxShadow = '0 0 0 3px rgba(27,94,70,.1)'; e.target.style.background = 'white'; };
  const onBlur  = e => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#fafbfc'; };

  const selectStyle = { ...inputStyle, cursor: 'pointer' };

  // ─────────────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="page-header">
        <div>
          <h1>Paramètres</h1>
          <p>Gérez votre compte et la configuration de la plateforme</p>
        </div>
      </div>

      {/* Badge version */}
      <VersionBadge />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* ── Colonne gauche ── */}
        <div>

          {/* Profil */}
          <Section icon={User} title="Profil utilisateur" description="Informations de votre compte">
            {/* Avatar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid #f1f5f9' }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%',
                background: 'linear-gradient(135deg, #1B5E46, #4CAF50)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 24, fontWeight: 800, color: 'white',
                boxShadow: '0 4px 12px rgba(27,94,70,.3)',
              }}>
                {user?.email?.charAt(0).toUpperCase()}
              </div>
              <div>
                <p style={{ fontWeight: 700, color: '#1a202c', fontSize: 15 }}>{displayName || user?.email?.split('@')[0]}</p>
                <p style={{ fontSize: 13, color: '#64748b' }}>{email}</p>
                <span style={{ background: '#dcfce7', color: '#166534', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, marginTop: 4, display: 'inline-block' }}>
                  Administrateur
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Nom d'affichage</label>
                <input style={inputStyle} value={displayName} onChange={e => setDisplayName(e.target.value)} onFocus={onFocus} onBlur={onBlur} placeholder="Votre nom" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Email</label>
                <input style={{ ...inputStyle, background: '#f1f5f9', color: '#94a3b8', cursor: 'not-allowed' }} value={email} readOnly />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Entreprise</label>
                  <input style={inputStyle} value={company} onChange={e => setCompany(e.target.value)} onFocus={onFocus} onBlur={onBlur} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Rôle</label>
                  <input style={{ ...inputStyle, background: '#f1f5f9', color: '#94a3b8', cursor: 'not-allowed' }} value={role} readOnly />
                </div>
              </div>
              <button onClick={saveProfile} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '10px 20px', background: '#1B5E46', color: 'white',
                fontWeight: 700, fontSize: 14, border: 'none', borderRadius: 10,
                cursor: 'pointer', marginTop: 4, fontFamily: 'inherit',
                boxShadow: '0 2px 8px rgba(27,94,70,.25)',
              }}>
                <Save size={15} /> Sauvegarder le profil
              </button>
            </div>
          </Section>

          {/* Notifications */}
          <Section icon={Bell} title="Notifications" description="Gérez vos alertes et emails">
            {[
              { key: 'emailAlerts',   label: 'Alertes par email',        hint: 'Recevoir les alertes importantes par email' },
              { key: 'costThreshold', label: 'Dépassement de seuil',     hint: 'Alerte quand un coût dépasse le budget' },
              { key: 'weeklyReport',  label: 'Rapport hebdomadaire',     hint: 'Résumé des coûts chaque lundi matin' },
              { key: 'newFile',       label: 'Nouveau fichier importé',  hint: 'Notification à chaque import réussi' },
              { key: 'systemUpdates', label: 'Mises à jour système',     hint: 'Informations sur les nouvelles fonctionnalités' },
            ].map(({ key, label, hint }) => (
              <Field key={key} label={label} hint={hint}>
                <Toggle
                  checked={notifs[key]}
                  onChange={v => setNotifs(n => ({ ...n, [key]: v }))}
                />
              </Field>
            ))}
            <button onClick={saveNotifs} style={{
              display: 'flex', alignItems: 'center', gap: 8, marginTop: 16,
              padding: '9px 18px', background: '#f1f5f9', color: '#475569',
              fontWeight: 600, fontSize: 13, border: '1px solid #e2e8f0',
              borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <Check size={14} /> Enregistrer les préférences
            </button>
          </Section>

        </div>

        {/* ── Colonne droite ── */}
        <div>

          {/* Sécurité */}
          <Section icon={Shield} title="Sécurité" description="Gérez votre mot de passe">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { key: 'current', label: 'Mot de passe actuel', value: currentPwd, set: setCurrentPwd, placeholder: '••••••••' },
                { key: 'new',     label: 'Nouveau mot de passe', value: newPwd,    set: setNewPwd,     placeholder: 'Min. 6 caractères' },
                { key: 'confirm', label: 'Confirmer',            value: confirmPwd,set: setConfirmPwd,  placeholder: 'Répétez le mot de passe' },
              ].map(({ key, label, value, set, placeholder }) => (
                <div key={key}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>{label}</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPwds[key] ? 'text' : 'password'}
                      value={value}
                      onChange={e => set(e.target.value)}
                      placeholder={placeholder}
                      style={{ ...inputStyle, paddingRight: 44 }}
                      onFocus={onFocus} onBlur={onBlur}
                    />
                    <button type="button"
                      onClick={() => setShowPwds(p => ({ ...p, [key]: !p[key] }))}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                      {showPwds[key] ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              ))}

              {/* Force mot de passe */}
              {newPwd.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, color: '#64748b', marginBottom: 5 }}>
                    Force : {newPwd.length < 6 ? '🔴 Faible' : newPwd.length < 10 ? '🟡 Moyen' : '🟢 Fort'}
                  </p>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[1,2,3,4].map(i => (
                      <div key={i} style={{
                        flex: 1, height: 4, borderRadius: 99,
                        background: newPwd.length >= i * 3
                          ? i <= 1 ? '#ef4444' : i === 2 ? '#f97316' : i === 3 ? '#eab308' : '#16a34a'
                          : '#e2e8f0',
                        transition: 'background .3s',
                      }} />
                    ))}
                  </div>
                </div>
              )}

              <button onClick={changePassword} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '10px 20px', background: '#1B5E46', color: 'white',
                fontWeight: 700, fontSize: 14, border: 'none', borderRadius: 10,
                cursor: 'pointer', marginTop: 4, fontFamily: 'inherit',
                boxShadow: '0 2px 8px rgba(27,94,70,.25)',
              }}>
                <Lock size={15} /> Modifier le mot de passe
              </button>
            </div>

            {/* Alerte sécurité */}
            <div style={{
              marginTop: 20, padding: '12px 16px',
              background: '#fffbeb', border: '1px solid #fde68a',
              borderRadius: 10, display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <AlertTriangle size={16} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
                Utilisez un mot de passe fort d'au moins 8 caractères avec des majuscules, chiffres et symboles.
              </p>
            </div>
          </Section>

          {/* Apparence & Langue */}
          <Section icon={Palette} title="Apparence & Langue" description="Personnalisez votre interface">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Thème */}
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Thème</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  {[
                    { key: 'light',  label: 'Clair',   icon: Sun     },
                    { key: 'dark',   label: 'Sombre',  icon: Moon    },
                    { key: 'system', label: 'Système', icon: Monitor },
                  ].map(({ key, label, icon: Icon }) => (
                    <button key={key} onClick={() => setTheme(key)} style={{
                      flex: 1, display: 'flex', flexDirection: 'column',
                      alignItems: 'center', gap: 6, padding: '12px 8px',
                      borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                      border: `2px solid ${theme === key ? '#1B5E46' : '#e2e8f0'}`,
                      background: theme === key ? '#f0fdf4' : 'white',
                      color: theme === key ? '#1B5E46' : '#64748b',
                      transition: 'all .2s',
                    }}>
                      <Icon size={18} />
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Langue */}
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Langue</label>
                <select style={selectStyle} value={language} onChange={e => setLanguage(e.target.value)} onFocus={onFocus} onBlur={onBlur}>
                  <option value="fr">🇫🇷 Français</option>
                  <option value="en">🇬🇧 English</option>
                  <option value="ar">🇹🇳 العربية</option>
                </select>
              </div>

              {/* Devise */}
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Devise par défaut</label>
                <select style={selectStyle} value={currency} onChange={e => setCurrency(e.target.value)} onFocus={onFocus} onBlur={onBlur}>
                  <option value="EUR">€ Euro (EUR)</option>
                  <option value="USD">$ Dollar US (USD)</option>
                  <option value="GBP">£ Livre Sterling (GBP)</option>
                  <option value="TND">د.ت Dinar Tunisien (TND)</option>
                </select>
              </div>

              <button onClick={saveAppearance} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 18px', background: '#f1f5f9', color: '#475569',
                fontWeight: 600, fontSize: 13, border: '1px solid #e2e8f0',
                borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <Check size={14} /> Appliquer
              </button>
            </div>
          </Section>

          {/* Configuration API */}
          <Section icon={Database} title="Configuration API" description="Paramètres de connexion backend">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>URL du backend</label>
                <input style={inputStyle} value={apiUrl} onChange={e => setApiUrl(e.target.value)} onFocus={onFocus} onBlur={onBlur} placeholder="http://localhost:8000" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Clé API</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    style={{ ...inputStyle, paddingRight: 44, fontFamily: 'monospace' }}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    onFocus={onFocus} onBlur={onBlur}
                  />
                  <button type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                    {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Status API */}
              <div style={{
                padding: '10px 14px', borderRadius: 10,
                background: '#f0fdf4', border: '1px solid #bbf7d0',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#166534', fontWeight: 600 }}>API connectée — {apiUrl}</span>
              </div>

              <button onClick={saveApi} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '10px 20px', background: '#1B5E46', color: 'white',
                fontWeight: 700, fontSize: 14, border: 'none', borderRadius: 10,
                cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: '0 2px 8px rgba(27,94,70,.25)',
              }}>
                <Save size={15} /> Sauvegarder la config
              </button>
            </div>
          </Section>

        </div>
      </div>

      {/* Zone danger */}
      <div style={{
        background: '#fff5f5', borderRadius: 16,
        border: '1px solid #fecaca', padding: '24px 28px',
        marginTop: 4,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <AlertTriangle size={20} color="#dc2626" />
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#991b1b' }}>Zone dangereuse</h3>
            <p style={{ fontSize: 12, color: '#b91c1c', marginTop: 1 }}>Ces actions sont irréversibles</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={() => { if (window.confirm('Se déconnecter ?')) logout(); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 18px', background: '#fef2f2', color: '#dc2626',
              fontWeight: 600, fontSize: 13, border: '1px solid #fecaca',
              borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
            }}>
            Se déconnecter
          </button>
          <button
            onClick={() => toast('Fonctionnalité à venir', { icon: 'ℹ️' })}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 18px', background: '#fef2f2', color: '#dc2626',
              fontWeight: 600, fontSize: 13, border: '1px solid #fecaca',
              borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
            }}>
            Supprimer mon compte
          </button>
        </div>
      </div>

    </Layout>
  );
}