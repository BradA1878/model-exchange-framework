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
 * WebSearchService - Main service for web search, navigation, and content extraction
 * Integrates BrowserManager and ContentProcessor for comprehensive web capabilities
 */

import { BrowserManager, BrowserConfig } from './BrowserManager';
import { ContentProcessor, OptimizationOptions } from './ContentProcessor';
import { Page } from 'puppeteer';

export interface WebSearchArgs {
    query: string;
    maxResults?: number;
    searchEngine?: string;
    extractContent?: boolean;
    format?: string;
}

export interface WebNavigationArgs {
    url: string;
    waitStrategy?: string;
    includeScreenshot?: boolean;
    screenshotFormat?: string;
    extractContent?: boolean;
    format?: string;
}

export interface WebBulkExtractArgs {
    urls: string[];
    concurrency?: number;
    format?: string;
}

export interface WebScreenshotArgs {
    url: string;
    format?: string;
    fullPage?: boolean;
    width?: number;
    height?: number;
}

export interface SearchResult {
    title: string;
    url: string;
    description: string;
    content?: any;
}

export class WebSearchService {
    private browserManager: BrowserManager;
    private contentProcessor: ContentProcessor;
    private logger: any;

    constructor(config: BrowserConfig = {}, logger?: any) {
        this.logger = logger;
        this.browserManager = new BrowserManager(config, logger);
        this.contentProcessor = new ContentProcessor(logger);
    }

    async search(args: WebSearchArgs): Promise<{ results: SearchResult[]; total: number }> {
        try {
            const searchEngine = args.searchEngine || 'google';
            const maxResults = args.maxResults || 10;
            
            // Get browser instance
            const browserInstance = await this.browserManager.getBrowser();
            const browser = browserInstance.browser;
            const page = await browser.newPage();
            
            try {
                // Set user agent
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
                
                // Perform search based on engine
                let results: SearchResult[] = [];
                
                switch (searchEngine) {
                    case 'google':
                        results = await this.searchGoogle(page, args.query, maxResults);
                        break;
                    case 'bing':
                        results = await this.searchBing(page, args.query, maxResults);
                        break;
                    case 'duckduckgo':
                        results = await this.searchDuckDuckGo(page, args.query, maxResults);
                        break;
                    default:
                        throw new Error(`Unsupported search engine: ${searchEngine}`);
                }
                
                // Extract content if requested
                if (args.extractContent) {
                    results = await this.extractContentFromResults(results, args.format || 'structured');
                }
                
                return {
                    results,
                    total: results.length
                };
                
            } finally {
                await page.close();
                await this.browserManager.recycleBrowser(browserInstance);
            }
            
        } catch (error) {
            this.logger?.error('Web search failed', { error, query: args.query });
            throw error;
        }
    }

    async navigate(args: WebNavigationArgs): Promise<any> {
        try {
            const browserInstance = await this.browserManager.getBrowser();
            const browser = browserInstance.browser;
            const page = await browser.newPage();
            
            try {
                // Set viewport if needed
                await page.setViewport({ width: 1280, height: 720 });
                
                // Navigate to URL
                const response = await page.goto(args.url, {
                    waitUntil: (args.waitStrategy === 'networkidle' ? 'networkidle0' : args.waitStrategy || 'networkidle2') as any,
                    timeout: 30000
                });
                
                if (!response) {
                    throw new Error('No response received from page');
                }
                
                if (!response.ok()) {
                    throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
                }
                
                const result: any = {
                    url: args.url,
                    title: await page.title(),
                    status: response.status()
                };
                
                // Extract content if requested
                if (args.extractContent) {
                    const html = await page.content();
                    const processedContent = await this.contentProcessor.processContent(html, args.url, {
                        format: args.format as any || 'structured'
                    });
                    result.content = processedContent;
                }
                
                // Take screenshot if requested
                if (args.includeScreenshot) {
                    const screenshot = await page.screenshot({
                        type: args.screenshotFormat === 'jpeg' ? 'jpeg' : 'png',
                        fullPage: false
                    });
                    result.screenshot = screenshot;
                }
                
                return result;
                
            } finally {
                await page.close();
                await this.browserManager.recycleBrowser(browserInstance);
            }
            
        } catch (error) {
            this.logger?.error('Web navigation failed', { error, url: args.url });
            throw error;
        }
    }

