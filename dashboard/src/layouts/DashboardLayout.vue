<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTheme } from 'vuetify';
import { useAuthStore } from '../stores/auth';
import { useChannelsStore } from '../stores/channels';
import axios from '../plugins/axios';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const channelsStore = useChannelsStore();
const vuetifyTheme = useTheme();

// Navigation drawer state
const drawer = ref(true);
const railMode = ref(false);

// Theme toggle
const isDarkTheme = computed(() => vuetifyTheme.global.name.value === 'neuralDark');

// Search state
const showSearch = ref(false);
const searchQuery = ref('');
const searchResults = ref<Array<{ id: string; title: string; subtitle: string; type: string; icon: string; route: string }>>([]);
const searchLoading = ref(false);
const searchInput = ref<HTMLInputElement | null>(null);

// Notifications state
const showNotifications = ref(false);
const notifications = ref<Array<{
    id: string;
    title: string;
    message: string;
    icon?: string;
    color?: string;
    timestamp: Date;
    read: boolean;
    route?: string;
}>>([]);

// Computed
const unreadNotifications = computed(() => notifications.value.filter(n => !n.read).length);

// Search methods
const openSearch = (): void => {
    showSearch.value = true;
    nextTick(() => {
        searchInput.value?.focus();
    });
};

const executeSearch = async (): Promise<void> => {
    if (!searchQuery.value.trim()) {
        searchResults.value = [];
        return;
    }

    searchLoading.value = true;
    try {
        // Search across multiple entities
        const query = searchQuery.value.toLowerCase();
        const results: typeof searchResults.value = [];

        // Search channels
        const channels = channelsStore.channels.filter(ch =>
            ch.name.toLowerCase().includes(query) ||
            ch.id.toLowerCase().includes(query) ||
            ch.description?.toLowerCase().includes(query)
        );
        channels.slice(0, 3).forEach(ch => {
            results.push({
                id: `channel-${ch.id}`,
                title: ch.name,
                subtitle: ch.description || ch.id,
                type: 'Channel',
                icon: 'mdi-forum',
                route: `/dashboard/channels/${ch.id}`
            });
        });

        // Search agents via API
        try {
            const agentsResponse = await axios.get('/api/agents', {
                params: { search: query, limit: 3 }
            });
            if (agentsResponse.data.success && agentsResponse.data.agents) {
                agentsResponse.data.agents.forEach((agent: any) => {
                    results.push({
                        id: `agent-${agent.agentId}`,
                        title: agent.name,
                        subtitle: agent.description || agent.agentId,
                        type: 'Agent',
                        icon: 'mdi-robot',
                        route: `/dashboard/channels/${agent.channelId}/agents`
                    });
                });
            }
        } catch (err) {
            console.warn('Agent search failed:', err);
        }

        // Search tasks via API
        try {
            const tasksResponse = await axios.get('/api/tasks', {
                params: { search: query, limit: 3 }
            });
            if (tasksResponse.data.success && tasksResponse.data.tasks) {
                tasksResponse.data.tasks.forEach((task: any) => {
                    results.push({
                        id: `task-${task._id}`,
                        title: task.description?.substring(0, 50) || 'Task',
                        subtitle: `Status: ${task.status}`,
                        type: 'Task',
                        icon: 'mdi-checkbox-marked-circle-outline',
                        route: `/dashboard/channels/${task.channelId}/tasks`
                    });
                });
            }
        } catch (err) {
            console.warn('Task search failed:', err);
        }

        searchResults.value = results;
    } catch (err) {
        console.error('Search error:', err);
        searchResults.value = [];
    } finally {
        searchLoading.value = false;
    }
};

const navigateToResult = (result: typeof searchResults.value[0]): void => {
    showSearch.value = false;
    searchQuery.value = '';
    searchResults.value = [];
    router.push(result.route);
};

// Debounce search
let searchTimeout: ReturnType<typeof setTimeout> | null = null;
watch(searchQuery, (newQuery) => {
    if (searchTimeout) clearTimeout(searchTimeout);
    if (newQuery.trim()) {
        searchTimeout = setTimeout(executeSearch, 300);
    } else {
        searchResults.value = [];
    }
});

// Notifications methods
const markAllRead = (): void => {
    notifications.value.forEach(n => n.read = true);
};

