/**
 * Copyright 2024 Brad Anderson
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *     http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * 
 * @author Brad Anderson <BradA1878@pm.me>
 */

const chalk = require('chalk');

/**
 * Cinematic story logger for dramatic agent demos
 * Provides colored, formatted output with timestamps and agent styling
 * Separates story narrative from framework logs for immersive experience
 */
export class StoryLogger {
    private static missionStartTime = Date.now();
    private static currentTime = 0;

    // Agent styling configuration with proper indexing
    private static agentStyles: { [key: string]: { emoji: string; color: any } } = {
        'COMMANDER KANE': { emoji: '🎖️', color: chalk.bold.yellow },
        'DR. CHEN': { emoji: '🔬', color: chalk.bold.cyan },
        'LT. RODRIGUEZ': { emoji: '⚔️', color: chalk.bold.red },
        'ENSIGN PARK': { emoji: '📡', color: chalk.bold.green },
        'DR. XENARA': { emoji: '🕰️', color: chalk.bold.magenta },
        'COMMANDER ZENTH': { emoji: '👽', color: chalk.bold.blue }
    };

    /**
     * Log a dramatic scenario header
     */
    static logScenarioStart(title: string): void {
        console.log('\n' + '='.repeat(60));
        console.log(chalk.magenta.bold(`💼 ${title.toUpperCase()} 💼`));
        console.log('='.repeat(60) + '\n');
        this.missionStartTime = Date.now();
        this.currentTime = 0;
    }

    /**
     * Log a major story beat with timestamp
     */
    static logStoryBeat(event: string): void {
        const timestamp = this.formatMissionTime();
        console.log(chalk.white.bold(`[T+${timestamp}] 💼 ${event}`));
    }

    /**
     * Get styled agent name with color and emoji
     */
    static getStyledAgentName(agentName: string): string {
        const style = this.agentStyles[agentName.toUpperCase()] || { emoji: '🤖', color: chalk.white };
        return `${style.emoji} ${style.color(agentName)}`;
    }

    /**
     * Log an agent action with their visual identity
     */
    static logAgentAction(agentName: string, action: string): void {
        const style = this.agentStyles[agentName.toUpperCase()] || { emoji: '🤖', color: chalk.white };
        const styledName = style.color(`[${agentName.toUpperCase()}]`);
        const timestamp = this.getTimestamp();
        console.log(`${timestamp} ${style.emoji} ${styledName} ${action}`);
    }

    /**
     * Log a dramatic moment with special formatting
     */
    static logDramaticMoment(message: string): void {
        console.log('\n' + chalk.magenta.bold('🎬 ' + message.toUpperCase()) + '\n');
    }

    /**
     * Log system/technical updates
     */
    static logSystemUpdate(message: string): void {
        console.log(chalk.gray(`⚙️  ${message}`));
    }

    /**
     * Log coordination between agents
     */
    static logCoordination(message: string): void {
        console.log(chalk.blue.bold(`🔗 ${message}`));
    }

    /**
     * Log the mission status
     */
    static logMissionStatus(status: string): void {
        console.log(chalk.yellow.bold(`📊 MISSION STATUS: ${status}`));
    }

    /**
     * Create a mission control dashboard
     */
    static logDashboard(agentStates: { [key: string]: string }): void {
        console.log('\n┌─────────────────────────────────────────────────────────────┐');
        console.log('│                    🚀 MISSION CONTROL                      │');
        console.log('├─────────────────────────────────────────────────────────────┤');
        
        Object.entries(agentStates).forEach(([agent, state]) => {
            const style = this.agentStyles[agent.toUpperCase()] || { emoji: '🤖', color: chalk.white };
            const emoji = style.emoji;
            const paddedState = state.padEnd(45);
            console.log(`│ ${emoji} ${agent.padEnd(10)}: ${paddedState} │`);
        });
        
        console.log('└─────────────────────────────────────────────────────────────┘\n');
    }

    /**
     * Format elapsed mission time
     */
    private static formatMissionTime(): string {
        this.currentTime += Math.floor(Math.random() * 15) + 5; // Random 5-20 second intervals
        const minutes = Math.floor(this.currentTime / 60);
        const seconds = this.currentTime % 60;
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    /**
     * Get the current timestamp
     */
    private static getTimestamp(): string {
        return new Date().toLocaleTimeString();
    }

    /**
     * Wait for dramatic timing
     */
    static async wait(seconds: number = 2): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }

    /**
     * Clear console for clean story start
     */
    static clearScreen(): void {
        console.clear();
    }
}
