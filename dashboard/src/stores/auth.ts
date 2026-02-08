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
    profileComplete?: boolean;
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
    const profileComplete = ref<boolean>(
        localStorage.getItem('mxf_profileComplete') === 'true'
    );

    // Getters
    const isAuthenticated = computed(() => !!token.value && !!user.value);
    // User needs onboarding when authenticated but profile is incomplete
    const needsOnboarding = computed(() => isAuthenticated.value && !profileComplete.value);

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
        loading.value = true;
        error.value = null;

        try {
            const response = await axios.post<AuthResponse>('/api/users/magic-link/verify', {
                token: magicToken
            });

            if (response.data.success) {
                setAuthData(response.data.user, response.data.token);

                // Track profile completion state from server response
                const isProfileComplete = response.data.profileComplete ?? false;
                profileComplete.value = isProfileComplete;
                localStorage.setItem('mxf_profileComplete', String(isProfileComplete));


            } else {
                throw new Error(response.data.message || 'Magic link verification failed');
            }
        } catch (err: any) {
            console.error('Auth: magic link verification failed', err.response?.status || err.message);
            error.value = err.response?.data?.message || err.message || 'Magic link verification failed';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const logout = (): void => {
        user.value = null;
        token.value = null;

        // Remove token and profile state from localStorage
        localStorage.removeItem('mxf_token');
        localStorage.removeItem('mxf_user');
        localStorage.removeItem('mxf_profileComplete');
        profileComplete.value = false;

        // Remove authorization header
        delete axios.defaults.headers.common['Authorization'];

    };

    const checkAuth = async (): Promise<void> => {
        // If we already have a valid authentication state, don't override it
        if (isAuthenticated.value) {
            return;
        }

        const storedToken = localStorage.getItem('mxf_token');
        const storedUser = localStorage.getItem('mxf_user');

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
            return;
        }

        try {
            const response = await axios.get<{ success: boolean; user: User }>('/api/users/profile');

            if (response.data.success) {
                user.value = response.data.user;
                // Update profile completion based on fetched profile data
                const isComplete = !!(response.data.user.firstName && response.data.user.lastName);
                profileComplete.value = isComplete;
                localStorage.setItem('mxf_profileComplete', String(isComplete));
            } else {
                // Token is invalid, logout
                logout();
            }
        } catch (err: any) {
            console.error('Auth: profile fetch failed', err.response?.status || err.message);
            // Token is invalid, logout
            logout();
        }
    };

    const clearError = (): void => {
        error.value = null;
    };

    const setAuthData = (userData: User, authToken: string): void => {
        user.value = userData;
        token.value = authToken;

        // Store in localStorage
        localStorage.setItem('mxf_token', authToken);
        localStorage.setItem('mxf_user', JSON.stringify(userData));

        // Set authorization header
        axios.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
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

                // Update profile completion state based on updated profile
                const isComplete = !!(response.data.user.firstName && response.data.user.lastName);
                profileComplete.value = isComplete;
                localStorage.setItem('mxf_profileComplete', String(isComplete));
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
        profileComplete,
        // Getters
        isAuthenticated,
        needsOnboarding,
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