const handleNotificationClick = (notification: typeof notifications.value[0]): void => {
    notification.read = true;
    if (notification.route) {
        router.push(notification.route);
    }
    showNotifications.value = false;
};

const formatNotificationTime = (timestamp: Date): string => {
    const now = new Date();
    const diff = now.getTime() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
};

// Keyboard shortcut for search (Ctrl+K or Cmd+K)
const handleKeydown = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        openSearch();
    }
    if (e.key === 'Escape' && showSearch.value) {
        showSearch.value = false;
    }
};

onMounted(() => {
    document.addEventListener('keydown', handleKeydown);
    // Load channels for search
    channelsStore.fetchChannels();
});

onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown);
});

const toggleTheme = () => {
    vuetifyTheme.global.name.value = isDarkTheme.value ? 'neuralLight' : 'neuralDark';
};

// Navigation sections with grouped items
const navigationSections = computed(() => {
    const sections = [
        {
            label: 'Overview',
            items: [
                {
                    title: 'Dashboard',
                    icon: 'mdi-view-dashboard-outline',
                    activeIcon: 'mdi-view-dashboard',
                    to: '/dashboard',
                    exact: true
                },
                {
                    title: 'Account',
                    icon: 'mdi-account-outline',
                    activeIcon: 'mdi-account',
                    to: '/dashboard/account'
                }
            ]
        },
        {
            label: 'Operations',
            items: [
                {
                    title: 'Channels',
                    icon: 'mdi-forum-outline',
                    activeIcon: 'mdi-forum',
                    to: '/dashboard/channels'
                },
                {
                    title: 'Analytics',
                    icon: 'mdi-chart-line',
                    activeIcon: 'mdi-chart-line',
                    to: '/dashboard/analytics',
                    children: [
                        {
                            title: 'Data',
                            icon: 'mdi-database-outline',
                            to: '/dashboard/analytics/data'
                        },
                        {
                            title: 'Charts',
                            icon: 'mdi-chart-bar',
                            to: '/dashboard/analytics/charts'
                        }
                    ]
                }
            ]
        }
    ];

    // Add admin section for admin users
    if (currentUser.value?.role === 'admin') {
        sections.push({
            label: 'Administration',
            items: [
                {
                    title: 'Admin Panel',
                    icon: 'mdi-shield-crown-outline',
                    activeIcon: 'mdi-shield-crown',
                    to: '/dashboard/admin',
                    children: [
                        { title: 'Users', icon: 'mdi-account-multiple-outline', to: '/dashboard/admin/users' },
                        { title: 'Channels', icon: 'mdi-forum-outline', to: '/dashboard/admin/channels' },
                        { title: 'Agents', icon: 'mdi-robot-outline', to: '/dashboard/admin/agents' },
                        { title: 'MCP Tools', icon: 'mdi-tools', to: '/dashboard/admin/mcptools' },
                        { title: 'Executions', icon: 'mdi-play-circle-outline', to: '/dashboard/admin/executions' },
                        { title: 'Tasks', icon: 'mdi-chart-timeline-variant', to: '/dashboard/admin/tasks' },
                        { title: 'Audit Logs', icon: 'mdi-shield-search', to: '/dashboard/admin/auditlogs' },
                        { title: 'Security', icon: 'mdi-security', to: '/dashboard/admin/security' },
                        { title: 'System', icon: 'mdi-monitor-dashboard', to: '/dashboard/admin/system' },
                        { title: 'Config', icon: 'mdi-cog-outline', to: '/dashboard/admin/config' },
                        { title: 'Webhooks', icon: 'mdi-webhook', to: '/dashboard/admin/webhooks' },
                        { title: 'Knowledge Graph', icon: 'mdi-graph', to: '/dashboard/admin/knowledge-graph' },
                        { title: 'Task DAG', icon: 'mdi-source-branch', to: '/dashboard/admin/task-dag' },
                        { title: 'Memory Browser', icon: 'mdi-brain', to: '/dashboard/admin/memory-browser' },
                        { title: 'Control Loop', icon: 'mdi-sync', to: '/dashboard/admin/control-loop' }
                    ]
                }
            ]
        });
    }

    return sections;
});

// Computed
const currentUser = computed(() => authStore.user);

