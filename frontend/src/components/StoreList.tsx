// Grid layout of store cards with loading/empty/error states.

import { Store } from '../types/store';
import { StoreCard } from './StoreCard';
import './StoreList.css';

interface StoreListProps {
  stores: Store[];
  loading: boolean;
  error: string | null;
  onDelete: (id: string) => Promise<boolean>;
  deleting: string | null;
}

export function StoreList({ stores, loading, error, onDelete, deleting }: StoreListProps) {
  if (loading) {
    return (
      <div className="store-list-state">
        <div className="loading-spinner"></div>
        <p>Loading stores...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="store-list-state error">
        <span className="state-icon">⚠️</span>
        <h3>Failed to load stores</h3>
        <p>{error}</p>
      </div>
    );
  }

  if (stores.length === 0) {
    return (
      <div className="store-list-state empty">
        <span className="state-icon">🏪</span>
        <h3>No stores yet</h3>
        <p>Create your first store to get started!</p>
      </div>
    );
  }

  return (
    <div className="store-list">
      {stores.map((store) => (
        <StoreCard
          key={store.id}
          store={store}
          onDelete={onDelete}
          deleting={deleting === store.id}
        />
      ))}
    </div>
  );
}
