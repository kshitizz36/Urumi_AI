// Individual store card showing status, URLs, and actions.

import { useState } from 'react';
import { Store } from '../types/store';
import { StatusBadge } from './StatusBadge';
import './StoreCard.css';

interface StoreCardProps {
  store: Store;
  onDelete: (id: string) => void;
  deleting: boolean;
}

export function StoreCard({ store, onDelete, deleting }: StoreCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  return (
    <div className={`store-card ${store.status === 'failed' ? 'store-card-failed' : ''}`}>
      <div className="store-card-header">
        <div className="store-info">
          <h3 className="store-name">{store.name}</h3>
          <span className="store-id">ID: {store.id}</span>
        </div>
        <StatusBadge status={store.status} phase={store.phase} />
      </div>

      <div className="store-card-body">
        <div className="store-meta">
          <div className="meta-item">
            <span className="meta-label">Engine</span>
            <span className="meta-value engine-badge">{store.engine}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Namespace</span>
            <span className="meta-value mono">{store.namespace}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Created</span>
            <span className="meta-value">{formatDate(store.createdAt)}</span>
          </div>
          {store.provisioningDurationMs && (
            <div className="meta-item">
              <span className="meta-label">Provisioning Time</span>
              <span className="meta-value">{formatDuration(store.provisioningDurationMs)}</span>
            </div>
          )}
        </div>

        {store.status === 'ready' && store.url && (
          <div className="store-urls">
            <a href={store.url} target="_blank" rel="noopener noreferrer" className="url-link">
              <span className="url-icon">🏪</span>
              Visit Store
            </a>
            <a href={store.adminUrl} target="_blank" rel="noopener noreferrer" className="url-link admin">
              <span className="url-icon">⚙️</span>
              WP Admin
            </a>
          </div>
        )}

        {store.status === 'failed' && store.errorMessage && (
          <div className="store-error">
            <span className="error-icon">⚠️</span>
            <div className="error-details">
              <strong>Failed at: {store.errorPhase || 'unknown'}</strong>
              <p>{store.errorMessage}</p>
            </div>
          </div>
        )}

        {/* Component status indicators */}
        <div className="component-status">
          <span className={`component ${store.mysqlReady ? 'ready' : ''}`}>
            {store.mysqlReady ? '✓' : '○'} MySQL
          </span>
          <span className={`component ${store.wordpressReady ? 'ready' : ''}`}>
            {store.wordpressReady ? '✓' : '○'} WordPress
          </span>
        </div>
      </div>

      <div className="store-card-actions">
        {confirmDelete ? (
          <div className="delete-confirm">
            <span className="confirm-text">Delete "{store.name}"?</span>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => { onDelete(store.id); setConfirmDelete(false); }}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Confirm'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="btn btn-danger"
            onClick={() => setConfirmDelete(true)}
            disabled={deleting || store.status === 'deleting'}
          >
            {deleting ? 'Deleting...' : 'Delete Store'}
          </button>
        )}
      </div>
    </div>
  );
}
