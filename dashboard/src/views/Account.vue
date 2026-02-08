<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useTokensStore, type CreateTokenOptions, type CreateTokenResponse } from '../stores/tokens';

const authStore = useAuthStore();
const tokensStore = useTokensStore();

// Form data
const profileForm = ref({
    firstName: '',
    lastName: '',
    email: '',
    company: ''
});

// Error state for displaying backend validation errors
const profileError = ref<string | null>(null);
const emailError = ref<string | null>(null);

// Form validation
const profileValid = ref(false);

// Loading states
const profileLoading = ref(false);

// Success states
const profileSuccess = ref(false);

// Form rules
const requiredRule = [(v: string) => !!v || 'This field is required'];
const emailRule = [
    (v: string) => !!v || 'Email is required',
    (v: string) => /.+@.+\..+/.test(v) || 'Email must be valid'
];

// Token management state
const showCreateTokenDialog = ref(false);
const showRevokeDialog = ref(false);
const showSecretDialog = ref(false);
const tokenToRevoke = ref<string | null>(null);
const tokenToRevokeName = ref<string>('');
const secretCopied = ref(false);

// Create token form
const createTokenForm = ref({
    name: '',
    description: '',
    expiresIn: 'never', // 'never', '30', '90', '365', 'custom'
    customExpiration: '',
    maxRequestsPerDay: null as number | null,
    maxRequestsPerMonth: null as number | null,
});
const createTokenValid = ref(false);

// Expiration options
const expirationOptions = [
    { title: 'Never', value: 'never' },
    { title: '30 days', value: '30' },
    { title: '90 days', value: '90' },
    { title: '1 year', value: '365' },
    { title: 'Custom date', value: 'custom' },
];

// Computed - format the full access token for display
const fullAccessToken = computed(() => {
    if (tokensStore.lastCreatedToken) {
        return `${tokensStore.lastCreatedToken.tokenId}:${tokensStore.lastCreatedToken.secret}`;
    }
    return '';
});

// Token methods
const openCreateTokenDialog = (): void => {
    createTokenForm.value = {
        name: '',
        description: '',
        expiresIn: 'never',
        customExpiration: '',
        maxRequestsPerDay: null,
        maxRequestsPerMonth: null,
    };
    showCreateTokenDialog.value = true;
};

const createToken = async (): Promise<void> => {
    if (!createTokenValid.value) return;

    // Calculate expiration date
    let expiresAt: string | undefined;
    if (createTokenForm.value.expiresIn !== 'never') {
        if (createTokenForm.value.expiresIn === 'custom') {
            expiresAt = createTokenForm.value.customExpiration;
        } else {
            const days = parseInt(createTokenForm.value.expiresIn);
            const date = new Date();
            date.setDate(date.getDate() + days);
            expiresAt = date.toISOString();
        }
    }

    const options: CreateTokenOptions = {
        name: createTokenForm.value.name.trim(),
        description: createTokenForm.value.description?.trim() || undefined,
        expiresAt,
        maxRequestsPerDay: createTokenForm.value.maxRequestsPerDay || undefined,
        maxRequestsPerMonth: createTokenForm.value.maxRequestsPerMonth || undefined,
    };

    const result = await tokensStore.createToken(options);
    if (result) {
        showCreateTokenDialog.value = false;
        showSecretDialog.value = true;
        secretCopied.value = false;
    }
};

const copyTokenToClipboard = async (): Promise<void> => {
    try {
        await navigator.clipboard.writeText(fullAccessToken.value);
        secretCopied.value = true;
    } catch (err) {
        console.error('Failed to copy token:', err);
    }
};

const closeSecretDialog = (): void => {
    showSecretDialog.value = false;
    tokensStore.clearLastCreatedToken();
};

const confirmRevokeToken = (tokenId: string, tokenName: string): void => {
    tokenToRevoke.value = tokenId;
    tokenToRevokeName.value = tokenName;
    showRevokeDialog.value = true;
};

const revokeToken = async (): Promise<void> => {
    if (!tokenToRevoke.value) return;

    const success = await tokensStore.revokeToken(tokenToRevoke.value);
    if (success) {
        showRevokeDialog.value = false;
        tokenToRevoke.value = null;
        tokenToRevokeName.value = '';
    }
};

// Format date for display
const formatDate = (dateString?: string): string => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
};

// Format relative time
const formatRelativeTime = (dateString?: string): string => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
};


