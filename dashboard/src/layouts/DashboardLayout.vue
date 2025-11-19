<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

// Navigation drawer state
const drawer = ref(true);

// Navigation items based on sitemap and user role
const navigationItems = computed(() => {
    const baseItems = [
        {
            title: 'Dashboard',
            icon: 'mdi-view-dashboard',
            to: '/dashboard',
            exact: true
        },
        {
            title: 'Account',
            icon: 'mdi-account-cog',
            to: '/dashboard/account'
        },
        {
            title: 'Analytics',
            icon: 'mdi-chart-line',
            to: '/dashboard/analytics',
            children: [
                {
                    title: 'Data',
                    icon: 'mdi-database',
                    to: '/dashboard/analytics/data'
                },
                {
                    title: 'Charts',
                    icon: 'mdi-chart-bar',
                    to: '/dashboard/analytics/charts'
                }
            ]
        },
        {
            title: 'Channels',
            icon: 'mdi-forum',
            to: '/dashboard/channels'
        }
    ];

    // Add admin section for admin users
    if (currentUser.value?.role === 'admin') {
        baseItems.push({
            title: 'Administration',
            icon: 'mdi-shield-crown',
            to: '/dashboard/admin',
            children: [
                {
                    title: 'Users',
                    icon: 'mdi-account-multiple',
                    to: '/dashboard/admin/users'
                },
                {
                    title: 'Channels',
                    icon: 'mdi-forum',
                    to: '/dashboard/admin/channels'
                },
                {
                    title: 'Agents',
                    icon: 'mdi-robot',
                    to: '/dashboard/admin/agents'
                },
                {
                    title: 'MCP Tools',
                    icon: 'mdi-tools',
                    to: '/dashboard/admin/mcptools'
                },
                {
                    title: 'Tool Executions',
                    icon: 'mdi-play-circle',
                    to: '/dashboard/admin/executions'
                },
                {
                    title: 'Task Analytics',
                    icon: 'mdi-chart-line',
                    to: '/dashboard/admin/tasks'
                },
                {
                    title: 'Audit Logs',
                    icon: 'mdi-shield-search',
                    to: '/dashboard/admin/auditlogs'
                },
                {
                    title: 'Security',
                    icon: 'mdi-security',
                    to: '/dashboard/admin/security'
                },
                {
                    title: 'System Health',
                    icon: 'mdi-monitor-dashboard',
                    to: '/dashboard/admin/system'
                }
            ]
        });
    }

    return baseItems;
});

// Computed
const currentUser = computed(() => authStore.user);

// Methods
const handleLogout = (): void => {
    authStore.logout();
    router.push('/login');
};

const isActive = (item: any): boolean => {
    if (item.exact) {
        return route.path === item.to;
    }
    return route.path.startsWith(item.to);
};
</script>

<template>
    <v-app>
        <!-- Navigation Drawer -->
        <v-navigation-drawer
            v-model="drawer"
            app
            permanent
            width="280"
            class="dashboard-nav"
        >
            <!-- Logo Section -->
            <div class="nav-header pa-4">
                <div class="d-flex align-center">
                    <v-icon size="32" color="primary" class="mr-3">
                        mdi-account-network
                    </v-icon>
                    <div>
                        <h3 class="text-h6">MXF Dashboard</h3>
                        <p class="text-caption text-medium-emphasis">
                            Model Exchange Framework
                        </p>
                    </div>
                </div>
            </div>

            <v-divider />

            <!-- Navigation Items -->
            <v-list nav class="py-2">
                <template v-for="item in navigationItems" :key="item.title">
                    <!-- Item with children (expandable) -->
                    <v-list-group v-if="item.children" :value="item.title">
                        <template #activator="{ props }">
                            <v-list-item
                                v-bind="props"
                                :prepend-icon="item.icon"
                                :title="item.title"
                                :active="isActive(item)"
                            />
                        </template>
                        
                        <v-list-item
                            v-for="child in item.children"
                            :key="child.title"
                            :to="child.to"
                            :prepend-icon="child.icon"
                            :title="child.title"
                        />
                    </v-list-group>

                    <!-- Regular item -->
                    <v-list-item
                        v-else
                        :to="item.to"
                        :prepend-icon="item.icon"
                        :title="item.title"
                        :active="isActive(item)"
                    />
                </template>
            </v-list>

            <v-spacer />

            <!-- User Section -->
            <div class="nav-footer pa-4">
                <v-divider class="mb-4" />
                
                <div class="d-flex align-center mb-3">
                    <v-avatar size="32" color="primary" class="mr-3">
                        <span class="text-body-2">
                            {{ currentUser?.firstName?.charAt(0) }}{{ currentUser?.lastName?.charAt(0) }}
                        </span>
                    </v-avatar>
                    <div class="flex-grow-1">
                        <p class="text-body-2 mb-0">
                            {{ currentUser?.firstName }} {{ currentUser?.lastName }}
                        </p>
                        <p class="text-caption text-medium-emphasis">
                            {{ currentUser?.email }}
                        </p>
                    </div>
                </div>

                <v-btn
                    variant="outlined"
                    color="error"
                    size="small"
                    block
                    prepend-icon="mdi-logout"
                    @click="handleLogout"
                >
                    Sign Out
                </v-btn>
            </div>
        </v-navigation-drawer>

        <!-- App Bar -->
        <v-app-bar
            app
            color="surface"
            elevation="1"
            height="64"
        >
            <v-app-bar-nav-icon @click="drawer = !drawer" />
            
            <v-app-bar-title>
                <h2 class="text-h6">
                    {{ $route.meta.title || $route.name }}
                </h2>
            </v-app-bar-title>

            <v-spacer />

            <!-- Header Actions -->
            <v-btn icon="mdi-bell" variant="text" />
            <v-btn icon="mdi-cog" variant="text" />
        </v-app-bar>

        <!-- Main Content -->
        <v-main>
            <v-container fluid class="dashboard-content pa-6">
                <router-view />
            </v-container>
        </v-main>
    </v-app>
</template>

<style scoped>
.dashboard-nav {
    background: var(--v-theme-sidebar-bg) !important;
    border-right: 1px solid rgba(255, 255, 255, 0.12);
}

.nav-header {
    background: rgba(0, 0, 0, 0.2);
}

.nav-footer {
    background: rgba(0, 0, 0, 0.1);
}

.dashboard-content {
    background: var(--v-theme-background);
    min-height: calc(100vh - 64px);
}

/* Custom scrollbar for navigation */
.dashboard-nav :deep(.v-navigation-drawer__content) {
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
}

.dashboard-nav :deep(.v-navigation-drawer__content)::-webkit-scrollbar {
    width: 6px;
}

.dashboard-nav :deep(.v-navigation-drawer__content)::-webkit-scrollbar-track {
    background: transparent;
}

.dashboard-nav :deep(.v-navigation-drawer__content)::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
}
</style>
