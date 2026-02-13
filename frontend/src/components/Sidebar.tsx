import React from 'react';
import { 
  LayoutDashboard, 
  Store, 
  Settings, 
  CreditCard, 
  FileText, 
  LogOut,
  Zap
} from 'lucide-react';
import urumiLogo from '../assets/urumi-logo.png';

interface SidebarProps {
  currentView: string;
  onChangeView: (view: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onChangeView }) => {
  const menuItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'stores', icon: Store, label: 'My Stores' },
    { id: 'billing', icon: CreditCard, label: 'Billing' },
    { id: 'invoices', icon: FileText, label: 'Invoices' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="sidebar">
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="brand-logo">
          <img src={urumiLogo} alt="Urumi" className="brand-icon-img" />
        </div>
        <div className="brand-info">
          <h1>Urumi</h1>
          <span>Platform</span>
        </div>
      </div>

      {/* Menu */}
      <nav className="sidebar-menu">
        <div className="menu-group">
          <span className="menu-label">Menu</span>
          {menuItems.map((item) => (
            <button
              key={item.id}
              className={`menu-item ${currentView === item.id ? 'active' : ''}`}
              onClick={() => onChangeView(item.id)}
            >
              <item.icon className="menu-icon" size={20} />
              <span>{item.label}</span>
              {item.id === 'stores' && <span className="menu-badge">PRO</span>}
            </button>
          ))}
        </div>
      </nav>

      {/* Bottom Actions */}
      <div className="sidebar-footer">
        <div className="pro-card">
          <div className="pro-icon">
            <Zap size={16} />
          </div>
          <div className="pro-info">
            <h4>Upgrade to PRO</h4>
            <p>Unlock all features</p>
          </div>
          <button className="btn-upgrade">Upgrade</button>
        </div>

        <button className="menu-item logout">
          <LogOut className="menu-icon" size={20} />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );
};