// Computed
const currentUser = computed(() => authStore.user);
const memberSince = computed(() => {
    // For demo purposes, generate a date based on user creation
    // In a real app, this would come from the user object
    const baseDate = new Date('2024-01-01');
    if (currentUser.value?.email) {
        // Use email hash to generate consistent date
        const hash = currentUser.value.email.split('').reduce((a, b) => {
            a = ((a << 5) - a) + b.charCodeAt(0);
            return a & a;
        }, 0);
        const daysOffset = Math.abs(hash) % 365;
        const memberDate = new Date(baseDate);
        memberDate.setDate(memberDate.getDate() + daysOffset);
        return memberDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    }
    return 'January 2024';
});
const userInitials = computed(() => {
    if (currentUser.value?.firstName && currentUser.value?.lastName) {
        return `${currentUser.value.firstName.charAt(0)}${currentUser.value.lastName.charAt(0)}`;
    }
    if (currentUser.value?.firstName) {
        return currentUser.value.firstName.charAt(0);
    }
    if (currentUser.value?.email) {
        return currentUser.value.email.charAt(0).toUpperCase();
    }
    return 'U';
});

// Initialize form with current user data
const initializeForm = (): void => {
    if (currentUser.value) {
        profileForm.value = {
            firstName: currentUser.value.firstName || '',
            lastName: currentUser.value.lastName || '',
            email: currentUser.value.email || '',
            company: currentUser.value.company || ''
        };
    }
};

// Methods
const updateProfile = async (): Promise<void> => {
    if (!profileValid.value) return;

    profileLoading.value = true;
    profileSuccess.value = false;
    profileError.value = null;
    emailError.value = null;

    try {
        // Update the user profile with real backend API call
        await authStore.updateUserProfile({
            firstName: profileForm.value.firstName,
            lastName: profileForm.value.lastName,
            email: profileForm.value.email,
            company: profileForm.value.company
        });

        // Show success message
        profileSuccess.value = true;

        // Reset success message after 3 seconds
        setTimeout(() => {
            profileSuccess.value = false;
        }, 3000);

    } catch (error: any) {
        console.error('Profile update error:', error);
        // Extract error message from response
        const errorMessage = error.response?.data?.message || error.message || 'Failed to update profile';

        // Check if it's an email-specific error
        if (errorMessage.toLowerCase().includes('email')) {
            emailError.value = errorMessage;
        } else {
            profileError.value = errorMessage;
        }
    } finally {
        profileLoading.value = false;
    }
};

// Initialize form when component mounts
initializeForm();

// Watch for changes in currentUser and re-initialize form
watch(currentUser, () => {
    if (currentUser.value) {
        initializeForm();
    }
}, { deep: true });

// Fetch tokens when component mounts
onMounted(() => {
    tokensStore.fetchTokens();
});
</script>

