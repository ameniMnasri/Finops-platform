import React from 'react';
import Sidebar from './Sidebar';
import Header from './Header';

export default function Layout({ children }) {
  return (
    <div className="page-wrapper">
      <Sidebar />
      <div className="page-content">
        <Header />
        <main className="page-main">
          <div className="page-inner animate-fadeIn">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}