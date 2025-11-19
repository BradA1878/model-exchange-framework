<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useAuthStore } from '../stores/auth';

const authStore = useAuthStore();

// Form data
const profileForm = ref({
    firstName: '',
    lastName: '',
    email: '',
    company: ''
});



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
        // TODO: Add error display to the UI
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
</script>

<template>
    <div class="account-page">
        <!-- Page Header -->
        <div class="page-header mb-8">
            <h1 class="text-h3 mb-2">Account Settings</h1>
            <p class="text-h6 text-medium-emphasis">
                Manage your profile information.
            </p>
        </div>

        <v-row>
            <!-- Profile Information -->
            <v-col cols="12" lg="8">
                <v-card class="profile-card mb-6" elevation="0">
                    <v-card-title>
                        <div class="d-flex align-center">
                            <v-icon class="mr-2">mdi-account-edit</v-icon>
                            Profile Information
                        </div>
                    </v-card-title>
                    
                    <v-card-text>
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
                                prepend-inner-icon="mdi-email"
                                class="mb-4"
                                :loading="profileLoading"
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
                                v-if="profileSuccess"
                                type="success"
                                variant="tonal"
                                class="mb-4"
                                text="Profile updated successfully!"
                            />

                            <v-btn
                                type="submit"
                                color="primary"
                                :loading="profileLoading"
                                :disabled="!profileValid"
                            >
                                Update Profile
                            </v-btn>
                        </v-form>
                    </v-card-text>
                </v-card>
            </v-col>

            <!-- Account Summary -->
            <v-col cols="12" lg="4">
                <v-card class="summary-card" elevation="0">
                    <v-card-title>
                        <div class="d-flex align-center">
                            <v-icon class="mr-2">mdi-account-circle</v-icon>
                            Account Summary
                        </div>
                    </v-card-title>
                    
                    <v-card-text>
                        <div class="text-center mb-4">
                            <v-avatar size="80" color="primary" class="mb-3">
                                <span class="text-h4">
                                    {{ userInitials }}
                                </span>
                            </v-avatar>
                            <h3 class="text-h5 mb-1">
                                {{ currentUser?.firstName }} {{ currentUser?.lastName }}
                            </h3>
                            <p class="text-body-2 text-medium-emphasis">
                                {{ currentUser?.email }}
                            </p>
                        </div>

                        <v-divider class="my-4" />

                        <div class="account-details">
                            <div class="detail-item mb-3">
                                <div class="d-flex align-center">
                                    <v-icon size="20" class="mr-2">mdi-shield-check</v-icon>
                                    <span class="text-body-2">Account Status</span>
                                </div>
                                <v-chip color="success" size="small" class="mt-1">
                                    Active
                                </v-chip>
                            </div>

                            <div class="detail-item mb-3">
                                <div class="d-flex align-center">
                                    <v-icon size="20" class="mr-2">mdi-calendar</v-icon>
                                    <span class="text-body-2">Member Since</span>
                                </div>
                                <p class="text-body-2 text-medium-emphasis mt-1">
                                    {{ memberSince }}
                                </p>
                            </div>

                            <div class="detail-item mb-3">
                                <div class="d-flex align-center">
                                    <v-icon size="20" class="mr-2">mdi-crown</v-icon>
                                    <span class="text-body-2">Role</span>
                                </div>
                                <v-chip color="primary" size="small" class="mt-1">
                                    {{ currentUser?.role || 'User' }}
                                </v-chip>
                            </div>
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>
    </div>
</template>

<style scoped>
.account-page {
    max-width: 1200px;
    margin: 0 auto;
}

.page-header {
    padding: 2rem 0;
}

.profile-card,
.summary-card {
    background: var(--v-theme-card-bg);
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.detail-item {
    padding: 0.5rem 0;
}
</style>
