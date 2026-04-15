import React from 'react';
import { useLocation } from 'react-router-dom';
import { Bell, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const TITLES = {
  '/dashboard': { title: 'Dashboard',         sub: "Vue d'ensemble de vos coûts cloud" },
  '/files':     { title: 'Fichiers',           sub: 'Gérez vos fichiers de données'     },
  '/costs':     { title: 'Coûts',              sub: 'Gérez vos dépenses cloud'           },
  '/Devis':     { title: 'Devis',              sub: 'Gérez vos devis'                    },
  '/resources': { title: 'Ressources',         sub: 'Gérez vos ressources cloud'         },
  '/anomalies': { title: 'Anomalies',         sub: 'Surveillez les anomalies de coûts'  },
  '/settings':  { title: 'Paramètres',         sub: "Configuration de l'application"    },
};

export default function Header() {
  const { user } = useAuth();
  const location = useLocation();
  const info = TITLES[location.pathname] || { title: 'TeamWill FinOps', sub: '' };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <h2>{info.title}</h2>
        {info.sub && <p>{info.sub}</p>}
      </div>

      <div className="topbar-right">
        <button className="topbar-btn" title="Recherche">
          <Search size={17} />
        </button>
        <button className="topbar-btn" title="Notifications">
          <Bell size={17} />
        </button>
        <div className="topbar-divider" />
        <div className="topbar-user">
          <div className="topbar-user-text">
            <p>{user?.email?.split('@')[0]}</p>
            <span>Administrateur</span>
          </div>
          <div className="topbar-avatar">
            {user?.email?.charAt(0).toUpperCase()}
          </div>
        </div>
      </div>
    </header>
  );
}