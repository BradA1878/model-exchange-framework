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
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * Browser Pool Management for efficient puppeteer instance handling
 * Adapted from MCP-WWW server for internal MXF use
 */

import puppeteer, { Browser, Page } from 'puppeteer';

export interface BrowserInstance {
    browser: Browser;
    createdAt: number;
    lastUsed: number;
    requestCount: number;
    isIdle: boolean;
}

export interface BrowserConfig {
    browserPoolSize?: number;
    idleTimeout?: number;
    headless?: boolean;
    userAgent?: string;
}

export class BrowserManager {
    private pools: Map<string, BrowserInstance[]> = new Map();
    private maxPoolSize: number;
    private idleTimeout: number;
    private config: BrowserConfig;
    private cleanupInterval: NodeJS.Timer;
    private logger: any;

    constructor(config: BrowserConfig = {}, logger?: any) {
        this.config = config;
        this.logger = logger;
        this.maxPoolSize = config.browserPoolSize || 3;
        this.idleTimeout = config.idleTimeout || 300000; // 5 minutes
        
        // Initialize pools
        this.pools.set('default', []);
        
        // Start cleanup interval
        this.cleanupInterval = setInterval(() => {
            this.cleanupIdleBrowsers();
        }, 60000); // Check every minute
    }

    async getBrowser(poolName: string = 'default'): Promise<BrowserInstance> {
        let pool = this.pools.get(poolName);
        if (!pool) {
            pool = [];
            this.pools.set(poolName, pool);
        }

        // Try to find an available browser in the pool
        const availableBrowser = pool.find(instance => {
            const timeSinceLastUse = Date.now() - instance.lastUsed;
            return timeSinceLastUse > 1000; // Allow reuse after 1 second
        });

        if (availableBrowser) {
            availableBrowser.lastUsed = Date.now();
            availableBrowser.requestCount++;
            this.logger?.debug('Reusing browser from pool', { 
                poolName, 
                requestCount: availableBrowser.requestCount 
            });
            return availableBrowser;
        }

        // Create new browser if pool isn't full
        if (pool.length < this.maxPoolSize) {
            const newBrowser = await this.createBrowser();
            pool.push(newBrowser);
            this.logger?.debug('Created new browser', { 
                poolName, 
                poolSize: pool.length 
            });
            return newBrowser;
        }

        // Wait for an available browser
        this.logger?.debug('Pool full, waiting for available browser', { poolName });
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                const available = pool.find(instance => {
                    const timeSinceLastUse = Date.now() - instance.lastUsed;
                    return timeSinceLastUse > 1000;
                });
                
                if (available) {
                    clearInterval(checkInterval);
                    available.lastUsed = Date.now();
                    available.requestCount++;
                    resolve(available);
                }
            }, 100);
        });
    }

    async recycleBrowser(browserInstance: BrowserInstance): Promise<void> {
        browserInstance.isIdle = true;
        browserInstance.lastUsed = Date.now();
        
        // Close any pages that might be open
        const pages = await browserInstance.browser.pages();
        for (const page of pages) {
            if (!page.isClosed()) {
                await page.close();
            }
        }
        
        this.logger?.debug('Browser recycled', { 
            requestCount: browserInstance.requestCount 
        });
    }

    private async createBrowser(): Promise<BrowserInstance> {
        const browser = await puppeteer.launch({
            headless: this.config.headless ?? true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-features=TranslateUI',
                '--disable-ipc-flooding-protection',
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-default-apps',
                '--disable-extensions'
            ]
        });

        const instance: BrowserInstance = {
            browser,
            createdAt: Date.now(),
            lastUsed: Date.now(),
            requestCount: 1,
            isIdle: false
        };

        // Set default user agent if provided
        if (this.config.userAgent) {
            const pages = await browser.pages();
            if (pages.length > 0) {
                await pages[0].setUserAgent(this.config.userAgent);
            }
        }

        return instance;
    }

    private async cleanupIdleBrowsers(): Promise<void> {
        const now = Date.now();
        
        for (const [poolName, pool] of this.pools.entries()) {
            const indicesToRemove: number[] = [];
            
            for (let i = 0; i < pool.length; i++) {
                const instance = pool[i];
                const timeSinceLastUse = now - instance.lastUsed;
                
                if (timeSinceLastUse > this.idleTimeout) {
                    try {
                        await instance.browser.close();
                        indicesToRemove.push(i);
                        this.logger?.debug('Closed idle browser', { 
                            poolName, 
                            timeSinceLastUse: Math.round(timeSinceLastUse / 1000) + 's'
                        });
                    } catch (error) {
                        this.logger?.warn('Error closing idle browser', { error });
                    }
                }
            }
            
            // Remove closed browsers from pool (in reverse order to maintain indices)
            for (let i = indicesToRemove.length - 1; i >= 0; i--) {
                pool.splice(indicesToRemove[i], 1);
            }
        }
    }

    async getStats(): Promise<Record<string, any>> {
        const stats: Record<string, any> = {};
        
        for (const [poolName, pool] of this.pools.entries()) {
            const now = Date.now();
            stats[poolName] = {
                totalBrowsers: pool.length,
                idleBrowsers: pool.filter(instance => instance.isIdle).length,
                activeBrowsers: pool.filter(instance => !instance.isIdle).length,
                avgRequestCount: pool.length > 0 ? 
                    Math.round(pool.reduce((sum, instance) => sum + instance.requestCount, 0) / pool.length) : 0,
                avgAge: pool.length > 0 ? 
                    Math.round(pool.reduce((sum, instance) => sum + (now - instance.createdAt), 0) / pool.length / 1000) : 0
            };
        }
        
        return stats;
    }

    async cleanup(): Promise<void> {
        this.logger?.info('Cleaning up browser pools...');
        
        // Clear cleanup interval
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval as any);
        }
        
        // Close all browsers
        const closePromises: Promise<void>[] = [];
        
        for (const [poolName, pool] of this.pools.entries()) {
            for (const instance of pool) {
                closePromises.push(
                    instance.browser.close().catch(error => {
                        this.logger?.warn('Error closing browser during cleanup', { error });
                    })
                );
            }
            pool.length = 0; // Clear the pool
        }
        
        await Promise.all(closePromises);
        this.logger?.info('Browser cleanup completed');
    }
}