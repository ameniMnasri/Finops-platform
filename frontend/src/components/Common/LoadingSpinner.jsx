import React from 'react';

export default function LoadingSpinner({ message = 'Chargement...' }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '80px 32px', gap: 16,
    }}>
      <div className="spinner" />
      <p style={{ fontSize: 14, fontWeight: 500, color: '#64748b' }}>{message}</p>
    </div>
  );
}