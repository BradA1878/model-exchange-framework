/**
 * Personal Access Tokens Pinia Store
 *
 * Manages state and API interactions for Personal Access Tokens (PAT).
 * PATs allow users to authenticate SDK connections without username/password.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from '../plugins/axios';

/**
 * Token information returned from API (without secret)
 */
export interface PersonalAccessToken {
    tokenId: string;
    name: string;
    description?: string;
    createdAt: string;
    expiresAt?: string;
    lastUsed?: string;
    usageCount: number;
    dailyUsageCount?: number;
    monthlyUsageCount?: number;
    maxRequestsPerDay?: number;
    maxRequestsPerMonth?: number;
    isActive: boolean;
    revokedAt?: string;
}

/**
 * Response when creating a new token (includes secret)
 */
export interface CreateTokenResponse {
    tokenId: string;
    secret: string;
    name: string;
    expiresAt?: string;
    createdAt: string;
}

/**
 * Options for creating a new token
 */
export interface CreateTokenOptions {
    name: string;
    description?: string;
    expiresAt?: string;
    maxRequestsPerDay?: number;
    maxRequestsPerMonth?: number;
}

export const useTokensStore = defineStore('tokens', () => {
    // State
    const tokens = ref<PersonalAccessToken[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const lastCreatedToken = ref<CreateTokenResponse | null>(null);

    // Getters
    const activeTokens = computed(() => tokens.value.filter(t => t.isActive));
    const revokedTokens = computed(() => tokens.value.filter(t => !t.isActive));
    const tokenCount = computed(() => tokens.value.length);
    const activeTokenCount = computed(() => activeTokens.value.length);

    /**
     * Fetch all tokens for the current user
     */
    const fetchTokens = async (): Promise<void> => {
        loading.value = true;
        error.value = null;

        try {
            const response = await axios.get('/api/tokens');

            if (response.data.success) {
                tokens.value = response.data.data || [];
            } else {
                throw new Error(response.data.error || 'Failed to fetch tokens');
            }
        } catch (err: any) {
            error.value = err.response?.data?.error || err.message || 'Failed to fetch tokens';
            console.error('Error fetching tokens:', error.value);
        } finally {
            loading.value = false;
        }
    };

    /**
     * Create a new Personal Access Token
     */
    const createToken = async (options: CreateTokenOptions): Promise<CreateTokenResponse | null> => {
        loading.value = true;
        error.value = null;
        lastCreatedToken.value = null;

        try {
            const response = await axios.post('/api/tokens', options);

            if (response.data.success) {
                const tokenData: CreateTokenResponse = response.data.data;
                lastCreatedToken.value = tokenData;

                // Refresh token list to include the new token
                await fetchTokens();

                return tokenData;
            } else {
                throw new Error(response.data.error || 'Failed to create token');
            }
        } catch (err: any) {
            error.value = err.response?.data?.error || err.message || 'Failed to create token';
            console.error('Error creating token:', error.value);
            return null;
        } finally {
            loading.value = false;
        }
    };

    /**
     * Revoke a Personal Access Token
     */
    const revokeToken = async (tokenId: string, reason?: string): Promise<boolean> => {
        loading.value = true;
        error.value = null;

        try {
            // Send reason in the request body, not as query parameter
            // axios.delete accepts config object as second parameter with data property
            const response = await axios.delete(`/api/tokens/${tokenId}`, {
                data: reason ? { reason } : undefined
            });

            if (response.data.success) {
                // Update local state
                const tokenIndex = tokens.value.findIndex(t => t.tokenId === tokenId);
                if (tokenIndex !== -1) {
                    tokens.value[tokenIndex].isActive = false;
                    tokens.value[tokenIndex].revokedAt = new Date().toISOString();
                }
                return true;
            } else {
                throw new Error(response.data.error || 'Failed to revoke token');
            }
        } catch (err: any) {
            error.value = err.response?.data?.error || err.message || 'Failed to revoke token';
            console.error('Error revoking token:', error.value);
            return false;
        } finally {
            loading.value = false;
        }
    };

    /**
     * Get detailed stats for a specific token
     */
    const getTokenStats = async (tokenId: string): Promise<PersonalAccessToken | null> => {
        try {
            const response = await axios.get(`/api/tokens/${tokenId}`);

            if (response.data.success) {
                return response.data.data;
            }
            return null;
        } catch (err: any) {
            console.error('Error fetching token stats:', err);
            return null;
        }
    };

    /**
     * Clear the last created token (after user has copied it)
     */
    const clearLastCreatedToken = (): void => {
        lastCreatedToken.value = null;
    };

    /**
     * Clear any error state
     */
    const clearError = (): void => {
        error.value = null;
    };

    return {
        // State
        tokens,
        loading,
        error,
        lastCreatedToken,

        // Getters
        activeTokens,
        revokedTokens,
        tokenCount,
        activeTokenCount,

        // Actions
        fetchTokens,
        createToken,
        revokeToken,
        getTokenStats,
        clearLastCreatedToken,
        clearError,
    };
});
