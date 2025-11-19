<script setup lang="ts">
import { computed } from 'vue';
import { useAdminStore } from '../../stores/admin';

const adminStore = useAdminStore();

// Computed properties
const systemHealth = computed(() => adminStore.systemHealth);

const getHealthStatusColor = (status: string): string => {
    switch (status) {
        case 'healthy': return 'success';
        case 'warning': return 'warning';
        case 'critical': return 'error';
        default: return 'grey';
    }
};

const getServiceStatusColor = (status: string): string => {
    switch (status) {
        case 'online': return 'success';
        case 'degraded': return 'warning';
        case 'offline': return 'error';
        default: return 'grey';
    }
};
</script>

<template>
    <div class="admin-system">
        <!-- Header -->
        <div class="d-flex align-center justify-space-between mb-6">
            <div>
                <h2 class="text-h4 mb-2">
                    <v-icon class="mr-3" size="32">mdi-monitor-dashboard</v-icon>
                    System Health
                </h2>
                <p class="text-subtitle-1 text-medium-emphasis">
                    Monitor system services and overall health status
                </p>
            </div>
        </div>

        <!-- Overall System Status -->
        <v-row class="mb-6">
            <v-col cols="12">
                <v-card elevation="2">
                    <v-card-title>
                        <div class="d-flex align-center justify-space-between w-100">
                            <div class="d-flex align-center">
                                <v-icon class="mr-2" size="24">mdi-heart-pulse</v-icon>
                                System Status
                            </div>
                            <div class="d-flex align-center">
                                <v-chip
                                    :color="getHealthStatusColor(systemHealth.status)"
                                    size="large"
                                    class="mr-3"
                                >
                                    <v-icon start size="16">mdi-circle</v-icon>
                                    {{ systemHealth.status.toUpperCase() }}
                                </v-chip>
                                <span class="text-caption text-medium-emphasis">
                                    Last checked: {{ new Date(systemHealth.lastChecked).toLocaleTimeString() }}
                                </span>
                            </div>
                        </div>
                    </v-card-title>
                </v-card>
            </v-col>
        </v-row>

        <!-- Services Status -->
        <v-row class="mb-6">
            <v-col cols="12">
                <v-card elevation="2">
                    <v-card-title>
                        <v-icon class="mr-2" size="24">mdi-cogs</v-icon>
                        Services Status
                    </v-card-title>
                    <v-card-text>
                        <div class="services-status">
                            <div 
                                class="service-item mb-3" 
                                v-for="(status, service) in systemHealth.services" 
                                :key="service"
                            >
                                <div class="d-flex align-center justify-space-between">
                                    <div class="d-flex align-center">
                                        <v-icon 
                                            :color="getServiceStatusColor(status)"
                                            class="mr-3"
                                            size="20"
                                            :icon="status === 'online' ? 'mdi-check-circle' : status === 'degraded' ? 'mdi-alert-circle' : 'mdi-close-circle'"
                                        />
                                        <span class="text-capitalize text-body-1">{{ service }}</span>
                                    </div>
                                    <v-chip
                                        :color="getServiceStatusColor(status)"
                                        size="small"
                                        variant="flat"
                                    >
                                        {{ status.toUpperCase() }}
                                    </v-chip>
                                </div>
                            </div>
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>
    </div>
</template>

<style scoped>
.admin-system {
    max-width: 1400px;
    margin: 0 auto;
    padding: 1rem;
}

.services-status {
    padding: 0 0.5rem;
}

.service-item {
    border-radius: 4px;
    padding: 0.5rem;
    background: rgba(255, 255, 255, 0.02);
}
</style>
