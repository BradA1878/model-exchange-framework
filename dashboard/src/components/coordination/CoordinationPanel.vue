<template>
  <v-card>
    <v-card-title class="d-flex align-center">
      <v-icon icon="mdi-handshake" class="mr-2" />
      <span>Agent Coordination</span>
      <v-spacer />
      <v-chip size="small" color="primary" variant="outlined">
        {{ activeCoordinations.length }} Active
      </v-chip>
    </v-card-title>

    <v-tabs v-model="tab" density="compact">
      <v-tab value="active">Active</v-tab>
      <v-tab value="requests">Requests</v-tab>
      <v-tab value="history">History</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <!-- Active Coordinations -->
      <v-window-item value="active">
        <v-card-text>
          <v-list v-if="activeCoordinations.length > 0" density="compact">
            <v-list-item
              v-for="coord in activeCoordinations"
              :key="coord.coordinationId"
              class="px-0"
            >
              <v-list-item-title class="d-flex align-center">
                <v-chip 
                  :color="getCoordinationTypeColor(coord.type)" 
                  size="x-small" 
                  label
                  class="mr-2"
                >
                  {{ coord.type }}
                </v-chip>
                <span class="text-caption">{{ coord.taskDescription }}</span>
              </v-list-item-title>
              
              <v-list-item-subtitle>
                <div class="d-flex align-center mt-1">
                  <v-icon icon="mdi-account" size="x-small" class="mr-1" />
                  <span class="text-caption mr-3">{{ coord.requestingAgent }}</span>
                  <v-icon icon="mdi-account-multiple" size="x-small" class="mr-1" />
                  <span class="text-caption">{{ coord.acceptedAgents.length }} agents</span>
                </div>
                <v-progress-linear
                  v-if="coord.progress?.percentage"
                  :model-value="coord.progress.percentage"
                  height="4"
                  class="mt-2"
                  :color="getCoordinationTypeColor(coord.type)"
                />
              </v-list-item-subtitle>

              <template #append>
                <v-btn
                  icon="mdi-information-outline"
                  size="x-small"
                  variant="text"
                  @click="showDetails(coord)"
                />
              </template>
            </v-list-item>
          </v-list>
          
          <v-empty-state
            v-else
            icon="mdi-handshake"
            title="No Active Coordinations"
            text="No coordinations are currently in progress"
          />
        </v-card-text>
      </v-window-item>

      <!-- Coordination Requests -->
      <v-window-item value="requests">
        <v-card-text>
          <v-list v-if="requestedCoordinations.length > 0" density="compact">
            <v-list-item
              v-for="coord in requestedCoordinations"
              :key="coord.coordinationId"
              class="px-0"
            >
              <v-list-item-title class="d-flex align-center">
                <v-chip 
                  :color="getCoordinationTypeColor(coord.type)" 
                  size="x-small" 
                  label
                  class="mr-2"
                >
                  {{ coord.type }}
                </v-chip>
                <span class="text-caption">{{ coord.taskDescription }}</span>
              </v-list-item-title>
              
              <v-list-item-subtitle>
                <div class="d-flex align-center mt-1">
                  <v-icon icon="mdi-account" size="x-small" class="mr-1" />
                  <span class="text-caption mr-3">{{ coord.requestingAgent }}</span>
                  <v-icon icon="mdi-clock-outline" size="x-small" class="mr-1" />
                  <span class="text-caption">{{ formatTime(coord.createdAt) }}</span>
                </div>
              </v-list-item-subtitle>

              <template #append>
                <v-btn-group density="compact" variant="text">
                  <v-btn
                    icon="mdi-check"
                    size="x-small"
                    color="success"
                    @click="acceptCoordination(coord)"
                  />
                  <v-btn
                    icon="mdi-close"
                    size="x-small"
                    color="error"
                    @click="rejectCoordination(coord)"
                  />
                </v-btn-group>
              </template>
            </v-list-item>
          </v-list>
          
          <v-empty-state
            v-else
            icon="mdi-inbox"
            title="No Pending Requests"
            text="No coordination requests waiting for response"
          />
        </v-card-text>
      </v-window-item>

      <!-- Coordination History -->
      <v-window-item value="history">
        <v-card-text>
          <v-list v-if="completedCoordinations.length > 0" density="compact">
            <v-list-item
              v-for="coord in completedCoordinations"
              :key="coord.coordinationId"
              class="px-0"
            >
              <v-list-item-title class="d-flex align-center">
                <v-chip 
                  :color="getCoordinationTypeColor(coord.type)" 
                  size="x-small" 
                  label
                  class="mr-2"
                >
                  {{ coord.type }}
                </v-chip>
                <span class="text-caption">{{ coord.taskDescription }}</span>
              </v-list-item-title>
              
              <v-list-item-subtitle>
                <div class="d-flex align-center mt-1">
                  <v-icon 
                    :icon="coord.results?.success ? 'mdi-check-circle' : 'mdi-alert-circle'" 
                    :color="coord.results?.success ? 'success' : 'error'"
                    size="x-small" 
                    class="mr-1" 
                  />
                  <span class="text-caption mr-3">
                    {{ coord.results?.success ? 'Completed' : 'Failed' }}
                  </span>
                  <v-icon icon="mdi-clock-outline" size="x-small" class="mr-1" />
                  <span class="text-caption">{{ formatTime(coord.completedAt) }}</span>
                </div>
              </v-list-item-subtitle>

              <template #append>
                <v-btn
                  icon="mdi-information-outline"
                  size="x-small"
                  variant="text"
                  @click="showDetails(coord)"
                />
              </template>
            </v-list-item>
          </v-list>
          
          <v-empty-state
            v-else
            icon="mdi-history"
            title="No History"
            text="No completed coordinations to display"
          />
        </v-card-text>
      </v-window-item>
    </v-window>

    <!-- Coordination Details Dialog -->
    <v-dialog v-model="detailsDialog" max-width="600">
      <v-card v-if="selectedCoordination">
        <v-card-title>
          Coordination Details
          <v-chip 
            :color="getCoordinationTypeColor(selectedCoordination.type)" 
            size="small" 
            label
            class="ml-2"
          >
            {{ selectedCoordination.type }}
          </v-chip>
        </v-card-title>
        
        <v-card-text>
          <v-list density="compact">
            <v-list-item>
              <v-list-item-title>Task Description</v-list-item-title>
              <v-list-item-subtitle>{{ selectedCoordination.taskDescription }}</v-list-item-subtitle>
            </v-list-item>
            
            <v-list-item>
              <v-list-item-title>Requesting Agent</v-list-item-title>
              <v-list-item-subtitle>{{ selectedCoordination.requestingAgent }}</v-list-item-subtitle>
            </v-list-item>
            
            <v-list-item>
              <v-list-item-title>Status</v-list-item-title>
              <v-list-item-subtitle>
                <v-chip :color="getStatusColor(selectedCoordination.state)" size="small">
                  {{ selectedCoordination.state }}
                </v-chip>
              </v-list-item-subtitle>
            </v-list-item>
            
            <v-list-item v-if="selectedCoordination.acceptedAgents.length > 0">
              <v-list-item-title>Participating Agents</v-list-item-title>
              <v-list-item-subtitle>
                <v-chip 
                  v-for="agent in selectedCoordination.acceptedAgents" 
                  :key="agent"
                  size="small"
                  class="mr-1 mt-1"
                >
                  {{ agent }}
                </v-chip>
              </v-list-item-subtitle>
            </v-list-item>
            
            <v-list-item v-if="selectedCoordination.requirements">
              <v-list-item-title>Requirements</v-list-item-title>
              <v-list-item-subtitle>
                <pre class="text-caption">{{ JSON.stringify(selectedCoordination.requirements, null, 2) }}</pre>
              </v-list-item-subtitle>
            </v-list-item>
            
            <v-list-item v-if="selectedCoordination.results">
              <v-list-item-title>Results</v-list-item-title>
              <v-list-item-subtitle>
                <pre class="text-caption">{{ JSON.stringify(selectedCoordination.results, null, 2) }}</pre>
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card-text>
        
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="detailsDialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useCoordinationStore } from '@/stores/coordination';

