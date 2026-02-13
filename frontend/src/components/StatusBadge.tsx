// Color-coded status badge for store provisioning states.

import { StoreStatus, ProvisioningPhase } from '../types/store';
import './StatusBadge.css';

interface StatusBadgeProps {
  status: StoreStatus;
  phase?: ProvisioningPhase;
}

const statusConfig: Record<StoreStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'badge-pending' },
  provisioning: { label: 'Provisioning', className: 'badge-provisioning' },
  ready: { label: 'Ready', className: 'badge-ready' },
  failed: { label: 'Failed', className: 'badge-failed' },
  deleting: { label: 'Deleting', className: 'badge-deleting' },
  deleted: { label: 'Deleted', className: 'badge-deleted' },
};

const phaseLabels: Record<ProvisioningPhase, string> = {
  namespace: 'Creating namespace...',
  database: 'Setting up database...',
  application: 'Deploying WordPress...',
  validation: 'Validating...',
};

export function StatusBadge({ status, phase }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.pending;
  
  return (
    <div className="status-badge-container">
      <span className={`status-badge ${config.className}`}>
        {status === 'provisioning' && <span className="spinner" />}
        {config.label}
      </span>
      {status === 'provisioning' && phase && (
        <span className="phase-label">{phaseLabels[phase]}</span>
      )}
    </div>
  );
}
