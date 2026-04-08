import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, DollarSign, FileText,
  Settings, LogOut, ChevronDown, ChevronUp,
  BarChart2, Server,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function Sidebar() {
  const { logout, user } = useAuth();
  const location = useLocation();
  const [dashOpen, setDashOpen] = useState(true);

  const isActive = (path) => location.pathname === path;

  const NavLink = ({ to, icon: Icon, label }) => (
    <Link
      to={to}
      className={`nav-item ${isActive(to) ? 'active' : ''}`}
    >
      <Icon size={18} />
      {label}
    </Link>
  );

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'linear-gradient(135deg, #4CAF50, #2A8659)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 16, color: 'white', flexShrink: 0,
          }}>T</div>
          <div>
            <h1>TeamWill</h1>
            <span>FinOps Platform</span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        <div className="nav-section-label">Navigation</div>

        <NavLink to="/dashboard" icon={LayoutDashboard} label="Dashboard" />

        {/* Section avec dropdown */}
        <div>
          <button
            className={`nav-item ${isActive('/files') || isActive('/costs') || isActive('/resources') ? 'active' : ''}`}
            onClick={() => setDashOpen(!dashOpen)}
            style={{ justifyContent: 'space-between' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <BarChart2 size={18} />
              Analyse
            </span>
            {dashOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {dashOpen && (
            <div style={{ marginLeft: 16, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <NavLink to="/files"     icon={FileText}    label="Fichiers"   />
              <NavLink to="/costs"     icon={DollarSign}  label="Coûts"      />
              <NavLink to="/resources" icon={Server}      label="Ressources" />
            </div>
          )}
        </div>

        <div className="nav-section-label" style={{ marginTop: 8 }}>Système</div>
        <NavLink to="/settings" icon={Settings} label="Paramètres" />
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">
            {user?.email?.charAt(0).toUpperCase()}
          </div>
          <div className="sidebar-user-info" style={{ minWidth: 0 }}>
            <p>{user?.email}</p>
            <span>Administrateur</span>
          </div>
        </div>
        <button className="nav-item" onClick={logout}
          style={{ color: '#fca5a5', width: '100%' }}>
          <LogOut size={18} />
          Déconnexion
        </button>
      </div>
    </aside>
  );
}