import { useState } from 'react';
import { StoreList } from './components/StoreList';
import { CreateStoreModal } from './components/CreateStoreModal';
import { useStores } from './hooks/useStores';
import { DashboardStats } from './components/DashboardStats';
import { CreateStoreRequest } from './types/store';
import { Plus } from 'lucide-react';
import urumiLogo from './assets/urumi-logo.png';
import Squares from './components/Squares';
import './App.css';

function App() {
  const { stores, loading, error, createStore, deleteStore, refresh, deleting, creating } = useStores();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleCreateStore = async (data: CreateStoreRequest): Promise<boolean> => {
    const success = await createStore(data);
    if (success) {
      setIsModalOpen(false);
    }
    return success;
  };

  // Calculate stats
  const totalStores = stores.length;
  const activeStores = stores.filter(s => s.status === 'ready').length;
  const failedStores = stores.filter(s => s.status === 'failed').length;

  return (
    <div className="app-container">
      {/* Background Animation - NO HOVER, direction UP */}
      <div className="squares-bg">
        <Squares 
          direction="up"
          speed={0.3}
          squareSize={50}
          borderColor="#1a1a2e" 
          hoverFillColor="transparent"
        />
      </div>

      {/* Full Width Content */}
      <main className="main-content full-width">
        {/* Header */}
        <header className="top-header">
          <div className="brand-header">
            <div className="brand-logo">
              <img src={urumiLogo} alt="Urumi" className="brand-icon-img" />
            </div>
            <h1>Urumi</h1>
          </div>
          <button className="btn-create" onClick={() => setIsModalOpen(true)}>
            <Plus size={20} />
            <span>New Store</span>
          </button>
        </header>

        {/* Content */}
        <div className="content-wrapper">
          {/* Dashboard Header */}
          <div className="dashboard-header">
            <div>
              <h2>Store Provisioning</h2>
              <p className="subtitle">Kubernetes-native WooCommerce deployment</p>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="global-error">
              <span>⚠️ API Error: {error}</span>
              <button onClick={() => refresh()} className="btn-retry">Retry</button>
            </div>
          )}

          {/* Stats Cards */}
          <DashboardStats 
            totalStores={totalStores}
            activeStores={activeStores}
            failedStores={failedStores}
          />

          {/* Store List Section */}
          <div className="section-header">
            <h3>Stores</h3>
            <button className="btn-link" onClick={() => refresh()}>Refresh</button>
          </div>

          <StoreList 
            stores={stores} 
            loading={loading} 
            error={error}
            onDelete={deleteStore}
            deleting={deleting}
          />
        </div>
      </main>

      {/* Create Store Modal */}
      <CreateStoreModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateStore}
        creating={creating}
      />
    </div>
  );
}

export default App;