<template>
    <div class="acct">
        <!-- Header Strip -->
        <header class="acct__header">
            <div class="acct__header-left">
                <h2 class="acct__header-title">Account Settings</h2>
                <span class="acct__header-divider">/</span>
                <span class="acct__header-sub">Manage your profile information</span>
            </div>
        </header>

        <v-row>
            <!-- Profile Information -->
            <v-col cols="12" lg="8">
                <div class="acct__profile">
                    <div class="acct__profile-head">
                        <div class="acct__profile-title">
                            <v-icon size="16">mdi-account-edit</v-icon>
                            <span>Profile Information</span>
                        </div>
                    </div>
                    <div class="acct__profile-body">
                        <v-form v-model="profileValid" @submit.prevent="updateProfile">
                            <v-row>
                                <v-col cols="12" sm="6">
                                    <v-text-field
                                        v-model="profileForm.firstName"
                                        label="First Name"
                                        variant="outlined"
                                        :rules="requiredRule"
                                        prepend-inner-icon="mdi-account"
                                        :loading="profileLoading"
                                    />
                                </v-col>
                                <v-col cols="12" sm="6">
                                    <v-text-field
                                        v-model="profileForm.lastName"
                                        label="Last Name"
                                        variant="outlined"
                                        :rules="requiredRule"
                                        :loading="profileLoading"
                                    />
                                </v-col>
                            </v-row>

                            <v-text-field
                                v-model="profileForm.email"
                                label="Email Address"
                                type="email"
                                variant="outlined"
                                :rules="emailRule"
                                :error-messages="emailError ? [emailError] : []"
                                prepend-inner-icon="mdi-email"
                                class="mb-4"
                                :loading="profileLoading"
                                @update:model-value="emailError = null"
                            />

                            <v-text-field
                                v-model="profileForm.company"
                                label="Company"
                                variant="outlined"
                                prepend-inner-icon="mdi-domain"
                                class="mb-4"
                                :loading="profileLoading"
                            />

                            <v-alert
                                v-if="profileError"
                                type="error"
                                variant="tonal"
                                class="mb-4"
                                closable
                                @click:close="profileError = null"
                            >
                                {{ profileError }}
                            </v-alert>

                            <v-alert
                                v-if="profileSuccess"
                                type="success"
                                variant="tonal"
                                class="mb-4"
                                text="Profile updated successfully!"
                            />

                            <button type="submit" class="acct__btn acct__btn--primary" :disabled="!profileValid || profileLoading">
                                <v-progress-circular v-if="profileLoading" indeterminate size="14" width="2" />
                                <span>Update Profile</span>
                            </button>
                        </v-form>
                    </div>
                </div>
            </v-col>

            <!-- Account Summary -->
            <v-col cols="12" lg="4">
                <div class="acct__summary">
                    <div class="acct__summary-head">
                        <div class="acct__summary-title">
                            <v-icon size="16">mdi-account-circle</v-icon>
                            <span>Account Summary</span>
                        </div>
                    </div>
                    <div class="acct__summary-body">
                        <div class="acct__summary-avatar">
                            <v-avatar size="80" color="primary" class="mb-3">
                                <span class="text-h4">
                                    {{ userInitials }}
                                </span>
                            </v-avatar>
                            <h3 class="acct__summary-name">
                                {{ currentUser?.firstName }} {{ currentUser?.lastName }}
                            </h3>
                            <p class="acct__summary-email">
                                {{ currentUser?.email }}
                            </p>
                        </div>

                        <div class="acct__summary-divider"></div>

                        <div class="acct__details">
                            <div class="acct__detail">
                                <div class="acct__detail-label">
                                    <v-icon size="16">mdi-shield-check</v-icon>
                                    <span>Account Status</span>
                                </div>
                                <v-chip color="success" size="small" class="mt-1">
                                    Active
                                </v-chip>
                            </div>

                            <div class="acct__detail">
                                <div class="acct__detail-label">
                                    <v-icon size="16">mdi-calendar</v-icon>
                                    <span>Member Since</span>
                                </div>
                                <p class="acct__detail-value">
                                    {{ memberSince }}
                                </p>
                            </div>

                            <div class="acct__detail">
                                <div class="acct__detail-label">
                                    <v-icon size="16">mdi-crown</v-icon>
                                    <span>Role</span>
                                </div>
                                <v-chip color="primary" size="small" class="mt-1">
                                    {{ currentUser?.role || 'User' }}
                                </v-chip>
                            </div>
                        </div>
                    </div>
                </div>
            </v-col>
        </v-row>

        <!-- API Tokens Section -->
        <div class="acct__tokens">
            <div class="acct__tokens-head">
                <div class="acct__tokens-title">
                    <v-icon size="16">mdi-key-variant</v-icon>
                    <span>API Tokens</span>
                </div>
                <button class="acct__btn acct__btn--primary" @click="openCreateTokenDialog">
                    <v-icon size="14">mdi-plus</v-icon>
                    <span>Create Token</span>
                </button>
            </div>
            <div class="acct__tokens-subtitle">
                Personal Access Tokens allow SDK authentication without username/password.
                This is the recommended authentication method for SDK usage.
            </div>
            <div class="acct__tokens-body">
                <!-- Loading state -->
                <div v-if="tokensStore.loading" class="acct__empty">
                    <v-progress-circular indeterminate color="primary" size="48" />
                    <p class="acct__empty-title">Loading tokens...</p>
                </div>

                <!-- Error state -->
                <v-alert
                    v-else-if="tokensStore.error"
                    type="error"
                    variant="tonal"
                    class="mb-4"
                    closable
                    @click:close="tokensStore.clearError()"
                >
                    {{ tokensStore.error }}
                </v-alert>

                <!-- Empty state -->
                <div v-else-if="tokensStore.tokens.length === 0" class="acct__empty">
                    <v-icon size="48" class="acct__empty-icon">mdi-key-variant</v-icon>
                    <p class="acct__empty-title">No API Tokens</p>
                    <p class="acct__empty-sub">
                        Create a Personal Access Token to authenticate your SDK applications.
                    </p>
                    <button class="acct__btn acct__btn--primary" @click="openCreateTokenDialog">
                        <v-icon size="14">mdi-plus</v-icon>
                        <span>Create Your First Token</span>
                    </button>
                </div>

                <!-- Tokens table -->
                <v-table v-else class="acct__table">
                    <thead>
                        <tr>
                            <th class="acct__table-th">Name</th>
                            <th class="acct__table-th">Token ID</th>
                            <th class="acct__table-th">Created</th>
                            <th class="acct__table-th">Expires</th>
                            <th class="acct__table-th">Last Used</th>
                            <th class="acct__table-th">Usage</th>
                            <th class="acct__table-th">Status</th>
                            <th class="acct__table-th text-center">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="token in tokensStore.tokens" :key="token.tokenId">
                            <td>
                                <div>
                                    <strong>{{ token.name }}</strong>
                                    <div v-if="token.description" class="acct__table-desc">
                                        {{ token.description }}
                                    </div>
                                </div>
                            </td>
                            <td>
                                <code class="acct__token-id">{{ token.tokenId }}</code>
                            </td>
                            <td>{{ formatDate(token.createdAt) }}</td>
                            <td>
                                <span :class="{ 'text-warning': token.expiresAt && new Date(token.expiresAt) < new Date() }">
                                    {{ formatDate(token.expiresAt) }}
                                </span>
                            </td>
                            <td>{{ formatRelativeTime(token.lastUsed) }}</td>
                            <td>
                                <span class="acct__table-usage">{{ token.usageCount.toLocaleString() }} requests</span>
                                <div v-if="token.maxRequestsPerDay" class="acct__table-desc">
                                    Daily: {{ token.dailyUsageCount || 0 }}/{{ token.maxRequestsPerDay }}
                                </div>
                            </td>
                            <td>
                                <v-chip
                                    :color="token.isActive ? 'success' : 'error'"
                                    size="small"
                                    variant="flat"
                                >
                                    {{ token.isActive ? 'Active' : 'Revoked' }}
                                </v-chip>
                            </td>
                            <td class="text-center">
                                <v-btn
                                    v-if="token.isActive"
                                    color="error"
                                    variant="text"
                                    size="small"
                                    @click="confirmRevokeToken(token.tokenId, token.name)"
                                >
                                    Revoke
                                </v-btn>
                                <span v-else class="acct__table-desc">
                                    {{ formatDate(token.revokedAt) }}
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </v-table>
            </div>
        </div>

        <!-- Create Token Dialog (raw Vuetify overlay) -->
        <v-dialog v-model="showCreateTokenDialog" max-width="500">
            <v-card>
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2">mdi-key-plus</v-icon>
                    Create API Token
                </v-card-title>

                <v-card-text>
                    <v-form v-model="createTokenValid">
                        <v-text-field
                            v-model="createTokenForm.name"
                            label="Token Name"
                            hint="A friendly name to identify this token (e.g., 'Local Development', 'CI/CD Pipeline')"
                            persistent-hint
                            variant="outlined"
                            :rules="requiredRule"
                            class="mb-4"
                        />

                        <v-textarea
                            v-model="createTokenForm.description"
                            label="Description (optional)"
                            hint="What this token will be used for"
                            persistent-hint
                            variant="outlined"
                            rows="2"
                            class="mb-4"
                        />

                        <v-select
                            v-model="createTokenForm.expiresIn"
                            :items="expirationOptions"
                            label="Expiration"
                            variant="outlined"
                            class="mb-4"
                        />

                        <v-text-field
                            v-if="createTokenForm.expiresIn === 'custom'"
                            v-model="createTokenForm.customExpiration"
                            label="Custom Expiration Date"
                            type="date"
                            variant="outlined"
                            :rules="createTokenForm.expiresIn === 'custom' ? requiredRule : []"
                            class="mb-4"
                        />

                        <v-expansion-panels variant="accordion" class="mb-4">
                            <v-expansion-panel>
                                <v-expansion-panel-title>
                                    <v-icon class="mr-2">mdi-speedometer</v-icon>
                                    Rate Limits (Optional)
                                </v-expansion-panel-title>
                                <v-expansion-panel-text>
                                    <v-text-field
                                        v-model.number="createTokenForm.maxRequestsPerDay"
                                        label="Max Requests Per Day"
                                        type="number"
                                        variant="outlined"
                                        hint="Leave empty for unlimited"
                                        persistent-hint
                                        class="mb-4"
                                    />
                                    <v-text-field
                                        v-model.number="createTokenForm.maxRequestsPerMonth"
                                        label="Max Requests Per Month"
                                        type="number"
                                        variant="outlined"
                                        hint="Leave empty for unlimited"
                                        persistent-hint
                                    />
                                </v-expansion-panel-text>
                            </v-expansion-panel>
                        </v-expansion-panels>
                    </v-form>
                </v-card-text>

                <v-card-actions>
                    <v-spacer />
                    <v-btn
                        variant="text"
                        @click="showCreateTokenDialog = false"
                    >
                        Cancel
                    </v-btn>
                    <v-btn
                        color="primary"
                        variant="elevated"
                        :loading="tokensStore.loading"
                        :disabled="!createTokenValid"
                        @click="createToken"
                    >
                        Create Token
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Token Secret Dialog (shown only once after creation) -->
        <v-dialog v-model="showSecretDialog" max-width="600" persistent>
            <v-card>
                <v-card-title class="d-flex align-center">
                    <v-icon color="success" class="mr-2">mdi-check-circle</v-icon>
                    Token Created Successfully
                </v-card-title>

                <v-card-text>
                    <v-alert type="warning" variant="tonal" class="mb-4">
                        <strong>Important:</strong> Copy your access token now.
                        You won't be able to see it again!
                    </v-alert>

                    <div class="acct__secret-box">
                        <div class="d-flex align-center justify-space-between">
                            <code class="acct__secret-code">{{ fullAccessToken }}</code>
                            <v-btn
                                :color="secretCopied ? 'success' : 'primary'"
                                variant="elevated"
                                size="small"
                                :prepend-icon="secretCopied ? 'mdi-check' : 'mdi-content-copy'"
                                @click="copyTokenToClipboard"
                            >
                                {{ secretCopied ? 'Copied!' : 'Copy' }}
                            </v-btn>
                        </div>
                    </div>

                    <div class="text-body-2 mb-4">
                        <strong>Usage:</strong> Add this to your <code>.env</code> file:
                    </div>
                    <div class="acct__code-block">
                        <code>MXF_ACCESS_TOKEN={{ fullAccessToken }}</code>
                    </div>

                    <div class="text-body-2 mt-4">
                        <strong>In your code:</strong>
                    </div>
                    <div class="acct__code-block">
                        <pre><code>const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY,
    accessToken: process.env.MXF_ACCESS_TOKEN
});</code></pre>
                    </div>
                </v-card-text>

                <v-card-actions>
                    <v-spacer />
                    <v-btn
                        color="primary"
                        variant="elevated"
                        @click="closeSecretDialog"
                    >
                        I've Saved My Token
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Revoke Confirmation Dialog (raw Vuetify overlay) -->
        <v-dialog v-model="showRevokeDialog" max-width="400">
            <v-card>
                <v-card-title class="d-flex align-center">
                    <v-icon color="error" class="mr-2">mdi-alert</v-icon>
                    Revoke Token
                </v-card-title>

                <v-card-text>
                    <p>Are you sure you want to revoke the token <strong>"{{ tokenToRevokeName }}"</strong>?</p>
                    <p class="text-medium-emphasis mt-2">
                        This action cannot be undone. Any applications using this token will immediately lose access.
                    </p>
                </v-card-text>

                <v-card-actions>
                    <v-spacer />
                    <v-btn
                        variant="text"
                        @click="showRevokeDialog = false"
                    >
                        Cancel
                    </v-btn>
                    <v-btn
                        color="error"
                        variant="elevated"
                        :loading="tokensStore.loading"
                        @click="revokeToken"
                    >
                        Revoke Token
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<style scoped>
/* ════════════════════════════════════════════
   MXF Account Settings — Design System
   BEM prefix: acct__
   ════════════════════════════════════════════ */

