import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './components/Auth/Login';
import Register from './components/Auth/Register';
import Dashboard from './components/Dashboard/Dashboard';
import Files from './components/Files/Files';
import Costs from './components/Costs/Costs';
import Devis from './components/Costs/Devis';
import Resources from "./components/Resources/ResourceDashboard";
import Settings from './pages/Settings';
import LoadingSpinner from './components/Common/LoadingSpinner';

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <LoadingSpinner message="Chargement..." />
      </div>
    );
  }
  return isAuthenticated ? children : <Navigate to="/login" />;
}

function AppRoutes() {
  const { isAuthenticated } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/files" element={<ProtectedRoute><Files /></ProtectedRoute>} />
      <Route path="/costs" element={<ProtectedRoute><Costs /></ProtectedRoute>} />
      <Route path="/Devis" element={<ProtectedRoute><Devis /></ProtectedRoute>} />
      <Route path="/resources" element={<ProtectedRoute><Resources /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/" element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: 'rgba(27, 94, 70, 0.95)',
              color: '#FFFFFF',
              border: '1px solid rgba(76, 175, 80, 0.3)',
              borderRadius: '8px',
            },
          }}
        />
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}
