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

        // Create the full magic link URL (route is /auth/magic-link, no /dashboard prefix)
        magicLink.value = `${window.location.origin}/auth/magic-link?token=${magicLinkToken}`;
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
    loading.value = true;
    error.value = '';

    try {
        // Extract token from magic link URL
        const token = magicLink.value.split('token=')[1];

        if (!token) {
            throw new Error('No token found in magic link');
        }

        // Verify magic link token with backend
        await authStore.verifyMagicLink(token);

        // Navigate to onboarding if profile is incomplete, otherwise dashboard
        if (authStore.needsOnboarding) {
            router.push('/onboarding');
        } else {
            router.push('/dashboard');
        }
    } catch (err: any) {
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
        // Fallback: clipboard API not available in this browser context
    }
};

// Reset form
const resetForm = (): void => {
    linkSent.value = false;
    showMagicLink.value = false;
    email.value = '';
    error.value = '';
};
</script>

<template>
    <div class="login-page">
        <!-- Neural background pattern -->
        <div class="neural-background">
            <div class="gradient-orb gradient-orb--1"></div>
            <div class="gradient-orb gradient-orb--2"></div>
            <div class="gradient-orb gradient-orb--3"></div>
            <div class="neural-grid"></div>
        </div>

        <!-- Login Card -->
        <div class="login-container">
            <div class="login-card">
                <!-- Logo Section -->
                <div class="logo-section">
                    <div class="logo-icon">
                        <img src="/logo.png" alt="MXF" width="64" height="64" />
                    </div>
                    <h1 class="logo-title">MXF</h1>
                    <p class="logo-subtitle">Workbench</p>
                </div>

                <!-- Form Section -->
                <div class="form-section">
                    <transition name="slide-fade" mode="out-in">
                        <!-- Initial Form -->
                        <div v-if="!linkSent" key="form">
                            <h2 class="form-title">Welcome back</h2>
                            <p class="form-description">
                                Enter your email to sign in. We'll send you a secure magic link.
                            </p>

                            <v-form v-model="valid" @submit.prevent="sendMagicLink" class="login-form">
                                <div class="input-group">
                                    <v-text-field
                                        v-model="email"
                                        label="Email Address"
                                        type="email"
                                        variant="outlined"
                                        :rules="emailRules"
                                        prepend-inner-icon="mdi-email-outline"
                                        :loading="loading"
                                        :disabled="loading"
                                        hide-details="auto"
                                        class="neural-input"
                                    />
                                </div>

                                <transition name="fade">
                                    <v-alert
                                        v-if="error"
                                        type="error"
                                        variant="tonal"
                                        class="error-alert"
                                        closable
                                        @click:close="error = ''"
                                    >
                                        {{ error }}
                                    </v-alert>
                                </transition>

                                <v-btn
                                    type="submit"
                                    color="primary"
                                    size="large"
                                    block
                                    :loading="loading"
                                    :disabled="!valid"
                                    class="submit-btn"
                                >
                                    <v-icon start>mdi-send</v-icon>
                                    Send Magic Link
                                </v-btn>
                            </v-form>
                        </div>

                        <!-- Success State -->
                        <div v-else key="success" class="success-section">
                            <div class="success-icon">
                                <v-icon size="48" color="success">mdi-email-check</v-icon>
                            </div>
                            <h2 class="form-title">Check your email</h2>
                            <p class="form-description">
                                We've generated a magic link for <strong>{{ email }}</strong>
                            </p>

                            <v-card class="magic-link-card">
                                <v-card-text>
                                    <p class="demo-notice">
                                        <v-icon size="16" color="info" class="mr-1">mdi-information</v-icon>
                                        Dev Mode: In production, this link would be emailed to the user. Click below to sign in directly.
                                    </p>

                                    <v-btn
                                        color="success"
                                        size="large"
                                        block
                                        :loading="loading"
                                        class="access-btn"
                                        @click="handleMagicLinkClick"
                                    >
                                        <v-icon start>mdi-login</v-icon>
                                        Access Dashboard
                                    </v-btn>

                                    <div class="link-preview">
                                        <v-text-field
                                            :model-value="magicLink"
                                            label="Magic Link URL"
                                            variant="outlined"
                                            density="compact"
                                            readonly
                                            hide-details
                                            append-inner-icon="mdi-content-copy"
                                            @click:append-inner="copyMagicLink"
                                        />
                                    </div>
                                </v-card-text>
                            </v-card>

                            <v-btn
                                variant="text"
                                color="primary"
                                block
                                class="mt-4"
                                @click="resetForm"
                            >
                                <v-icon start>mdi-arrow-left</v-icon>
                                Use different email
                            </v-btn>
                        </div>
                    </transition>
                </div>

                <!-- Footer -->
                <div class="card-footer">
                    <p class="footer-text">
                        Model Exchange Framework &copy; {{ new Date().getFullYear() }}
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.login-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
    background: var(--bg-void);
}

/* Neural Background */
.neural-background {
    position: absolute;
    inset: 0;
    overflow: hidden;
}