.acct {
    --ch-blue: #4A90C2;
    --ch-green: #10B981;
    --ch-amber: #F59E0B;
    --ch-cyan: #22D3EE;
    --ch-red: #EF4444;
    max-width: 1200px;
    margin: 0 auto;
}

/* ── Header Strip ─────────────────────── */
.acct__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: var(--space-4);
}

.acct__header-left {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
}

.acct__header-title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
    margin: 0;
}

.acct__header-divider {
    color: var(--text-muted);
    opacity: 0.4;
    font-weight: 300;
}

.acct__header-sub {
    font-size: var(--text-sm);
    color: var(--text-muted);
}

/* ── Buttons ──────────────────────────── */
.acct__btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-base);
    border: 1px solid transparent;
    white-space: nowrap;
    font-family: var(--font-sans);
}

.acct__btn--ghost {
    background: transparent;
    border-color: var(--border-default);
    color: var(--text-secondary);
}

.acct__btn--ghost:hover {
    color: var(--text-primary);
    border-color: var(--ch-blue);
    background: rgba(74, 144, 194, 0.08);
}

.acct__btn--primary {
    background: var(--ch-blue);
    color: #fff;
    border-color: var(--ch-blue);
}

.acct__btn--primary:hover {
    background: #3a7db0;
    box-shadow: 0 2px 8px rgba(74, 144, 194, 0.3);
}