    async bulkExtract(args: WebBulkExtractArgs): Promise<any[]> {
        try {
            const concurrency = Math.min(args.concurrency || 3, 5); // Max 5 concurrent
            const results: any[] = [];
            
            // Process URLs in batches
            for (let i = 0; i < args.urls.length; i += concurrency) {
                const batch = args.urls.slice(i, i + concurrency);
                const batchPromises = batch.map(url => 
                    this.navigate({
                        url,
                        extractContent: true,
                        format: args.format || 'structured'
                    }).catch(error => ({
                        url,
                        error: error.message
                    }))
                );
                
                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);
            }
            
            return results;
            
        } catch (error) {
            this.logger?.error('Bulk extraction failed', { error, urls: args.urls });
            throw error;
        }
    }

    async screenshot(args: WebScreenshotArgs): Promise<Buffer> {
        try {
            const browserInstance = await this.browserManager.getBrowser();
            const browser = browserInstance.browser;
            const page = await browser.newPage();
            
            try {
                // Set viewport
                await page.setViewport({ 
                    width: args.width || 1280, 
                    height: args.height || 720 
                });
                
                // Navigate to URL
                await page.goto(args.url, {
                    waitUntil: 'networkidle2',
                    timeout: 30000
                });
                
                // Take screenshot
                const screenshot = await page.screenshot({
                    type: args.format === 'jpeg' ? 'jpeg' : 'png',
                    fullPage: args.fullPage || false
                });
                
                return screenshot as Buffer;
                
            } finally {
                await page.close();
                await this.browserManager.recycleBrowser(browserInstance);
            }
            
        } catch (error) {
            this.logger?.error('Screenshot failed', { error, url: args.url });
            throw error;
        }
    }

    private async searchGoogle(page: Page, query: string, maxResults: number): Promise<SearchResult[]> {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${maxResults}`;
        
        await page.goto(searchUrl, { waitUntil: 'networkidle2' });
        
        // Extract search results
        const results = await page.evaluate(() => {
            const searchResults: SearchResult[] = [];
            const resultElements = document.querySelectorAll('div.g');
            
            resultElements.forEach(element => {
                const titleElement = element.querySelector('h3');
                const linkElement = element.querySelector('a[href]');
                const descriptionElement = element.querySelector('span[style], div[style]');
                
                if (titleElement && linkElement) {
                    searchResults.push({
                        title: titleElement.textContent || '',
                        url: (linkElement as HTMLAnchorElement).href || '',
                        description: descriptionElement?.textContent || ''
                    });
                }
            });
            
            return searchResults;
        });
        
        return results;
    }

    private async searchBing(page: Page, query: string, maxResults: number): Promise<SearchResult[]> {
        const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
        
        await page.goto(searchUrl, { waitUntil: 'networkidle2' });
        
        // Extract search results
        const results = await page.evaluate(() => {
            const searchResults: SearchResult[] = [];
            const resultElements = document.querySelectorAll('li.b_algo');
            
            resultElements.forEach(element => {
                const titleElement = element.querySelector('h2 a');
                const descriptionElement = element.querySelector('p, .b_caption p');
                
                if (titleElement) {
                    searchResults.push({
                        title: titleElement.textContent || '',
                        url: (titleElement as HTMLAnchorElement).href || '',
                        description: descriptionElement?.textContent || ''
                    });
                }
            });
            
            return searchResults;
        });
        
        return results;
    }

    private async searchDuckDuckGo(page: Page, query: string, maxResults: number): Promise<SearchResult[]> {
        const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
        
        await page.goto(searchUrl, { waitUntil: 'networkidle2' });
        
        // Extract search results
        const results = await page.evaluate(() => {
            const searchResults: SearchResult[] = [];
            const resultElements = document.querySelectorAll('article[data-testid="result"]');
            
            resultElements.forEach(element => {
                const titleElement = element.querySelector('h2 a');
                const descriptionElement = element.querySelector('span[data-result="snippet"]');
                
                if (titleElement) {
                    searchResults.push({
                        title: titleElement.textContent || '',
                        url: (titleElement as HTMLAnchorElement).href || '',
                        description: descriptionElement?.textContent || ''
                    });
                }
            });
            
            return searchResults;
        });
        
        return results;
    }

    private async extractContentFromResults(results: SearchResult[], format: string): Promise<SearchResult[]> {
        const processedResults: SearchResult[] = [];
        
        for (const result of results) {
            try {
                const navigationResult = await this.navigate({
                    url: result.url,
                    extractContent: true,
                    format
                });
                
                processedResults.push({
                    ...result,
                    content: navigationResult.content
                });
                
            } catch (error) {
                this.logger?.warn('Failed to extract content from result', { 
                    url: result.url, 
                    error: error instanceof Error ? error.message : 'Unknown error' 
                });
                
                // Include result without content
                processedResults.push(result);
            }
        }
        
        return processedResults;
    }

    async cleanup(): Promise<void> {
        await this.browserManager.cleanup();
    }
}