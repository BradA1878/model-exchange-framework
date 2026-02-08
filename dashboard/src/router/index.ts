import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {
            path: '/',
            redirect: '/login'
        },
        {
            path: '/login',
            name: 'Login',
            component: () => import('../views/Login.vue'),
            meta: { requiresGuest: true }
        },
        {
            path: '/auth/magic-link',
            name: 'MagicLink',
            component: () => import(/* webpackChunkName: "magic-link" */ '../views/MagicLinkHandler.vue')
        },
        {
            path: '/onboarding',
            name: 'Onboarding',
            component: () => import('../views/Onboarding.vue'),
            meta: { requiresAuth: true }
        },
        {
            path: '/dashboard',
            component: () => import('../layouts/DashboardLayout.vue'),
            meta: { requiresAuth: true },
            children: [
                {
                    path: '',
                    name: 'Dashboard',
                    component: () => import('../views/Dashboard.vue')
                },
                {
                    path: 'account',
                    name: 'Account',
                    component: () => import('../views/Account.vue')
                },
                {
                    path: 'analytics',
                    name: 'Analytics',
                    component: () => import('../views/Analytics.vue'),
                    children: [
                        {
                            path: 'data',
                            name: 'AnalyticsData',
                            component: () => import('../views/analytics/Data.vue')
                        },
                        {
                            path: 'charts',
                            name: 'AnalyticsCharts',
                            component: () => import('../views/analytics/Charts.vue')
                        }
                    ]
                },
                {
                    path: 'channels',
                    name: 'Channels',
                    component: () => import('../views/Channels.vue'),
                    children: [
                        {
                            path: ':channelId',
                            redirect: to => `/dashboard/channels/${to.params.channelId}/memory`
                        },
                        {
                            path: ':channelId/memory',
                            name: 'ChannelMemory',
                            component: () => import('../views/channels/Memory.vue')
                        },
                        {
                            path: ':channelId/context',
                            name: 'ChannelContext',
                            component: () => import('../views/channels/Context.vue')
                        },
                        {
                            path: ':channelId/docs',
                            name: 'ChannelDocs',
                            component: () => import('../views/channels/Docs.vue')
                        },
                        {
                            path: ':channelId/agents',
                            name: 'ChannelAgents',
                            component: () => import('../views/channels/Agents.vue')
                        },
                        {
                            path: ':channelId/tools',
                            name: 'ChannelTools',
                            component: () => import('../views/channels/Tools.vue')
                        },
                        {
                            path: ':channelId/tasks',
                            name: 'ChannelTasks',
                            component: () => import('../views/channels/Tasks.vue')
                        }
                    ]
                },
                {
                    path: 'admin',
                    name: 'Admin',
                    // @ts-ignore
                    component: () => import('../views/Admin.vue'),
                    meta: { requiresAdmin: true },
                    redirect: '/dashboard/admin/users',
                    children: [
                        {
                            path: 'users',
                            name: 'AdminUsers',
                            // @ts-ignore
                            component: () => import('../views/admin/Users.vue')
                        },
                        {
                            path: 'channels',
                            name: 'AdminChannels',
                            // @ts-ignore
                            component: () => import('../views/admin/Channels.vue')
                        },
                        {
                            path: 'agents',
                            name: 'AdminAgents',
                            // @ts-ignore
                            component: () => import('../views/admin/Agents.vue')
                        },
                        {
                            path: 'mcptools',
                            name: 'AdminMCPTools',
                            // @ts-ignore
                            component: () => import('../views/admin/MCPTools.vue')
                        },
                        {
                            path: 'executions',
                            name: 'AdminExecutions',
                            // @ts-ignore
                            component: () => import('../views/admin/Executions.vue')
                        },
                        {
                            path: 'tasks',
                            name: 'AdminTasks',
                            // @ts-ignore
                            component: () => import('../views/admin/Tasks.vue')
                        },
                        {
                            path: 'auditlogs',
                            name: 'AdminAuditLogs',
                            // @ts-ignore
                            component: () => import('../views/admin/AuditLogs.vue')
                        },
                        {
                            path: 'security',
                            name: 'AdminSecurity',
                            // @ts-ignore
                            component: () => import('../views/admin/Security.vue')
                        },
                        {
                            path: 'system',
                            name: 'AdminSystem',
                            // @ts-ignore
                            component: () => import('../views/admin/System.vue')
                        },
                        {
                            path: 'config',
                            name: 'AdminConfig',
                            // @ts-ignore
                            component: () => import('../views/admin/Config.vue')
                        },
                        {
                            path: 'webhooks',
                            name: 'AdminWebhooks',
                            // @ts-ignore
                            component: () => import('../views/admin/Webhooks.vue')
                        },
                        {
                            path: 'knowledge-graph',
                            name: 'AdminKnowledgeGraph',
                            // @ts-ignore
                            component: () => import('../views/admin/KnowledgeGraph.vue')
                        },
                        {
                            path: 'task-dag',
                            name: 'AdminTaskDAG',
                            // @ts-ignore
                            component: () => import('../views/admin/TaskDAG.vue')
                        },
                        {
                            path: 'memory-browser',
                            name: 'AdminMemoryBrowser',
                            // @ts-ignore
                            component: () => import('../views/admin/MemoryBrowser.vue')
                        },
                        {
                            path: 'control-loop',
                            name: 'AdminControlLoop',
                            // @ts-ignore
                            component: () => import('../views/admin/ControlLoop.vue')
                        }
                    ]
                }
            ]
        }
    ]
});

// Navigation guards
router.beforeEach((to, from, next) => {
    const authStore = useAuthStore();

    if (to.meta.requiresAuth && !authStore.isAuthenticated) {
        next('/login');
    } else if (to.meta.requiresGuest && authStore.isAuthenticated) {
        // Authenticated user on guest route: send to onboarding or dashboard
        if (authStore.needsOnboarding) {
            next('/onboarding');
        } else {
            next('/dashboard');
        }
    } else if (authStore.isAuthenticated && authStore.needsOnboarding
               && to.path !== '/onboarding' && to.name !== 'MagicLink') {
        // Authenticated but profile incomplete: force onboarding (except the magic link handler page)
        next('/onboarding');
    } else if (to.meta.requiresAdmin) {
        if (!authStore.isAuthenticated) {
            next('/login');
        } else if (authStore.user?.role !== 'admin') {
            next('/dashboard');
        } else {
            next();
        }
    } else {
        next();
    }
});

export default router;
