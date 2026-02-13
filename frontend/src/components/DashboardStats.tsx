import React from 'react';
import { Store, Activity, AlertCircle } from 'lucide-react';

interface DashboardStatsProps {
  totalStores: number;
  activeStores: number;
  failedStores: number;
}

export const DashboardStats: React.FC<DashboardStatsProps> = ({ 
  totalStores, 
  activeStores, 
  failedStores 
}) => {
  return (
    <div className="stats-grid">
      <div className="stat-card primary">
        <div className="stat-header">
          <div className="stat-icon-wrapper">
            <Store size={24} />
          </div>
        </div>
        <div className="stat-content">
          <h3>Total Stores</h3>
          <div className="stat-value">{totalStores}</div>
          <p className="stat-label">All time created</p>
        </div>
      </div>

      <div className="stat-card success">
        <div className="stat-header">
          <div className="stat-icon-wrapper">
            <Activity size={24} />
          </div>
        </div>
        <div className="stat-content">
          <h3>Active Now</h3>
          <div className="stat-value">{activeStores}</div>
          <p className="stat-label">Fully operational</p>
        </div>
      </div>

      <div className="stat-card danger">
        <div className="stat-header">
          <div className="stat-icon-wrapper">
            <AlertCircle size={24} />
          </div>
        </div>
        <div className="stat-content">
          <h3>Issues</h3>
          <div className="stat-value">{failedStores}</div>
          <p className="stat-label">Needs attention</p>
        </div>
      </div>
    </div>
  );
};
