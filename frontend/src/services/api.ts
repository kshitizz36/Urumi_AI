// API client for backend communication.

import { Store, CreateStoreRequest, ApiResponse, StoreListResponse } from '../types/store';

const API_BASE = '/api';

/**
 * Generic fetch wrapper with error handling
 */
async function fetchApi<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<ApiResponse<T>> {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
            ...options,
        });

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('API request failed:', error);
        return {
            success: false,
            error: {
                code: 'NETWORK_ERROR',
                message: error instanceof Error ? error.message : 'Network request failed',
            },
        };
    }
}

/**
 * API client for store operations
 */
export const api = {
    /**
     * List all stores
     */
    async listStores(): Promise<ApiResponse<StoreListResponse>> {
        return fetchApi<StoreListResponse>('/stores');
    },

    /**
     * Get store by ID
     */
    async getStore(id: string): Promise<ApiResponse<{ store: Store }>> {
        return fetchApi<{ store: Store }>(`/stores/${id}`);
    },

    /**
     * Create a new store
     */
    async createStore(request: CreateStoreRequest): Promise<ApiResponse<{ store: Store }>> {
        return fetchApi<{ store: Store }>('/stores', {
            method: 'POST',
            body: JSON.stringify(request),
        });
    },

    /**
     * Delete a store
     */
    async deleteStore(id: string): Promise<ApiResponse<{ message: string }>> {
        return fetchApi<{ message: string }>(`/stores/${id}`, {
            method: 'DELETE',
        });
    },

    /**
     * Check API health
     */
    async checkHealth(): Promise<{ healthy: boolean; message?: string }> {
        try {
            const response = await fetch('/health/ready');
            const data = await response.json();
            return { healthy: response.ok, message: data.status };
        } catch {
            return { healthy: false, message: 'API unreachable' };
        }
    },
};