// Breadcrumb generation
const breadcrumbs = computed(() => {
    const pathSegments = route.path.split('/').filter(Boolean);
    const crumbs: { title: string; to?: string; disabled?: boolean }[] = [];

    // Always start with Dashboard
    if (pathSegments[0] === 'dashboard') {
        crumbs.push({ title: 'Dashboard', to: '/dashboard' });

        // Add additional segments
        for (let i = 1; i < pathSegments.length; i++) {
            const segment = pathSegments[i];
            const path = '/' + pathSegments.slice(0, i + 1).join('/');
            const title = segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');

            crumbs.push({
                title,
                to: i === pathSegments.length - 1 ? undefined : path,
                disabled: i === pathSegments.length - 1
            });
        }
    }

    return crumbs;
});

// Page title from route
const pageTitle = computed(() => {
    return route.meta.title as string || route.name as string || 'Dashboard';
});

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

const getItemIcon = (item: any): string => {
    return isActive(item) ? (item.activeIcon || item.icon) : item.icon;
};

// Toggle rail mode
const toggleRailMode = () => {
    railMode.value = !railMode.value;
};

// Watch for mobile breakpoint to auto-close drawer
watch(() => window.innerWidth, (width) => {
    if (width < 1024) {
        railMode.value = false;
    }
});
</script>

