<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useAdminStore } from '../../stores/admin';

const adminStore = useAdminStore();

// Local state
const userRoleDialog = ref(false);
const selectedUser = ref<any>(null);
const newUserRole = ref('');
const roleUpdateLoading = ref(false);

// Snackbar for notifications
const snackbar = ref(false);
const snackbarMessage = ref('');
const snackbarColor = ref('success');

// Computed properties from store
const users = computed(() => adminStore.filteredUsers);
const userStats = computed(() => adminStore.userStats);
const loading = computed(() => adminStore.loading);
const error = computed(() => adminStore.error);
const filters = computed(() => adminStore.filters);

// Role options
const roleOptions = [
    { title: 'Admin', value: 'admin', color: 'error', icon: 'mdi-shield-crown' },
    { title: 'Provider', value: 'provider', color: 'warning', icon: 'mdi-briefcase' },
    { title: 'Consumer', value: 'consumer', color: 'primary', icon: 'mdi-account' }
];

const statusOptions = [
    { title: 'All Status', value: '' },
    { title: 'Active', value: 'active' },
    { title: 'Inactive', value: 'inactive' }
];

const sortOptions = [
    { title: 'Created Date', value: 'createdAt' },
    { title: 'Name', value: 'name' },
    { title: 'Email', value: 'email' },
    { title: 'Role', value: 'role' },
    { title: 'Last Login', value: 'lastLogin' }
];

// Methods
const refreshUsers = async (): Promise<void> => {
    await adminStore.fetchUsers();
};

const openRoleDialog = (user: any): void => {
    selectedUser.value = user;
    newUserRole.value = user.role;
    userRoleDialog.value = true;
};

const updateUserRole = async (): Promise<void> => {
    if (!selectedUser.value || !newUserRole.value) return;

    roleUpdateLoading.value = true;

    try {
        await adminStore.updateUserRole(selectedUser.value.id, newUserRole.value as 'admin' | 'provider' | 'consumer');
        
        snackbarMessage.value = `User role updated to ${newUserRole.value}`;
        snackbarColor.value = 'success';
        snackbar.value = true;
        
        userRoleDialog.value = false;
        selectedUser.value = null;
        newUserRole.value = '';
    } catch (error: any) {
        snackbarMessage.value = error.message || 'Failed to update user role';
        snackbarColor.value = 'error';
        snackbar.value = true;
    } finally {
        roleUpdateLoading.value = false;
    }
};

const cancelRoleDialog = (): void => {
    userRoleDialog.value = false;
    selectedUser.value = null;
    newUserRole.value = '';
};

const updateFilters = (newFilters: any): void => {
    adminStore.setFilters(newFilters);
};

const clearFilters = (): void => {
    adminStore.clearFilters();
};

const formatDate = (dateString: string | Date | undefined): string => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const getRoleColor = (role: string): string => {
    console.log('getRoleColor called with role:', role);
    const roleOption = roleOptions.find(opt => opt.value === role);
    console.log('Found roleOption:', roleOption);
    return roleOption?.color || 'primary';
};

const getRoleIcon = (role: string): string => {
    const roleOption = roleOptions.find(opt => opt.value === role);
    return roleOption?.icon || 'mdi-account';
};

// Watch for errors
watch(error, (newError) => {
    if (newError) {
        snackbarMessage.value = newError;
        snackbarColor.value = 'error';
        snackbar.value = true;
        adminStore.clearError();
    }
});

// Initialize data
onMounted(async () => {
    try {
        // Always refresh users to ensure we have the latest data
        console.log('Users component mounted, fetching users...');
        await refreshUsers();
        console.log('Users loaded:', users.value.length, 'first user role:', users.value[0]?.role);
    } catch (error) {
        console.error('Error initializing users component:', error);
        snackbarMessage.value = 'Failed to load users data';
        snackbarColor.value = 'error';
        snackbar.value = true;
    }
});
</script>

