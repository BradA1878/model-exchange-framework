import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from '../plugins/axios';

interface User {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    role: string;
}

interface AuthResponse {
    success: boolean;
    user: User;
    token: string;
    message?: string;
}

interface MagicLinkResponse {
    success: boolean;
    magicLink: string;
    message?: string;
}

export const useAuthStore = defineStore('auth', () => {
    // State
    const user = ref<User | null>(null);
    const token = ref<string | null>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);

    // Getters
    const isAuthenticated = computed(() => !!token.value && !!user.value);

    // Actions
    const login = async (email: string, password: string): Promise<void> => {
        loading.value = true;
        error.value = null;
        
        try {
            const response = await axios.post<AuthResponse>('/api/users/login', {
                username: email, // API expects username field
                password
            });

            if (response.data.success) {
                user.value = response.data.user;
                token.value = response.data.token;
                
                // Store token in localStorage
                localStorage.setItem('mxf_token', response.data.token);
                
                // Set default authorization header
                axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.token}`;
            } else {
                throw new Error(response.data.message || 'Login failed');
            }
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Login failed';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const register = async (userData: {
        email: string;
        firstName: string;
        lastName: string;
        company?: string;
    }): Promise<void> => {
        loading.value = true;
        error.value = null;
        
        try {
            const response = await axios.post<AuthResponse>('/api/users/register', {
                username: userData.email,
                email: userData.email,
                password: 'temp_password', // Will be replaced by magic link auth
                firstName: userData.firstName,
                lastName: userData.lastName,
                company: userData.company
            });

            if (response.data.success) {
                user.value = response.data.user;
                token.value = response.data.token;
                
                // Store token in localStorage
                localStorage.setItem('mxf_token', response.data.token);
                
                // Set default authorization header
                axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.token}`;
            } else {
                throw new Error(response.data.message || 'Registration failed');
            }
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Registration failed';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const requestMagicLink = async (email: string): Promise<string> => {
        loading.value = true;
        error.value = null;
        
        try {
            const response = await axios.post<MagicLinkResponse>('/api/users/magic-link', {
                email
            });

            if (response.data.success) {
                return response.data.magicLink;
            } else {
                throw new Error(response.data.message || 'Failed to generate magic link');
            }
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to generate magic link';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const verifyMagicLink = async (magicToken: string): Promise<void> => {
        console.log('🔐 Auth store verifyMagicLink started', { tokenPresent: !!magicToken });
        console.log('🔐 Axios configuration:', {
            baseURL: axios.defaults.baseURL,
            timeout: axios.defaults.timeout,
            headers: axios.defaults.headers.common
        });
        loading.value = true;
        error.value = null;
        
        try {
            // First, let's test if the server is reachable
            console.log('🔐 Testing server connectivity...');
            try {
                const healthResponse = await axios.get('/health');
                console.log('🔐 Server health check:', healthResponse.status);
            } catch (healthErr) {
                console.error('🔐 Server health check failed:', healthErr);
            }
            
            const apiUrl = '/api/users/magic-link/verify';
            const fullUrl = `${axios.defaults.baseURL}${apiUrl}`;
            console.log('🔐 Making API call to:', fullUrl);
            console.log('🔐 Request payload:', { token: magicToken?.substring(0, 20) + '...' });
            console.log('🔐 Current timestamp:', new Date().toISOString());
            
            const response = await axios.post<AuthResponse>(apiUrl, {
                token: magicToken
            });
            console.log('🔐 API response received:', { 
                success: response.data.success,
                status: response.status,
                statusText: response.statusText
            });

            if (response.data.success) {
                console.log('🔐 Setting user and token data');
                
                // Use setAuthData to properly store everything
                setAuthData(response.data.user, response.data.token);
                
                console.log('🔐 Token stored in localStorage');
                console.log('🔐 Authorization header set');
                
                console.log('🔐 Magic link verification complete:', {
                    hasUser: !!user.value,
                    hasToken: !!token.value,
                    isAuthenticated: !!token.value && !!user.value
                });
            } else {
                console.error('🔐 API returned success: false');
                throw new Error(response.data.message || 'Magic link verification failed');
            }
        } catch (err: any) {
            console.error('🔐 Magic link verification error:', err);
            console.error('🔐 Error details:', {
                message: err.message,
                status: err.response?.status,
                statusText: err.response?.statusText,
                data: err.response?.data,
                isNetworkError: !err.response,
                code: err.code
            });
            error.value = err.response?.data?.message || err.message || 'Magic link verification failed';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const logout = (): void => {
        console.log('🚪 logout called - clearing authentication state');
        console.log('🚪 logout: Current state before clearing:', {
            hasUser: !!user.value,
            hasToken: !!token.value,
            isAuthenticated: isAuthenticated.value
        });
        
        user.value = null;
        token.value = null;
        
        // Remove token from localStorage
        localStorage.removeItem('mxf_token');
        localStorage.removeItem('mxf_user');
        
        // Remove authorization header
        delete axios.defaults.headers.common['Authorization'];
        
        console.log('🚪 logout complete - authentication cleared');
    };

    const checkAuth = async (): Promise<void> => {
        console.log('🔍 checkAuth called - checking authentication state');
        console.log('🔍 Current auth state before checkAuth:', {
            hasToken: !!token.value,
            hasUser: !!user.value,
            isAuthenticated: isAuthenticated.value
        });
        
        // If we already have a valid authentication state, don't override it
        if (isAuthenticated.value) {
            console.log('🔍 Skipping checkAuth - already authenticated');
            return;
        }
        
        const storedToken = localStorage.getItem('mxf_token');
        const storedUser = localStorage.getItem('mxf_user');
        
        console.log('🔍 localStorage data:', {
            hasStoredToken: !!storedToken,
            hasStoredUser: !!storedUser
        });
        
        if (storedToken) {
            token.value = storedToken;
            axios.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
            
            // Restore user data from localStorage if available
            if (storedUser) {
                try {
                    user.value = JSON.parse(storedUser);
                } catch (err) {
                    // Invalid user data in localStorage, clear it
                    localStorage.removeItem('mxf_user');
                }
            }
            
            // Verify token is still valid by fetching user profile
            await fetchUserProfile();
        }
    };

    const fetchUserProfile = async (): Promise<void> => {
        if (!token.value) {
            console.log('👤 fetchUserProfile: No token present');
            return;
        }
        
        console.log('👤 fetchUserProfile: Fetching user profile to validate token');
        
        try {
            const response = await axios.get<{ success: boolean; user: User }>('/api/users/profile');
            
            console.log('👤 fetchUserProfile response:', {
                status: response.status,
                success: response.data.success,
                hasUser: !!response.data.user
            });
            
            if (response.data.success) {
                user.value = response.data.user;
                console.log('👤 fetchUserProfile: Profile updated successfully');
            } else {
                console.log('👤 fetchUserProfile: Server returned success: false - calling logout');
                // Token is invalid, logout
                logout();
            }
        } catch (err: any) {
            console.log('👤 fetchUserProfile error - calling logout:', {
                status: err.response?.status,
                statusText: err.response?.statusText,
                message: err.message,
                data: err.response?.data
            });
            // Token is invalid, logout
            logout();
        }
    };

    const clearError = (): void => {
        error.value = null;
    };

    const setAuthData = (userData: User, authToken: string): void => {
        console.log('💾 setAuthData called:', {
            hasUserData: !!userData,
            hasToken: !!authToken,
            tokenLength: authToken?.length
        });
        
        user.value = userData;
        token.value = authToken;
        
        // Store in localStorage
        console.log('💾 Storing token in localStorage...');
        localStorage.setItem('mxf_token', authToken);
        localStorage.setItem('mxf_user', JSON.stringify(userData));
        
        // Verify storage immediately
        const storedToken = localStorage.getItem('mxf_token');
        const storedUser = localStorage.getItem('mxf_user');
        console.log('💾 localStorage verification after storage:', {
            storedTokenExists: !!storedToken,
            storedUserExists: !!storedUser,
            tokensMatch: storedToken === authToken
        });
        
        // Set authorization header
        axios.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
        
        console.log('💾 setAuthData complete');
        
        // Monitor localStorage for token changes
        setTimeout(() => {
            const tokenAfter1s = localStorage.getItem('mxf_token');
            console.log('🔍 Token check after 1 second:', {
                tokenExists: !!tokenAfter1s,
                tokenStillMatches: tokenAfter1s === authToken
            });
        }, 1000);
        
        setTimeout(() => {
            const tokenAfter5s = localStorage.getItem('mxf_token');
            console.log('🔍 Token check after 5 seconds:', {
                tokenExists: !!tokenAfter5s,
                tokenStillMatches: tokenAfter5s === authToken
            });
        }, 5000);
    };

    const updateUserProfile = async (profileData: Partial<User>): Promise<void> => {
        if (!user.value) return;
        
        loading.value = true;
        error.value = null;
        
        try {
            const response = await axios.patch<{ success: boolean; user: User; message?: string }>('/api/users/profile', profileData);
            
            if (response.data.success) {
                // Update user object with server response
                user.value = response.data.user;
                
                // Update localStorage
                localStorage.setItem('mxf_user', JSON.stringify(response.data.user));
            } else {
                throw new Error(response.data.message || 'Profile update failed');
            }
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Profile update failed';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const updateUserProfileLocal = (profileData: Partial<User>): void => {
        if (user.value) {
            // Update user object with new profile data (local only)
            const updatedUser = { ...user.value, ...profileData };
            user.value = updatedUser;
            
            // Update localStorage
            localStorage.setItem('mxf_user', JSON.stringify(updatedUser));
        }
    };

    return {
        // State
        user,
        token,
        loading,
        error,
        // Getters
        isAuthenticated,
        // Actions
        login,
        register,
        requestMagicLink,
        verifyMagicLink,
        logout,
        checkAuth,
        fetchUserProfile,
        clearError,
        setAuthData,
        updateUserProfile,
        updateUserProfileLocal
    };
});