<template>
    <v-app>
        <!-- Navigation Drawer -->
        <v-navigation-drawer
            v-model="drawer"
            app
            permanent
            :rail="railMode"
            :width="280"
            class="neural-nav"
        >
            <!-- Logo Section -->
            <div class="nav-header">
                <div class="logo-container" :class="{ 'rail-mode': railMode }">
                    <!-- MXF Logo -->
                    <div class="logo-icon">
                        <img src="/logo.png" alt="MXF" width="40" height="40" />
                    </div>
                    <transition name="fade">
                        <div v-if="!railMode" class="logo-text">
                            <h1 class="logo-title">MXF</h1>
                            <p class="logo-subtitle">Workbench</p>
                        </div>
                    </transition>
                </div>

                <!-- Rail toggle button -->
                <v-btn
                    icon
                    variant="text"
                    size="small"
                    class="rail-toggle"
                    :class="{ 'rail-mode': railMode }"
                    @click="toggleRailMode"
                >
                    <v-icon>{{ railMode ? 'mdi-chevron-right' : 'mdi-chevron-left' }}</v-icon>
                </v-btn>
            </div>

            <v-divider class="my-2" />

            <!-- Navigation Sections -->
            <div class="nav-content">
                <template v-for="section in navigationSections" :key="section.label">
                    <!-- Section Label -->
                    <div v-if="!railMode" class="nav-section-label">
                        {{ section.label }}
                    </div>
                    <v-divider v-else class="my-1 mx-3" />

                    <!-- Navigation Items -->
                    <v-list nav density="compact" class="py-1">
                        <template v-for="item in section.items" :key="item.title">
                            <!-- Item with children (expandable) -->
                            <v-list-group v-if="item.children && !railMode" :value="item.title">
                                <template #activator="{ props }">
                                    <v-list-item
                                        v-bind="props"
                                        :prepend-icon="getItemIcon(item)"
                                        :title="item.title"
                                        :active="isActive(item)"
                                        class="nav-item"
                                    />
                                </template>

                                <v-list-item
                                    v-for="child in item.children"
                                    :key="child.title"
                                    :to="child.to"
                                    :prepend-icon="child.icon"
                                    :title="child.title"
                                    class="nav-item nav-item--child"
                                />
                            </v-list-group>

                            <!-- Regular item or rail mode item -->
                            <v-list-item
                                v-else
                                :to="item.to"
                                :prepend-icon="getItemIcon(item)"
                                :title="railMode ? '' : item.title"
                                :active="isActive(item)"
                                class="nav-item"
                            >
                                <v-tooltip v-if="railMode" activator="parent" location="end">
                                    {{ item.title }}
                                </v-tooltip>
                            </v-list-item>
                        </template>
                    </v-list>
                </template>
            </div>

            <template #append>
                <!-- User Section -->
                <div class="nav-footer">
                    <v-divider class="mb-3" />

                    <div class="user-section" :class="{ 'rail-mode': railMode }">
                        <v-avatar
                            :size="railMode ? 32 : 40"
                            color="primary"
                            class="user-avatar"
                        >
                            <span class="text-body-2 font-weight-medium">
                                {{ currentUser?.firstName?.charAt(0) }}{{ currentUser?.lastName?.charAt(0) }}
                            </span>
                        </v-avatar>

                        <transition name="fade">
                            <div v-if="!railMode" class="user-info">
                                <p class="user-name">
                                    {{ currentUser?.firstName }} {{ currentUser?.lastName }}
                                </p>
                                <p class="user-email">
                                    {{ currentUser?.email }}
                                </p>
                            </div>
                        </transition>

                        <v-tooltip v-if="railMode" activator="parent" location="end">
                            {{ currentUser?.firstName }} {{ currentUser?.lastName }}
                        </v-tooltip>
                    </div>

                    <div class="nav-actions" :class="{ 'rail-mode': railMode }">
                        <v-btn
                            v-if="!railMode"
                            variant="outlined"
                            color="error"
                            size="small"
                            block
                            prepend-icon="mdi-logout"
                            @click="handleLogout"
                        >
                            Sign Out
                        </v-btn>
                        <v-btn
                            v-else
                            icon
                            variant="text"
                            color="error"
                            size="small"
                            @click="handleLogout"
                        >
                            <v-icon>mdi-logout</v-icon>
                            <v-tooltip activator="parent" location="end">Sign Out</v-tooltip>
                        </v-btn>
                    </div>
                </div>
            </template>
        </v-navigation-drawer>

        <!-- App Bar - Compact design -->
        <v-app-bar
            app
            flat
            height="48"
            class="neural-appbar"
        >
            <!-- Mobile menu toggle -->
            <v-app-bar-nav-icon
                class="d-lg-none"
                size="small"
                @click="drawer = !drawer"
            />

            <!-- Breadcrumbs - Compact -->
            <v-breadcrumbs :items="breadcrumbs" class="breadcrumbs px-3" density="compact">
                <template #divider>
                    <v-icon icon="mdi-chevron-right" size="x-small" />
                </template>
                <template #title="{ item }">
                    <span :class="{ 'text-primary': !item.disabled }">{{ item.title }}</span>
                </template>
            </v-breadcrumbs>

            <v-spacer />

            <!-- Header Actions - Compact -->
            <div class="header-actions">
                <!-- Search trigger -->
                <v-btn icon variant="text" size="small" class="header-action" @click="openSearch">
                    <v-icon size="20">mdi-magnify</v-icon>
                    <v-tooltip activator="parent" location="bottom">
                        Search (Ctrl+K)
                    </v-tooltip>
                </v-btn>

                <!-- Notifications with proper activator slot -->
                <v-menu v-model="showNotifications" :close-on-content-click="false" location="bottom end">
                    <template #activator="{ props: menuProps }">
                        <v-btn icon variant="text" size="small" class="header-action" v-bind="menuProps">
                            <v-badge
                                v-if="unreadNotifications > 0"
                                :content="unreadNotifications > 99 ? '99+' : unreadNotifications"
                                color="error"
                                overlap
                            >
                                <v-icon size="20">mdi-bell-outline</v-icon>
                            </v-badge>
                            <v-icon v-else size="20">mdi-bell-outline</v-icon>
                            <v-tooltip activator="parent" location="bottom">
                                Notifications
                            </v-tooltip>
                        </v-btn>
                    </template>
                    <v-card min-width="360" max-width="400" class="notifications-panel">
                        <v-card-title class="d-flex align-center justify-space-between py-2">
                            <span class="text-body-1 font-weight-medium">Notifications</span>
                            <v-btn
                                v-if="notifications.length > 0"
                                variant="text"
                                size="small"
                                @click="markAllRead"
                            >
                                Mark all read
                            </v-btn>
                        </v-card-title>
                        <v-divider />
                        <v-list v-if="notifications.length > 0" class="notifications-list" density="compact" max-height="400">
                            <v-list-item
                                v-for="notification in notifications"
                                :key="notification.id"
                                :class="{ 'unread': !notification.read }"
                                @click="handleNotificationClick(notification)"
                            >
                                <template #prepend>
                                    <v-icon :color="notification.color || 'primary'" size="small">
                                        {{ notification.icon || 'mdi-bell' }}
                                    </v-icon>
                                </template>
                                <v-list-item-title class="text-body-2">{{ notification.title }}</v-list-item-title>
                                <v-list-item-subtitle class="text-caption">{{ notification.message }}</v-list-item-subtitle>
                                <template #append>
                                    <span class="text-caption text-medium-emphasis">{{ formatNotificationTime(notification.timestamp) }}</span>
                                </template>
                            </v-list-item>
                        </v-list>
                        <div v-else class="pa-6 text-center">
                            <v-icon size="48" color="grey-darken-2" class="mb-2">mdi-bell-off-outline</v-icon>
                            <p class="text-body-2 text-medium-emphasis">No notifications yet</p>
                        </div>
                    </v-card>
                </v-menu>

                <!-- Theme toggle -->
                <v-btn
                    icon
                    variant="text"
                    size="small"
                    class="header-action theme-toggle"
                    @click="toggleTheme"
                >
                    <v-icon size="20">{{ isDarkTheme ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
                    <v-tooltip activator="parent" location="bottom">
                        {{ isDarkTheme ? 'Light Mode' : 'Dark Mode' }}
                    </v-tooltip>
                </v-btn>
            </div>
        </v-app-bar>

        <!-- Search Dialog -->
        <v-dialog v-model="showSearch" max-width="600" content-class="search-dialog">
            <v-card class="search-card">
                <v-text-field
                    v-model="searchQuery"
                    ref="searchInput"
                    placeholder="Search channels, agents, tasks..."
                    prepend-inner-icon="mdi-magnify"
                    variant="solo"
                    density="comfortable"
                    hide-details
                    autofocus
                    @keydown.esc="showSearch = false"
                    @keydown.enter="executeSearch"
                />
                <v-divider v-if="searchResults.length > 0 || searchQuery" />
                <v-list v-if="searchResults.length > 0" class="search-results" density="compact">
                    <v-list-item
                        v-for="result in searchResults"
                        :key="result.id"
                        :prepend-icon="result.icon"
                        :title="result.title"
                        :subtitle="result.subtitle"
                        @click="navigateToResult(result)"
                    >
                        <template #append>
                            <v-chip size="x-small" variant="tonal">{{ result.type }}</v-chip>
                        </template>
                    </v-list-item>
                </v-list>
                <div v-else-if="searchQuery && !searchLoading" class="pa-4 text-center text-medium-emphasis">
                    No results found for "{{ searchQuery }}"
                </div>
                <div v-else-if="searchLoading" class="pa-4 text-center">
                    <v-progress-circular indeterminate size="24" />
                </div>
                <div v-else class="pa-4 text-center text-medium-emphasis text-body-2">
                    Type to search across channels, agents, and tasks
                </div>
            </v-card>
        </v-dialog>

        <!-- Main Content -->
        <v-main class="neural-main">
            <div class="main-content">
                <router-view v-slot="{ Component }">
                    <transition name="page" mode="out-in">
                        <component :is="Component" :key="$route.path" />
                    </transition>
                </router-view>
            </div>
        </v-main>
    </v-app>
</template>

<style scoped>
/* Neural Navigation Drawer */
.neural-nav {
    background: var(--bg-void) !important;
    border-right: 1px solid var(--border-subtle) !important;
}

.nav-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4);
    min-height: 72px;
}