.acct__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

/* ── Profile Card ─────────────────────── */
.acct__profile {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition: border-color var(--transition-base);
    margin-bottom: var(--space-6);
}

.acct__profile:hover {
    border-color: var(--border-default);
}

.acct__profile-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
}

.acct__profile-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
}

.acct__profile-body {
    padding: var(--space-5);
}

/* ── Summary Card ─────────────────────── */
.acct__summary {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition: border-color var(--transition-base);
}

.acct__summary:hover {
    border-color: var(--border-default);
}

.acct__summary-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
}

.acct__summary-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
}

.acct__summary-body {
    padding: var(--space-5);
}

.acct__summary-avatar {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    margin-bottom: var(--space-4);
}

.acct__summary-name {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 var(--space-1);
}

.acct__summary-email {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0;
}

.acct__summary-divider {
    height: 1px;
    background: var(--border-subtle);
    margin: var(--space-4) 0;
}

/* ── Account Details ──────────────────── */
.acct__details {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.acct__detail {
    padding: var(--space-2) 0;
}

.acct__detail-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    margin-bottom: var(--space-1);
}

.acct__detail-value {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: var(--space-1) 0 0;
}

/* ── Tokens Card ──────────────────────── */
.acct__tokens {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition: border-color var(--transition-base);
    margin-top: var(--space-4);
}