// Props
interface Props {
  agentId?: string;
}

const props = defineProps<Props>();

// Store
const coordinationStore = useCoordinationStore();

// State
const tab = ref('active');
const detailsDialog = ref(false);
const selectedCoordination = ref<any>(null);

// Computed
const activeCoordinations = computed(() => 
  coordinationStore.activeCoordinationsList
);

const requestedCoordinations = computed(() => {
  if (!props.agentId) return coordinationStore.requestedCoordinations;
  
  return coordinationStore.requestedCoordinations.filter(coord =>
    coord.targetAgents.includes(props.agentId) &&
    !coord.acceptedAgents.includes(props.agentId) &&
    !coord.rejectedAgents.some(r => r.agentId === props.agentId)
  );
});

const completedCoordinations = computed(() => 
  coordinationStore.completedCoordinations.slice(0, 10) // Show last 10
);

// Methods
const getCoordinationTypeColor = (type: string): string => {
  const colors: Record<string, string> = {
    collaborate: 'primary',
    delegate: 'secondary',
    review: 'warning',
    assist: 'info',
    parallel: 'success',
    sequential: 'deep-purple'
  };
  return colors[type] || 'grey';
};

const getStatusColor = (state: string): string => {
  const colors: Record<string, string> = {
    requested: 'warning',
    accepted: 'info',
    rejected: 'error',
    in_progress: 'primary',
    completed: 'success',
    cancelled: 'grey'
  };
  return colors[state] || 'grey';
};

const formatTime = (timestamp?: number): string => {
  if (!timestamp) return 'N/A';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
};

const showDetails = (coordination: any) => {
  selectedCoordination.value = coordination;
  detailsDialog.value = true;
};

const acceptCoordination = (coordination: any) => {
  // This would emit an event or call a method to accept the coordination
  console.log('Accept coordination:', coordination.coordinationId);
};

const rejectCoordination = (coordination: any) => {
  // This would emit an event or call a method to reject the coordination
  console.log('Reject coordination:', coordination.coordinationId);
};
</script>