.logo-container {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    overflow: hidden;
}

.logo-container.rail-mode {
    justify-content: center;
}

.logo-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
}

.logo-text {
    overflow: hidden;
    white-space: nowrap;
}

.logo-title {
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.2;
    letter-spacing: -0.02em;
}

.logo-subtitle {
    font-size: var(--text-xs);
    color: var(--text-muted);
    letter-spacing: 0.02em;
}

.rail-toggle {
    opacity: 0.6;
    transition: opacity var(--transition-base);
}

.rail-toggle:hover {
    opacity: 1;
}

.rail-toggle.rail-mode {
    position: absolute;
    right: 8px;
}

/* Navigation Content */
.nav-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--space-2) 0;
}

.nav-section-label {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    padding: var(--space-4) var(--space-4) var(--space-2);
}

/* Navigation Items */
.nav-item {
    margin: var(--space-1) var(--space-2) !important;
    border-radius: var(--radius-md) !important;
    transition: all var(--transition-base) !important;
}

.nav-item:hover {
    background: var(--bg-hover) !important;
}

.nav-item.v-list-item--active {
    background: linear-gradient(135deg, rgba(74, 144, 194, 0.15) 0%, rgba(74, 144, 194, 0.05) 100%) !important;
    position: relative;
}

.nav-item.v-list-item--active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 60%;
    background: var(--primary-500);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    box-shadow: var(--glow-primary);
}

