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
    
    console.log('🧭 Router guard:', {
        from: from.path,
        to: to.path,
        requiresAuth: to.meta.requiresAuth,
        requiresGuest: to.meta.requiresGuest,
        requiresAdmin: to.meta.requiresAdmin,
        isAuthenticated: authStore.isAuthenticated,
        hasUser: !!authStore.user,
        hasToken: !!authStore.token,
        userRole: authStore.user?.role
    });
    
    if (to.meta.requiresAuth && !authStore.isAuthenticated) {
        console.log('🧭 Redirecting to login - auth required but not authenticated');
        next('/login');
    } else if (to.meta.requiresGuest && authStore.isAuthenticated) {
        console.log('🧭 Redirecting to dashboard - guest route but authenticated');
        next('/dashboard');
    } else if (to.meta.requiresAdmin) {
        if (!authStore.isAuthenticated) {
            console.log('🧭 Redirecting to login - admin access required but not authenticated');
            next('/login');
        } else if (authStore.user?.role !== 'admin') {
            console.log('🧭 Redirecting to dashboard - admin access required but user is not admin', { userRole: authStore.user?.role });
            next('/dashboard');
        } else {
            console.log('🧭 Allowing admin navigation');
            next();
        }
    } else {
        console.log('🧭 Allowing navigation');
        next();
    }
});

export default router;
