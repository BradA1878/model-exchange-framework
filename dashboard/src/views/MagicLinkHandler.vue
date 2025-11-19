<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const loading = ref(true);
const error = ref('');

onMounted(async () => {
    try {
        const token = route.query.token as string;
        
        if (!token) {
            error.value = 'Invalid magic link - no token provided';
            setTimeout(() => router.push('/login'), 2000);
            return;
        }

        // Verify magic link token with backend
        await authStore.verifyMagicLink(token);
        
        // Navigate to dashboard
        router.push('/dashboard');
    } catch (err: any) {
        error.value = err.message || 'Invalid magic link. Please try logging in again.';
        setTimeout(() => router.push('/login'), 2000);
    } finally {
        loading.value = false;
    }
});
</script>

<template>
    <v-container fluid class="fill-height magic-link-container">
        <v-row justify="center" align="center" class="fill-height">
            <v-col cols="12" sm="8" md="6" lg="4" xl="3">
                <v-card class="magic-link-card" elevation="0">
                    <v-card-text class="pa-6 text-center">
                        <div v-if="loading">
                            <v-progress-circular
                                indeterminate
                                size="64"
                                color="primary"
                                class="mb-4"
                            />
                            <h2 class="text-h5 mb-2">Processing Magic Link</h2>
                            <p class="text-body-2 text-medium-emphasis">
                                Please wait while we log you in...
                            </p>
                        </div>
                        
                        <div v-else-if="error">
                            <v-icon size="64" color="error" class="mb-4">
                                mdi-close-circle
                            </v-icon>
                            <h2 class="text-h5 mb-2">Authentication Failed</h2>
                            <p class="text-body-2 text-medium-emphasis mb-4">
                                {{ error }}
                            </p>
                            <p class="text-caption text-medium-emphasis">
                                Redirecting to login page...
                            </p>
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>
    </v-container>
</template>

<style scoped>
.magic-link-container {
    background: linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%);
    min-height: 100vh;
}

.magic-link-card {
    background: rgba(26, 26, 26, 0.95);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
}
</style>