.nav-item--child {
    padding-left: var(--space-8) !important;
}

/* ── Rail Mode Overrides ── */
.neural-nav.v-navigation-drawer--rail .nav-item {
    margin: 2px 4px !important;
    min-height: 40px !important;
    border-radius: var(--radius-md) !important;
}

.neural-nav.v-navigation-drawer--rail .nav-item.v-list-item--active {
    background: rgba(74, 144, 194, 0.12) !important;
}

.neural-nav.v-navigation-drawer--rail .nav-item.v-list-item--active::before {
    /* Bottom accent bar instead of left bar in rail mode */
    left: 50%;
    top: auto;
    bottom: 2px;
    transform: translateX(-50%);
    width: 16px;
    height: 2px;
    border-radius: var(--radius-sm);
}

.neural-nav.v-navigation-drawer--rail .nav-content .v-divider {
    margin: 4px 10px !important;
    opacity: 0.3;
}

.neural-nav.v-navigation-drawer--rail .nav-footer {
    padding: var(--space-2) var(--space-1) var(--space-3);
}

/* User Section */
.nav-footer {
    padding: var(--space-3) var(--space-3) var(--space-4);
    background: var(--bg-void);
}

.user-section {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2);
    margin-bottom: var(--space-3);
    border-radius: var(--radius-md);
    transition: all var(--transition-base);
}

.user-section:hover {
    background: var(--bg-hover);
}

.user-section.rail-mode {
    justify-content: center;
    padding: var(--space-2) 0;
}

.user-avatar {
    flex-shrink: 0;
    background: linear-gradient(135deg, var(--primary-500) 0%, var(--primary-600) 100%) !important;
}

.user-info {
    overflow: hidden;
    min-width: 0;
}

.user-name {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin: 0;
}

.user-email {
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin: 0;
}

.nav-actions {
    padding: 0 var(--space-1);
}

.nav-actions.rail-mode {
    display: flex;
    justify-content: center;
}

/* App Bar - Compact */
.neural-appbar {
    background: var(--bg-deep) !important;
    border-bottom: 1px solid var(--border-subtle) !important;
}

.breadcrumbs {
    font-size: var(--text-xs);
}

.breadcrumbs :deep(.v-breadcrumbs-item) {
    color: var(--text-muted);
    padding: 0 4px;
}

.breadcrumbs :deep(.v-breadcrumbs-item--disabled) {
    color: var(--text-primary);
    font-weight: 500;
}

.breadcrumbs :deep(.v-breadcrumbs-divider) {
    padding: 0 2px;
}

.header-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-right: var(--space-2);
}

.header-action {
    color: var(--text-secondary) !important;
    transition: all var(--transition-base) !important;
}

.header-action:hover {
    color: var(--text-primary) !important;
    background: var(--bg-hover) !important;
}

.theme-toggle:hover {
    color: var(--accent-500) !important;
}

/* Search Dialog */
.search-dialog {
    margin-top: 80px;
    align-self: flex-start;
}

.search-card {
    background: var(--bg-surface) !important;
    border: 1px solid var(--border-subtle) !important;
}

.search-results {
    max-height: 400px;
    overflow-y: auto;
}

/* Notifications Panel */
.notifications-panel {
    background: var(--bg-surface) !important;
    border: 1px solid var(--border-subtle) !important;
}

.notifications-list {
    overflow-y: auto;
}

.notifications-list .v-list-item.unread {
    background: rgba(var(--v-theme-primary), 0.08);
}

/* Main Content */
.neural-main {
    background: var(--bg-deep) !important;
}

.main-content {
    padding: var(--space-5);
    min-height: calc(100vh - 48px);
}

/* Fade transition for rail mode elements */
.fade-enter-active,
.fade-leave-active {
    transition: opacity var(--transition-fast);
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}

/* Page transition */
.page-enter-active,
.page-leave-active {
    transition: opacity var(--transition-base), transform var(--transition-base);
}

.page-enter-from {
    opacity: 0;
    transform: translateY(10px);
}

.page-leave-to {
    opacity: 0;
    transform: translateY(-10px);
}

/* Responsive */
@media (max-width: 1024px) {
    .main-content {
        padding: var(--space-4);
    }
}

@media (max-width: 600px) {
    .main-content {
        padding: var(--space-3);
    }

    .header-actions {
        gap: 0;
    }
}
</style>
