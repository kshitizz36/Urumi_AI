// Modal for creating new stores with form validation.

import { useState } from 'react';
import { CreateStoreRequest, StoreEngine } from '../types/store';
import { Store, Database, Globe, Server, ShoppingCart, Sparkles, X, Rocket, Clock, ChevronRight } from 'lucide-react';
import './CreateStoreModal.css';

interface CreateStoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (request: CreateStoreRequest) => Promise<boolean>;
  creating: boolean;
}

const provisioningSteps = [
  { icon: Server, label: 'Kubernetes Namespace', description: 'Isolated environment' },
  { icon: Database, label: 'MySQL Database', description: 'Persistent storage' },
  { icon: ShoppingCart, label: 'WooCommerce', description: 'E-commerce platform' },
  { icon: Globe, label: 'Public Ingress', description: 'External access' },
];

export function CreateStoreModal({ isOpen, onClose, onSubmit, creating }: CreateStoreModalProps) {
  const [name, setName] = useState('');
  const [engine, setEngine] = useState<StoreEngine>('woocommerce');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate name
    if (!name.trim()) {
      setError('Store name is required');
      return;
    }

    if (!/^[a-z0-9-]+$/.test(name)) {
      setError('Only lowercase letters, numbers, and hyphens allowed');
      return;
    }

    if (name.length < 3) {
      setError('Store name must be at least 3 characters');
      return;
    }

    const success = await onSubmit({ name, engine });
    if (success) {
      setName('');
      setEngine('woocommerce');
      onClose();
    }
  };

  const handleClose = () => {
    if (!creating) {
      setName('');
      setError('');
      onClose();
    }
  };

  const storeUrl = name ? `${name}.urumi.localhost` : 'your-store.urumi.localhost';

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Decorative Elements */}
        <div className="modal-glow modal-glow-1" />
        <div className="modal-glow modal-glow-2" />
        
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon">
              <Sparkles size={24} />
            </div>
            <div>
              <h2>Create New Store</h2>
              <p className="modal-subtitle">Deploy a fully-managed WooCommerce store</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={handleClose} disabled={creating}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Store Name Input */}
          <div className="form-section">
            <label className="form-label">
              <Store size={16} />
              Store Name
            </label>
            <div className="input-wrapper">
              <input
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="my-awesome-store"
                disabled={creating}
                autoFocus
              />
              {name && <span className="input-valid-icon">✓</span>}
            </div>
            <div className="url-preview">
              <Globe size={14} />
              <span>{storeUrl}</span>
            </div>
          </div>

          {/* Engine Selection */}
          <div className="form-section">
            <label className="form-label">
              <ShoppingCart size={16} />
              Store Engine
            </label>
            <div className="engine-options">
              <label className={`engine-option ${engine === 'woocommerce' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="engine"
                  value="woocommerce"
                  checked={engine === 'woocommerce'}
                  onChange={(e) => setEngine(e.target.value as StoreEngine)}
                  disabled={creating}
                />
                <div className="engine-icon woo">
                  <ShoppingCart size={20} />
                </div>
                <div className="engine-info">
                  <span className="engine-name">WooCommerce</span>
                  <span className="engine-desc">WordPress + WooCommerce</span>
                </div>
                {engine === 'woocommerce' && <span className="engine-check">✓</span>}
              </label>
              <label className="engine-option disabled">
                <input type="radio" name="engine" disabled />
                <div className="engine-icon medusa">
                  <Rocket size={20} />
                </div>
                <div className="engine-info">
                  <span className="engine-name">MedusaJS</span>
                  <span className="engine-desc">Coming Soon</span>
                </div>
                <span className="engine-badge">Soon</span>
              </label>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="form-error">
              <span className="error-icon">!</span>
              {error}
            </div>
          )}

          {/* Provisioning Preview */}
          <div className="provisioning-preview">
            <div className="preview-header">
              <span className="preview-title">What will be provisioned</span>
              <div className="time-badge">
                <Clock size={12} />
                <span>~2-3 min</span>
              </div>
            </div>
            <div className="provisioning-steps">
              {provisioningSteps.map((step, index) => (
                <div key={index} className="provision-step">
                  <div className="step-icon-wrapper">
                    <step.icon size={16} />
                  </div>
                  <div className="step-content">
                    <span className="step-label">{step.label}</span>
                    <span className="step-desc">{step.description}</span>
                  </div>
                  {index < provisioningSteps.length - 1 && (
                    <ChevronRight size={14} className="step-arrow" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="modal-actions">
            <button 
              type="button" 
              className="btn-cancel" 
              onClick={handleClose} 
              disabled={creating}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="btn-create-store" 
              disabled={creating || !name.trim()}
            >
              {creating ? (
                <>
                  <span className="btn-spinner" />
                  <span>Deploying...</span>
                </>
              ) : (
                <>
                  <Rocket size={18} />
                  <span>Deploy Store</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
