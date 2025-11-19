<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const authStore = useAuthStore();

// Form state
const email = ref('');
const loading = ref(false);
const linkSent = ref(false);
const valid = ref(false);
const error = ref('');

// Form rules
const emailRules = [
    (v: string) => !!v || 'Email is required',
    (v: string) => /.+@.+\..+/.test(v) || 'Email must be valid'
];

// State for demo magic link
const magicLink = ref('');
const showMagicLink = ref(false);

// Methods
const sendMagicLink = async (): Promise<void> => {
    if (!valid.value) return;
    
    loading.value = true;
    error.value = '';
    
    try {
        // Call backend API to request magic link
        const magicLinkToken = await authStore.requestMagicLink(email.value);
        
        // Create the full magic link URL
        magicLink.value = `${window.location.origin}/dashboard/auth/magic-link?token=${magicLinkToken}`;
        showMagicLink.value = true;
        linkSent.value = true;
    } catch (err: any) {
        error.value = err.message || 'Unable to generate magic link. Please try again.';
    } finally {
        loading.value = false;
    }
};

// Handle magic link click
const handleMagicLinkClick = async (): Promise<void> => {
    console.log('🔗 Magic link click started');
    loading.value = true;
    error.value = '';
    
    try {
        // Extract token from magic link URL
        const token = magicLink.value.split('token=')[1];
        console.log('🔗 Extracted token:', token ? 'present' : 'missing');
        
        if (!token) {
            throw new Error('No token found in magic link');
        }
        
        console.log('🔗 Calling verifyMagicLink...');
        // Verify magic link token with backend
        await authStore.verifyMagicLink(token);
        console.log('🔗 Magic link verified successfully');
        
        // Check authentication state
        console.log('🔗 Authentication state:', {
            isAuthenticated: authStore.isAuthenticated,
            hasToken: !!authStore.token,
            hasUser: !!authStore.user
        });
        
        // Navigate to dashboard
        console.log('🔗 Navigating to dashboard...');
        router.push('/dashboard');
    } catch (err: any) {
        console.error('🔗 Magic link error:', err);
        error.value = err.message || 'Invalid magic link. Please try again.';
    } finally {
        loading.value = false;
    }
};

// Copy magic link to clipboard
const copyMagicLink = async (): Promise<void> => {
    try {
        await (window as any).navigator.clipboard.writeText(magicLink.value);
    } catch (err) {
        // Fallback for older browsers
        console.log('Copy to clipboard not supported');
    }
};
</script>

<template>
    <v-container fluid class="fill-height login-container">
        <v-row justify="center" align="center" class="fill-height">
            <v-col cols="12" sm="8" md="6" lg="4" xl="3">
                <v-card class="login-card" elevation="0">
                    <v-card-title class="text-center pa-6">
                        <div class="logo-section">
                            <v-icon size="48" color="primary" class="mb-3">
                                mdi-account-network
                            </v-icon>
                            <h1 class="text-h4 mb-2">MXF Dashboard</h1>
                            <p class="text-body-2 text-medium-emphasis">
                                Model Exchange Framework
                            </p>
                        </div>
                    </v-card-title>

                    <v-card-text class="pa-6">
                        <div v-if="!linkSent">
                            <h2 class="text-h5 mb-4 text-center">Sign In</h2>
                            <p class="text-body-2 text-center mb-6 text-medium-emphasis">
                                Enter your email address and we'll send you a secure link to access your dashboard.
                                If this is your first time, we'll create your account automatically.
                            </p>

                            <v-form v-model="valid" @submit.prevent="sendMagicLink">
                                <v-text-field
                                    v-model="email"
                                    label="Email Address"
                                    type="email"
                                    variant="outlined"
                                    :rules="emailRules"
                                    prepend-inner-icon="mdi-email"
                                    class="mb-4"
                                    :loading="loading"
                                    :disabled="loading"
                                />

                                <v-alert
                                    v-if="error"
                                    type="error"
                                    variant="tonal"
                                    class="mb-4"
                                    :text="error"
                                    closable
                                    @click:close="error = ''"
                                />

                                <v-btn
                                    type="submit"
                                    color="primary"
                                    size="large"
                                    block
                                    :loading="loading"
                                    :disabled="!valid"
                                >
                                    {{ loading ? 'Sending...' : 'Send Magic Link' }}
                                </v-btn>
                            </v-form>
                        </div>

                        <!-- Success Message -->
                        <div v-else class="success-section">
                            <div class="text-center mb-4">
                                <v-icon size="64" color="success" class="mb-3">
                                    mdi-email-check
                                </v-icon>
                                <h2 class="text-h5 mb-2">Magic Link Generated!</h2>
                                <p class="text-body-2 text-medium-emphasis mb-4">
                                    Since we don't have SMTP configured, here's your magic link to click:
                                </p>
                            </div>

                            <v-alert
                                type="info"
                                variant="tonal"
                                class="mb-4"
                                title="Demo Mode - Click Your Magic Link"
                            >
                                <p class="mb-3">
                                    In production, this link would be sent to {{ email }}.
                                    For demo purposes, click the button below to log in:
                                </p>
                                
                                <v-btn
                                    color="success"
                                    variant="elevated"
                                    size="large"
                                    block
                                    class="mb-2"
                                    @click="handleMagicLinkClick"
                                >
                                    <v-icon start>mdi-login</v-icon>
                                    Access Dashboard (Magic Link)
                                </v-btn>
                                
                                <v-text-field
                                    v-model="magicLink"
                                    label="Magic Link URL (for reference)"
                                    variant="outlined"
                                    density="compact"
                                    readonly
                                    class="mt-3"
                                    append-icon="mdi-content-copy"
                                    @click:append="copyMagicLink"
                                />
                            </v-alert>

                            <v-btn
                                variant="outlined"
                                color="primary"
                                block
                                @click="linkSent = false; showMagicLink = false; email = ''"
                            >
                                Send Another Link
                            </v-btn>
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>
    </v-container>
</template>

<style scoped>
.login-container {
    background: linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%);
    min-height: 100vh;
}

.login-card {
    background: rgba(26, 26, 26, 0.95);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.logo-section {
    text-align: center;
}

.magic-link-section {
    text-align: center;
}
</style>