<template>
    <div class="users-admin">
        <!-- Stats Overview -->
        <v-row class="mb-6">
            <v-col cols="12" sm="6" md="3">
                <v-card class="pa-4" elevation="0">
                    <div class="d-flex align-center">
                        <v-icon color="primary" size="40" class="mr-3">mdi-account-group</v-icon>
                        <div>
                            <div class="text-h4">{{ userStats.total }}</div>
                            <div class="text-caption text-medium-emphasis">Total Users</div>
                        </div>
                    </div>
                </v-card>
            </v-col>
            <v-col cols="12" sm="6" md="3">
                <v-card class="pa-4" elevation="0">
                    <div class="d-flex align-center">
                        <v-icon color="success" size="40" class="mr-3">mdi-account-check</v-icon>
                        <div>
                            <div class="text-h4">{{ userStats.active }}</div>
                            <div class="text-caption text-medium-emphasis">Active Users</div>
                        </div>
                    </div>
                </v-card>
            </v-col>
            <v-col cols="12" sm="6" md="3">
                <v-card class="pa-4" elevation="0">
                    <div class="d-flex align-center">
                        <v-icon color="error" size="40" class="mr-3">mdi-shield-crown</v-icon>
                        <div>
                            <div class="text-h4">{{ userStats.admins }}</div>
                            <div class="text-caption text-medium-emphasis">Administrators</div>
                        </div>
                    </div>
                </v-card>
            </v-col>
            <v-col cols="12" sm="6" md="3">
                <v-card class="pa-4" elevation="0">
                    <div class="d-flex align-center">
                        <v-icon color="warning" size="40" class="mr-3">mdi-briefcase</v-icon>
                        <div>
                            <div class="text-h4">{{ userStats.providers }}</div>
                            <div class="text-caption text-medium-emphasis">Providers</div>
                        </div>
                    </div>
                </v-card>
            </v-col>
        </v-row>

        <!-- Users Management Card -->
        <v-card elevation="0">
            <v-card-title>
                <div class="d-flex align-center justify-space-between w-100">
                    <div class="d-flex align-center">
                        <v-icon class="mr-2">mdi-account-multiple</v-icon>
                        User Management
                    </div>
                    <v-btn
                        color="primary"
                        variant="outlined"
                        prepend-icon="mdi-refresh"
                        @click="refreshUsers"
                        :loading="loading"
                    >
                        Refresh
                    </v-btn>
                </div>
            </v-card-title>

            <!-- Filters -->
            <v-card-text>
                <v-row class="mb-4">
                    <v-col cols="12" md="4">
                        <v-text-field
                            :model-value="filters.search"
                            @update:model-value="updateFilters({ search: $event })"
                            label="Search users..."
                            prepend-inner-icon="mdi-magnify"
                            variant="outlined"
                            density="compact"
                            clearable
                        />
                    </v-col>
                    <v-col cols="12" md="2">
                        <v-select
                            :model-value="filters.role"
                            @update:model-value="updateFilters({ role: $event })"
                            :items="[{ title: 'All Roles', value: '' }, ...roleOptions]"
                            label="Role"
                            variant="outlined"
                            density="compact"
                        />
                    </v-col>
                    <v-col cols="12" md="2">
                        <v-select
                            :model-value="filters.status"
                            @update:model-value="updateFilters({ status: $event })"
                            :items="statusOptions"
                            label="Status"
                            variant="outlined"
                            density="compact"
                        />
                    </v-col>
                    <v-col cols="12" md="2">
                        <v-select
                            :model-value="filters.sortBy"
                            @update:model-value="updateFilters({ sortBy: $event })"
                            :items="sortOptions"
                            label="Sort by"
                            variant="outlined"
                            density="compact"
                        />
                    </v-col>
                    <v-col cols="12" md="2">
                        <v-select
                            :model-value="filters.sortOrder"
                            @update:model-value="updateFilters({ sortOrder: $event })"
                            :items="[
                                { title: 'Descending', value: 'desc' },
                                { title: 'Ascending', value: 'asc' }
                            ]"
                            label="Order"
                            variant="outlined"
                            density="compact"
                        />
                    </v-col>
                </v-row>

                <!-- Clear Filters -->
                <div class="d-flex justify-end mb-4">
                    <v-btn
                        variant="text"
                        color="primary"
                        prepend-icon="mdi-filter-off"
                        @click="clearFilters"
                    >
                        Clear Filters
                    </v-btn>
                </div>

                <!-- Users Table -->
                <v-data-table
                    :items="users"
                    :loading="loading"
                    :headers="[
                        { title: 'User', key: 'user', sortable: false },
                        { title: 'Email', key: 'email', sortable: false },
                        { title: 'Role', key: 'role', sortable: false },
                        { title: 'Status', key: 'status', sortable: false },
                        { title: 'Company', key: 'company', sortable: false },
                        { title: 'Last Login', key: 'lastLogin', sortable: false },
                        { title: 'Created', key: 'createdAt', sortable: false },
                        { title: 'Actions', key: 'actions', sortable: false }
                    ]"
                    class="users-table"
                    item-value="id"
                >
                    <!-- User Column -->
                    <template #item.user="{ item }">
                        <div class="d-flex align-center">
                            <v-avatar size="32" color="primary" class="mr-3">
                                <span class="text-body-2">
                                    {{ (item.firstName?.[0] || '') + (item.lastName?.[0] || '') || item.email[0].toUpperCase() }}
                                </span>
                            </v-avatar>
                            <div>
                                <div class="text-body-2">
                                    {{ item.firstName || item.lastName ? `${item.firstName || ''} ${item.lastName || ''}`.trim() : 'No name' }}
                                </div>
                                <div class="text-caption text-medium-emphasis">
                                    ID: {{ item.id ? item.id.substring(0, 8) + '...' : 'N/A' }}
                                </div>
                            </div>
                        </div>
                    </template>

                    <!-- Role Column -->
                    <template #item.role="{ item }">
                        <v-chip
                            :color="getRoleColor(item.role)"
                            size="small"
                            :prepend-icon="getRoleIcon(item.role)"
                        >
                            {{ item.role }}
                        </v-chip>
                    </template>

                    <!-- Status Column -->
                    <template #item.status="{ item }">
                        <v-chip
                            :color="item.isActive ? 'success' : 'error'"
                            size="small"
                            :prepend-icon="item.isActive ? 'mdi-check-circle' : 'mdi-close-circle'"
                        >
                            {{ item.isActive ? 'Active' : 'Inactive' }}
                        </v-chip>
                    </template>

                    <!-- Company Column -->
                    <template #item.company="{ item }">
                        {{ item.company || 'Not specified' }}
                    </template>

                    <!-- Last Login Column -->
                    <template #item.lastLogin="{ item }">
                        {{ formatDate(item.lastLogin) }}
                    </template>

                    <!-- Created Column -->
                    <template #item.createdAt="{ item }">
                        {{ formatDate(item.createdAt) }}
                    </template>

                    <!-- Actions Column -->
                    <template #item.actions="{ item }">
                        <v-btn
                            icon="mdi-account-edit"
                            size="small"
                            variant="text"
                            color="primary"
                            @click="openRoleDialog(item)"
                        />
                    </template>

                    <!-- No data -->
                    <template #no-data>
                        <div class="text-center pa-4">
                            <v-icon size="48" color="grey" class="mb-2">mdi-account-off</v-icon>
                            <p class="text-h6 text-medium-emphasis">No users found</p>
                        </div>
                    </template>
                </v-data-table>
            </v-card-text>
        </v-card>

        <!-- Role Update Dialog -->
        <v-dialog v-model="userRoleDialog" max-width="500">
            <v-card>
                <v-card-title>
                    <div class="d-flex align-center">
                        <v-icon class="mr-2">mdi-account-edit</v-icon>
                        Update User Role
                    </div>
                </v-card-title>

                <v-card-text>
                    <div v-if="selectedUser" class="mb-4">
                        <div class="d-flex align-center mb-3">
                            <v-avatar size="40" color="primary" class="mr-3">
                                <span class="text-body-2">
                                    {{ (selectedUser.firstName?.[0] || '') + (selectedUser.lastName?.[0] || '') || selectedUser.email[0].toUpperCase() }}
                                </span>
                            </v-avatar>
                            <div>
                                <div class="text-body-1">
                                    {{ selectedUser.firstName || selectedUser.lastName ? `${selectedUser.firstName || ''} ${selectedUser.lastName || ''}`.trim() : 'No name' }}
                                </div>
                                <div class="text-caption text-medium-emphasis">
                                    {{ selectedUser.email }}
                                </div>
                            </div>
                        </div>

                        <v-select
                            v-model="newUserRole"
                            :items="roleOptions"
                            label="Select new role"
                            variant="outlined"
                            :disabled="roleUpdateLoading"
                        >
                            <template #item="{ props, item }">
                                <v-list-item v-bind="props">
                                    <template #prepend>
                                        <v-icon :color="item.raw.color">{{ item.raw.icon }}</v-icon>
                                    </template>
                                </v-list-item>
                            </template>
                            <template #selection="{ item }">
                                <div class="d-flex align-center">
                                    <v-icon :color="item.raw.color" class="mr-2">{{ item.raw.icon }}</v-icon>
                                    {{ item.raw.title }}
                                </div>
                            </template>
                        </v-select>
                    </div>
                </v-card-text>

                <v-card-actions>
                    <v-spacer />
                    <v-btn
                        variant="text"
                        @click="cancelRoleDialog"
                        :disabled="roleUpdateLoading"
                    >
                        Cancel
                    </v-btn>
                    <v-btn
                        color="primary"
                        @click="updateUserRole"
                        :loading="roleUpdateLoading"
                        :disabled="!newUserRole || newUserRole === selectedUser?.role"
                    >
                        Update Role
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Snackbar for notifications -->
        <v-snackbar
            v-model="snackbar"
            :color="snackbarColor"
            timeout="3000"
        >
            {{ snackbarMessage }}
        </v-snackbar>
    </div>
</template>

<style scoped>
.users-admin {
    max-width: 100%;
}

.users-table {
    background: var(--v-theme-card-bg);
}

.users-table :deep(.v-data-table__td) {
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
</style>
