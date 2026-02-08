import { defineStore } from 'pinia';
import axios from '../plugins/axios';

interface TaskTypeStats {
  type: string;
  count: number;
  successRate: number;
  avgAutonomy: number;
  avgTime: string;
  commonTools: string[];
}

interface AgentRanking {
  agentId: string;
  name: string;
  tasksCompleted: number;
  successRate: number;
  avgScore: number;
}

interface Recommendation {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  expectedImprovement: number;
}

interface TrendPoint {
  timestamp: number;
  averageScore: number;
  successRate: number;
  avgAutonomy: number;
}

interface EffectivenessSummary {
  totalTasks: number;
  successRate: number;
  avgAutonomy: number;
  avgTimeSaved: number;
  tasksChange: number;
  autonomyTrend: 'improving' | 'stable' | 'declining';
}

interface EffectivenessTrends {
  overall: 'improving' | 'stable' | 'declining';
  dataPoints: TrendPoint[];
  peak: {
    score: number;
    date: number;
  };
}

export const useEffectivenessStore = defineStore('effectiveness', {
  state: () => ({
    summary: null as EffectivenessSummary | null,
    taskTypes: [] as TaskTypeStats[],
    topAgents: [] as AgentRanking[],
    recommendations: [] as Recommendation[],
    trends: null as EffectivenessTrends | null,
    currentTask: null as any,
    isLoading: false,
    error: null as string | null
  }),

  getters: {
    hasData: (state) => state.summary !== null,
    
    highPerformanceTypes: (state) => 
      state.taskTypes.filter(t => t.successRate > 80),
    
    lowPerformanceTypes: (state) =>
      state.taskTypes.filter(t => t.successRate < 50),
    
    averageEffectiveness: (state) => {
      if (!state.summary) return 0;
      return (state.summary.successRate + state.summary.avgAutonomy) / 2;
    }
  },

  actions: {
    async loadAnalytics(channelId?: string, timeRange: string = 'week') {
      this.isLoading = true;
      this.error = null;
      
      try {
        const params: any = { timeRange };
        const endpoint = channelId 
          ? `/api/effectiveness/analytics/${channelId}`
          : '/api/effectiveness/trends';
          
        const response = await axios.get(endpoint, { params });
        const { data } = response.data;
        
        if (channelId && data.analytics) {
          // Process channel-specific analytics
          this.processChannelAnalytics(data);
        } else {
          // Process general trends
          this.processTrendsData(data);
        }
      } catch (error: any) {
        this.error = error.response?.data?.error || 'Failed to load effectiveness analytics';
        console.error('Error loading effectiveness analytics:', error);
      } finally {
        this.isLoading = false;
      }
    },

    async loadTrends(channelId?: string, timeRange: string = 'week') {
      try {
        const params: any = { timeRange, interval: 'day' };
        if (channelId) params.channelId = channelId;
        
        const response = await axios.get(`/api/effectiveness/trends`, { params });
        const { data } = response.data;
        
        this.trends = {
          overall: data.summary.overallTrend,
          dataPoints: data.trends.dataPoints || [],
          peak: data.summary.peakPerformance || { score: 0, date: Date.now() }
        };
      } catch (error: any) {
        console.error('Error loading trends:', error);
      }
    },

    async loadTaskEffectiveness(taskId: string) {
      this.isLoading = true;
      this.error = null;
      
      try {
        const response = await axios.get(`/api/effectiveness/task/${taskId}`);
        const { data } = response.data;
        
        this.currentTask = data;
      } catch (error: any) {
        this.error = error.response?.data?.error || 'Failed to load task effectiveness';
        console.error('Error loading task effectiveness:', error);
      } finally {
        this.isLoading = false;
      }
    },

    async loadAgentEffectiveness(agentId: string, channelId?: string, timeRange: string = 'week') {
      try {
        const params: any = { timeRange };
        if (channelId) params.channelId = channelId;
        
        const response = await axios.get(
          `/api/effectiveness/agent/${agentId}`,
          { params }
        );
        
        const { data } = response.data;
        
        // Update top agents if this agent is high performing
        if (data.summary.averageScore > 0.7) {
          const agentRank: AgentRanking = {
            agentId,
            name: data.agentId,
            tasksCompleted: data.summary.tasksCompleted,
            successRate: Math.round(data.summary.successRate * 100),
            avgScore: Math.round(data.summary.averageScore * 10)
          };
          
          // Insert into rankings
          this.updateAgentRankings(agentRank);
        }
        
        return data;
      } catch (error: any) {
        console.error('Error loading agent effectiveness:', error);
        throw error;
      }
    },

    processChannelAnalytics(data: any) {
      const { analytics, summary } = data;
      
      // Process summary
      this.summary = {
        totalTasks: summary.totalTasks,
        successRate: summary.averageSuccessRate,
        avgAutonomy: summary.averageAutonomy,
        avgTimeSaved: 0, // Calculate from baseline comparisons
        tasksChange: 0, // Calculate from historical data
        autonomyTrend: 'stable' // Determine from trends
      };
      
      // Process task types
      this.taskTypes = Object.entries(analytics.byTaskType || {}).map(([type, stats]: [string, any]) => ({
        type,
        count: stats.count,
        successRate: Math.round(stats.successRate * 100),
        avgAutonomy: Math.round(stats.avgAutonomyScore * 100),
        avgTime: this.formatTime(stats.avgCompletionTime),
        commonTools: stats.commonTools || []
      }));
      
      // Generate recommendations based on patterns
      this.generateRecommendations(analytics.patterns);
    },

    processTrendsData(data: any) {
      if (!data.trends) return;
      
      // Calculate summary from trends
      const recent = data.trends.dataPoints || [];
      if (recent.length > 0) {
        const latest = recent[recent.length - 1];
        this.summary = {
          totalTasks: latest.taskCount || 0,
          successRate: latest.successRate || 0,
          avgAutonomy: latest.avgAutonomy || 0,
          avgTimeSaved: 0,
          tasksChange: this.calculateChange(recent),
          autonomyTrend: this.determineTrend(recent, 'avgAutonomy')
        };
      }
    },

    generateRecommendations(patterns: any) {
      this.recommendations = [];
      
      if (patterns?.lowPerformanceTasks?.length > 0) {
        this.recommendations.push({
          id: 'improve-low-performance',
          title: 'Improve Low-Performance Task Types',
          description: `Focus on improving ${patterns.lowPerformanceTasks.join(', ')} tasks which have success rates below 50%`,
          priority: 'high',
          expectedImprovement: 25
        });
      }
      
      if (this.summary && this.summary.avgAutonomy < 0.5) {
        this.recommendations.push({
          id: 'increase-autonomy',
          title: 'Increase Agent Autonomy',
          description: 'Agents are requiring significant human intervention. Consider enhancing agent training or tool capabilities.',
          priority: 'medium',
          expectedImprovement: 30
        });
      }
      
      // Add more intelligent recommendations based on data patterns
    },

    updateAgentRankings(newAgent: AgentRanking) {
      const existingIndex = this.topAgents.findIndex(a => a.agentId === newAgent.agentId);
      
      if (existingIndex >= 0) {
        this.topAgents[existingIndex] = newAgent;
      } else {
        this.topAgents.push(newAgent);
      }
      
      // Sort by average score and keep top 10
      this.topAgents = this.topAgents
        .sort((a, b) => b.avgScore - a.avgScore)
        .slice(0, 10);
    },

    formatTime(ms: number): string {
      if (!ms) return 'N/A';
      if (ms < 60000) return `${Math.round(ms / 1000)}s`;
      if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
      return `${(ms / 3600000).toFixed(1)}h`;
    },

    calculateChange(dataPoints: any[]): number {
      if (dataPoints.length < 2) return 0;
      
      const firstHalf = dataPoints.slice(0, Math.floor(dataPoints.length / 2));
      const secondHalf = dataPoints.slice(Math.floor(dataPoints.length / 2));
      
      const firstCount = firstHalf.reduce((sum, p) => sum + (p.taskCount || 0), 0);
      const secondCount = secondHalf.reduce((sum, p) => sum + (p.taskCount || 0), 0);
      
      if (firstCount === 0) return 0;
      return Math.round(((secondCount - firstCount) / firstCount) * 100);
    },

    determineTrend(dataPoints: any[], metric: string): 'improving' | 'stable' | 'declining' {
      if (dataPoints.length < 3) return 'stable';
      
      const values = dataPoints.map(p => p[metric] || 0);
      const firstThird = values.slice(0, Math.floor(values.length / 3));
      const lastThird = values.slice(-Math.floor(values.length / 3));
      
      const firstAvg = firstThird.reduce((a, b) => a + b, 0) / firstThird.length;
      const lastAvg = lastThird.reduce((a, b) => a + b, 0) / lastThird.length;
      
      const change = (lastAvg - firstAvg) / firstAvg;
      
      if (change > 0.05) return 'improving';
      if (change < -0.05) return 'declining';
      return 'stable';
    },

    clearError() {
      this.error = null;
    }
  }
});