.gradient-orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(80px);
    opacity: 0.5;
}

.gradient-orb--1 {
    width: 600px;
    height: 600px;
    background: linear-gradient(135deg, var(--primary-700) 0%, var(--primary-500) 100%);
    top: -200px;
    left: -100px;
    animation: float1 20s ease-in-out infinite;
}

.gradient-orb--2 {
    width: 400px;
    height: 400px;
    background: linear-gradient(135deg, var(--accent-500) 0%, var(--primary-400) 100%);
    bottom: -100px;
    right: -50px;
    animation: float2 15s ease-in-out infinite;
}

.gradient-orb--3 {
    width: 300px;
    height: 300px;
    background: linear-gradient(135deg, var(--primary-600) 0%, var(--secondary-500) 100%);
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    animation: float3 25s ease-in-out infinite;
}

@keyframes float1 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    50% { transform: translate(50px, 30px) scale(1.1); }
}

@keyframes float2 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    50% { transform: translate(-30px, -50px) scale(1.05); }
}

@keyframes float3 {
    0%, 100% { transform: translate(-50%, -50%) scale(1); }
    50% { transform: translate(-50%, -50%) scale(1.15); }
}

.neural-grid {
    position: absolute;
    inset: 0;
    background-image:
        linear-gradient(var(--border-subtle) 1px, transparent 1px),
        linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px);
    background-size: 50px 50px;
    opacity: 0.3;
}

/* Login Container */
.login-container {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 440px;
    padding: var(--space-4);
}

/* Login Card - Glassmorphism */
.login-card {
    background: rgba(18, 25, 32, 0.8);
    backdrop-filter: blur(20px);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xl);
    padding: var(--space-8);
    box-shadow:
        0 25px 50px -12px rgba(0, 0, 0, 0.5),
        0 0 0 1px rgba(255, 255, 255, 0.05) inset;
}

/* Logo Section */
.logo-section {
    text-align: center;
    margin-bottom: var(--space-8);
}

.logo-icon {
    display: inline-flex;
    margin-bottom: var(--space-3);
}

.logo-title {
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: -0.02em;
}

.logo-subtitle {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: var(--space-1) 0 0;
}

/* Form Section */
.form-section {
    margin-bottom: var(--space-6);
}

.form-title {
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 var(--space-2);
    text-align: center;
}

.form-description {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    text-align: center;
    margin: 0 0 var(--space-6);
    line-height: 1.5;
}

.login-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.input-group {
    margin-bottom: var(--space-2);
}

.neural-input :deep(.v-field) {
    background: var(--bg-deep);
    border-radius: var(--radius-md);
}

.neural-input :deep(.v-field__outline) {
    border-color: var(--border-default);
}

.neural-input :deep(.v-field--focused .v-field__outline) {
    border-color: var(--primary-500);
}

/* Remove browser focus outline - Vuetify handles focus styling */
.neural-input :deep(.v-field__input:focus),
.neural-input :deep(.v-field__input:focus-visible),
.neural-input :deep(input:focus),
.neural-input :deep(input:focus-visible) {
    outline: none !important;
    box-shadow: none !important;
}

.neural-input :deep(.v-field:focus-within) {
    outline: none !important;
}

.error-alert {
    margin-bottom: var(--space-2);
}

.submit-btn {
    margin-top: var(--space-2);
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0.01em;
}

/* Success Section */
.success-section {
    text-align: center;
}

.success-icon {
    margin-bottom: var(--space-4);
    animation: bounceIn 0.5s ease-out;
}

@keyframes bounceIn {
    0% { transform: scale(0); opacity: 0; }
    50% { transform: scale(1.1); }
    100% { transform: scale(1); opacity: 1; }
}

.magic-link-card {
    background: var(--bg-deep) !important;
    border: 1px solid var(--border-subtle) !important;
    margin-top: var(--space-4);
}

.demo-notice {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin-bottom: var(--space-4);
    display: flex;
    align-items: center;
    justify-content: center;
}

.access-btn {
    font-weight: 600;
    text-transform: none;
    margin-bottom: var(--space-4);
}

.link-preview {
    margin-top: var(--space-3);
}

/* Footer */
.card-footer {
    text-align: center;
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-subtle);
}

.footer-text {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin: 0;
}

/* Transitions */
.slide-fade-enter-active,
.slide-fade-leave-active {
    transition: all 0.3s ease;
}

.slide-fade-enter-from {
    opacity: 0;
    transform: translateX(20px);
}

.slide-fade-leave-to {
    opacity: 0;
    transform: translateX(-20px);
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}

/* Light theme adjustments */
.theme-neural-light .login-card {
    background: rgba(255, 255, 255, 0.9);
}

.theme-neural-light .gradient-orb {
    opacity: 0.3;
}

/* Responsive */
@media (max-width: 480px) {
    .login-card {
        padding: var(--space-6);
    }

    .logo-icon svg {
        width: 48px;
        height: 48px;
    }
}
</style>
