// Store state hook with auto-polling for status updates.

import { useState, useEffect, useCallback, useRef } from 'react';
import { Store, CreateStoreRequest } from '../types/store';
import { api } from '../services/api';

interface UseStoresResult {
    stores: Store[];
    loading: boolean;
    error: string | null;
    createStore: (request: CreateStoreRequest) => Promise<boolean>;
    deleteStore: (id: string) => Promise<boolean>;
    refresh: () => Promise<void>;
    creating: boolean;
    deleting: string | null;
}

const POLL_INTERVAL = 5000; // 5 seconds

export function useStores(): UseStoresResult {
    const [stores, setStores] = useState<Store[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

    // Fetch all stores
    const fetchStores = useCallback(async () => {
        try {
            const response = await api.listStores();
            if (response.success && response.data) {
                setStores(response.data.stores);
                setError(null);
            } else {
                setError(response.error?.message || 'Failed to fetch stores');
            }
        } catch (err) {
            setError('Failed to fetch stores');
        } finally {
            setLoading(false);
        }
    }, []);

    // Keep a ref to stores so the interval callback always reads latest without
    // being in the useEffect dependency array (avoids interval reset on every fetch).
    const storesRef = useRef(stores);
    useEffect(() => { storesRef.current = stores; }, [stores]);

    // Initial fetch and polling
    useEffect(() => {
        fetchStores();

        // Poll for updates (especially for provisioning status)
        const interval = setInterval(() => {
            // Only poll if there are stores in progress
            const hasActiveStores = storesRef.current.some(
                s => s.status === 'pending' || s.status === 'provisioning' || s.status === 'deleting'
            );
            if (hasActiveStores) {
                fetchStores();
            }
        }, POLL_INTERVAL);

        return () => clearInterval(interval);
    }, [fetchStores]);

    // Create a new store
    const createStore = useCallback(async (request: CreateStoreRequest): Promise<boolean> => {
        setCreating(true);
        setError(null);

        try {
            const response = await api.createStore(request);
            if (response.success) {
                await fetchStores();
                return true;
            } else {
                setError(response.error?.message || 'Failed to create store');
                return false;
            }
        } catch (err) {
            setError('Failed to create store');
            return false;
        } finally {
            setCreating(false);
        }
    }, [fetchStores]);

    // Delete a store
    const deleteStore = useCallback(async (id: string): Promise<boolean> => {
        setDeleting(id);
        setError(null);

        try {
            const response = await api.deleteStore(id);
            if (response.success) {
                await fetchStores();
                return true;
            } else {
                setError(response.error?.message || 'Failed to delete store');
                return false;
            }
        } catch (err) {
            setError('Failed to delete store');
            return false;
        } finally {
            setDeleting(null);
        }
    }, [fetchStores]);

    return {
        stores,
        loading,
        error,
        createStore,
        deleteStore,
        refresh: fetchStores,
        creating,
        deleting,
    };
}