.acct__tokens:hover {
    border-color: var(--border-default);
}

.acct__tokens-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
}

.acct__tokens-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
}

.acct__tokens-subtitle {
    padding: var(--space-3) var(--space-5) 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: 1.5;
}

.acct__tokens-body {
    padding: var(--space-5);
}

/* ── Tokens Table ─────────────────────── */
.acct__table {
    background: transparent;
}

.acct__table-th {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}

.acct__table-desc {
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.acct__table-usage {
    font-size: var(--text-sm);
}

/* ── Token ID ─────────────────────────── */
.acct__token-id {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    background: var(--bg-hover);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
}

/* ── Secret Box (inside dialog) ───────── */
.acct__secret-box {
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    margin-bottom: var(--space-4);
}

.acct__secret-code {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    word-break: break-all;
    color: var(--primary-500);
}

/* ── Code Block (inside dialog) ───────── */
.acct__code-block {
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    overflow-x: auto;
    margin-top: var(--space-2);
}

.acct__code-block pre {
    margin: 0;
}

/* ── Empty State ──────────────────────── */
.acct__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-12) var(--space-4);
    text-align: center;
}

.acct__empty-icon {
    color: var(--text-muted);
    opacity: 0.4;
}

.acct__empty-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin: var(--space-3) 0 var(--space-1);
}

.acct__empty-sub {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin: 0 0 var(--space-4);
    max-width: 300px;
    line-height: 1.5;
}

/* ── Responsive ───────────────────────── */
@media (max-width: 768px) {
    .acct__header {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-2);
    }

    .acct__tokens-head {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-3);
    }

    .acct__tokens-head .acct__btn {
        align-self: flex-end;
    }

    .acct__table {
        font-size: var(--text-xs);
    }
}

@media (max-width: 480px) {
    .acct__header-title {
        font-size: var(--text-base);
    }

    .acct__header-sub {
        font-size: var(--text-xs);
    }

    .acct__btn {
        width: 100%;
        justify-content: center;
    }

    .acct__profile-body,
    .acct__summary-body,
    .acct__tokens-body {
        padding: var(--space-3);
    }

    .acct__profile-head,
    .acct__summary-head,
    .acct__tokens-head {
        padding: var(--space-3) var(--space-4);
    }
}
</style>
