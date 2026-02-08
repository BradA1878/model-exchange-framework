<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const authStore = useAuthStore();

// Form state
const firstName = ref('');
const lastName = ref('');
const company = ref('');
const valid = ref(false);
const loading = ref(false);
const error = ref('');

// Form rules
const requiredRule = [(v: string) => !!v?.trim() || 'This field is required'];

const handleSubmit = async (): Promise<void> => {
    if (!valid.value) return;

    loading.value = true;
    error.value = '';

    try {
        await authStore.updateUserProfile({
            firstName: firstName.value.trim(),
            lastName: lastName.value.trim(),
            company: company.value.trim() || undefined
        });

        // Navigate to the main dashboard now that profile is complete
        router.push('/dashboard');
    } catch (err: any) {
        error.value = err.response?.data?.message || err.message || 'Failed to update profile. Please try again.';
    } finally {
        loading.value = false;
    }
};
</script>

<template>
    <div class="onboarding-page">
        <!-- Neural background pattern -->
        <div class="neural-background">
            <div class="gradient-orb gradient-orb--1"></div>
            <div class="gradient-orb gradient-orb--2"></div>
            <div class="gradient-orb gradient-orb--3"></div>
            <div class="neural-grid"></div>
        </div>

        <!-- Onboarding Card -->
        <div class="onboarding-container">
            <div class="onboarding-card">
                <!-- Logo Section -->
                <div class="logo-section">
                    <div class="logo-icon">
                        <img src="/logo.png" alt="MXF" width="64" height="64" />
                    </div>
                    <h1 class="logo-title">Welcome to MXF</h1>
                    <p class="logo-subtitle">Let's set up your profile</p>
                </div>

                <!-- Progress Indicator -->
                <div class="progress-section">
                    <div class="progress-steps">
                        <div class="progress-step progress-step--completed">
                            <div class="step-icon">
                                <v-icon size="16">mdi-check</v-icon>
                            </div>
                            <span class="step-label">Email verified</span>
                        </div>
                        <div class="progress-connector progress-connector--active"></div>
                        <div class="progress-step progress-step--active">
                            <div class="step-icon">
                                <span>2</span>
                            </div>
                            <span class="step-label">Profile setup</span>
                        </div>
                        <div class="progress-connector"></div>
                        <div class="progress-step">
                            <div class="step-icon">
                                <span>3</span>
                            </div>
                            <span class="step-label">Dashboard</span>
                        </div>
                    </div>
                </div>

                <!-- Form Section -->
                <div class="form-section">
                    <p class="form-description">
                        Complete your profile to get started with the Model Exchange Framework.
                    </p>

                    <v-form v-model="valid" @submit.prevent="handleSubmit" class="onboarding-form">
                        <div class="form-row">
                            <v-text-field
                                v-model="firstName"
                                label="First Name"
                                variant="outlined"
                                :rules="requiredRule"
                                prepend-inner-icon="mdi-account-outline"
                                :disabled="loading"
                                hide-details="auto"
                                class="neural-input"
                            />
                        </div>

                        <div class="form-row">
                            <v-text-field
                                v-model="lastName"
                                label="Last Name"
                                variant="outlined"
                                :rules="requiredRule"
                                prepend-inner-icon="mdi-account-outline"
                                :disabled="loading"
                                hide-details="auto"
                                class="neural-input"
                            />
                        </div>

                        <div class="form-row">
                            <v-text-field
                                v-model="company"
                                label="Company (optional)"
                                variant="outlined"
                                prepend-inner-icon="mdi-domain"
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
                            <v-icon start>mdi-rocket-launch</v-icon>
                            Get Started
                        </v-btn>
                    </v-form>
                </div>

                <!-- Footer -->
                <div class="card-footer">
                    <p class="footer-text">
                        You can update these details later in your account settings.
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.onboarding-page {
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
    right: -100px;
    animation: float1 20s ease-in-out infinite;
}

.gradient-orb--2 {
    width: 400px;
    height: 400px;
    background: linear-gradient(135deg, #10B981 0%, var(--accent-500) 100%);
    bottom: -100px;
    left: -50px;
    animation: float2 15s ease-in-out infinite;
}

.gradient-orb--3 {
    width: 300px;
    height: 300px;
    background: linear-gradient(135deg, var(--primary-600) 0%, var(--secondary-500) 100%);
    top: 40%;
    left: 30%;
    animation: float3 25s ease-in-out infinite;
}

@keyframes float1 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    50% { transform: translate(-50px, 30px) scale(1.1); }
}

@keyframes float2 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    50% { transform: translate(30px, -50px) scale(1.05); }
}

@keyframes float3 {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.15); }
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

/* Onboarding Container */
.onboarding-container {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 480px;
    padding: var(--space-4);
}

/* Onboarding Card - Glassmorphism */
.onboarding-card {
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
    margin-bottom: var(--space-6);
}

.logo-icon {
    display: inline-flex;
    margin-bottom: var(--space-3);
    animation: float 3s ease-in-out infinite;
}

@keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
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

/* Progress Section */
.progress-section {
    margin-bottom: var(--space-6);
    padding: 0 var(--space-2);
}

.progress-steps {
    display: flex;
    align-items: center;
    justify-content: center;
}

.progress-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
}

.step-icon {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-hover);
    border: 2px solid var(--border-default);
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 600;
    transition: all var(--transition-base);
}

.progress-step--completed .step-icon {
    background: #10B981;
    border-color: #10B981;
    color: white;
}

.progress-step--active .step-icon {
    background: var(--primary-500);
    border-color: var(--primary-500);
    color: white;
    box-shadow: var(--glow-primary);
}

.step-label {
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
}

.progress-step--active .step-label {
    color: var(--text-primary);
    font-weight: 500;
}

.progress-step--completed .step-label {
    color: #10B981;
}

.progress-connector {
    width: 40px;
    height: 2px;
    background: var(--border-default);
    margin: 0 var(--space-2);
    margin-bottom: var(--space-6);
}

.progress-connector--active {
    background: linear-gradient(90deg, #10B981 0%, var(--primary-500) 100%);
}

/* Form Section */
.form-section {
    margin-bottom: var(--space-4);
}

.form-description {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    text-align: center;
    margin: 0 0 var(--space-5);
    line-height: 1.5;
}

.onboarding-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.form-row {
    margin-bottom: var(--space-1);
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

.error-alert {
    margin-bottom: var(--space-2);
}

.submit-btn {
    margin-top: var(--space-3);
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0.01em;
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
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}

/* Light theme adjustments */
.theme-neural-light .onboarding-card {
    background: rgba(255, 255, 255, 0.9);
}

.theme-neural-light .gradient-orb {
    opacity: 0.3;
}

/* Responsive */
@media (max-width: 480px) {
    .onboarding-card {
        padding: var(--space-6);
    }

    .logo-icon svg {
        width: 48px;
        height: 48px;
    }

    .progress-connector {
        width: 24px;
    }

    .step-label {
        display: none;
    }
}
</style>
