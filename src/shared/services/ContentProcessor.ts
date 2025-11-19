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
 * 4-Stage Content Processing Pipeline
 * Stage 1: Sanitization → Stage 2: Extraction → Stage 3: Conversion → Stage 4: Optimization
 * Adapted from MCP-WWW server for internal MXF use
 */

import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { htmlToText } from "html-to-text";

export interface ExtractedContent {
    title: string;
    content: string;
    textContent: string;
    siteName: string;
    byline?: string;
    publishedTime?: string;
    dir?: string;
    lang?: string;
}

export interface ConvertedContent {
    title: string;
    markdown: string;
    plainText: string;
    siteName: string;
    byline?: string;
    publishedTime?: string;
    dir?: string;
    lang?: string;
}

export interface OptimizedContent {
    title: string;
    content: string;
    plainText: string;
    wordCount: number;
    readingTimeMinutes: number;
    structured: StructuredContent;
    siteName: string;
    byline?: string;
    publishedTime?: string;
    dir?: string;
    lang?: string;
}

export interface StructuredContent {
    title: string;
    author?: string;
    publishDate?: string;
    wordCount: number;
    readingTime: number;
    summary: string;
    headings: string[];
    links: Array<{ text: string; url: string }>;
    images: Array<{ alt: string; src: string }>;
    siteName: string;
    language?: string;
}

export interface OptimizationOptions {
    maxLength?: number;
    includeLinks?: boolean;
    includeImages?: boolean;
    format?: 'structured' | 'markdown' | 'plaintext';
}

/**
 * Stage 1: HTML Sanitization with security validation
 */
export class HtmlSanitizer {
    private logger: any;

    constructor(logger?: any) {
        this.logger = logger;
    }

    async sanitizeHtml(html: string, baseUrl: string): Promise<string> {
        try {
            // Create DOM context
            const dom = new JSDOM(html, { url: baseUrl });
            
            // Create DOMPurify instance
            const purify = createDOMPurify(dom.window as any);
            
            // Sanitize with strict profile
            const safeHtml = purify.sanitize(html, {
                USE_PROFILES: { html: true },
                FORBID_TAGS: [
                    'script', 'object', 'embed', 'iframe', 'frame', 'frameset',
                    'applet', 'base', 'link', 'meta', 'style'
                ],
                FORBID_ATTR: [
                    'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus',
                    'onblur', 'onchange', 'onsubmit', 'onreset', 'onselect',
                    'onunload', 'ondragstart', 'ondrag', 'ondragend'
                ],
                ALLOW_DATA_ATTR: false,
                ALLOW_UNKNOWN_PROTOCOLS: false,
                WHOLE_DOCUMENT: false,
                RETURN_DOM: false,
                RETURN_DOM_FRAGMENT: false
            });
            
            this.logger?.debug('HTML sanitized', {
                originalSize: html.length,
                sanitizedSize: safeHtml.length,
                reductionPercent: Math.round((1 - safeHtml.length / html.length) * 100),
                url: baseUrl
            });
            
            return safeHtml;
            
        } catch (error) {
            this.logger?.error('HTML sanitization failed', { error, url: baseUrl });
            throw new Error(`HTML sanitization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}

/**
 * Stage 2: Content Extraction using Mozilla Readability
 */
export class ContentExtractor {
    private logger: any;

    constructor(logger?: any) {
        this.logger = logger;
    }

    async extractContent(html: string, baseUrl: string): Promise<ExtractedContent> {
        try {
            // Create DOM for Readability
            const dom = new JSDOM(html, { url: baseUrl });
            const reader = new Readability(dom.window.document);
            
            // Extract main content
            const article = reader.parse();
            
            if (!article) {
                this.logger?.warn('Readability extraction failed, using fallback', { url: baseUrl });
                return this.fallbackExtraction(dom, baseUrl);
            }
            
            const extracted: ExtractedContent = {
                title: article.title || dom.window.document.title || 'Untitled',
                content: article.content || '',
                textContent: article.textContent || '',
                siteName: article.siteName || this.extractSiteName(baseUrl),
                byline: article.byline || undefined,
                publishedTime: (article as any).publishedTime || undefined,
                dir: article.dir || undefined,
                lang: article.lang || dom.window.document.documentElement.lang || undefined
            };
            
            this.logger?.debug('Content extracted', {
                title: extracted.title,
                contentLength: extracted.content.length,
                textLength: extracted.textContent.length,
                hasAuthor: !!extracted.byline,
                hasDate: !!extracted.publishedTime,
                url: baseUrl
            });
            
            return extracted;
            
        } catch (error) {
            this.logger?.error('Content extraction failed', { error, url: baseUrl });
            throw new Error(`Content extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private fallbackExtraction(dom: JSDOM, baseUrl: string): ExtractedContent {
        const doc = dom.window.document;
        
        // Extract title
        const title = doc.title || doc.querySelector('h1')?.textContent || 'Untitled';
        
        // Extract main content using common selectors
        const contentSelectors = [
            'main', 'article', '.content', '.post', '.entry',
            '#content', '#main', '.main-content', '.post-content'
        ];
        
        let content = '';
        let textContent = '';
        
        for (const selector of contentSelectors) {
            const element = doc.querySelector(selector);
            if (element) {
                content = element.innerHTML;
                textContent = element.textContent || '';
                break;
            }
        }
        
        // If no content found, use body
        if (!content) {
            content = doc.body?.innerHTML || '';
            textContent = doc.body?.textContent || '';
        }
        
        return {
            title,
            content,
            textContent,
            siteName: this.extractSiteName(baseUrl),
            lang: doc.documentElement.lang
        };
    }

    private extractSiteName(url: string): string {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch {
            return 'Unknown Site';
        }
    }
}

/**
 * Stage 3: Content Conversion to multiple formats
 */
export class ContentConverter {
    private logger: any;
    private turndownService: TurndownService;

    constructor(logger?: any) {
        this.logger = logger;
        this.turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            bulletListMarker: '-',
            emDelimiter: '*',
            strongDelimiter: '**'
        });
    }

    async convertContent(content: ExtractedContent): Promise<ConvertedContent> {
        try {
            // Convert to markdown
            const markdown = this.turndownService.turndown(content.content);
            
            // Convert to plain text using html-to-text
            const plainText = htmlToText(content.content, {
                wordwrap: false,
                preserveNewlines: true,
                selectors: [
                    { selector: 'a', options: { ignoreHref: true } },
                    { selector: 'img', format: 'skip' },
                    { selector: 'script', format: 'skip' },
                    { selector: 'style', format: 'skip' },
                    { selector: 'nav', format: 'skip' },
                    { selector: 'header', format: 'skip' },
                    { selector: 'footer', format: 'skip' },
                    { selector: 'aside', format: 'skip' },
                    { selector: 'a', options: { ignoreHref: true } }
                ],
                formatters: {
                    'heading': (elem: any, walk: any, builder: any) => {
                        builder.openBlock({ leadingLineBreaks: 2 });
                        walk(elem.children, builder);
                        builder.closeBlock({ trailingLineBreaks: 1 });
                    }
                }
            });
            
            // Structured data (for agents needing organized info)
            const wordCount = plainText.split(/\s+/).filter((word: string) => word.length > 0).length;
            const structured: StructuredContent = {
                title: content.title,
                author: content.byline,
                publishDate: content.publishedTime,
                wordCount,
                readingTime: Math.ceil(wordCount / 200), // Assume 200 words per minute
                summary: this.generateSummary(plainText),
                headings: this.extractHeadings(content.content),
                links: this.extractLinks(content.content),
                images: this.extractImages(content.content),
                siteName: content.siteName,
                language: content.lang
            };
            
            this.logger?.debug('Content converted', {
                markdownLength: markdown.length,
                plainTextLength: plainText.length,
                wordCount: structured.wordCount,
                readingTime: structured.readingTime,
                headings: structured.headings.length,
                links: structured.links.length,
                images: structured.images.length
            });
            
            return {
                title: content.title,
                markdown,
                plainText,
                siteName: content.siteName,
                byline: content.byline,
                publishedTime: content.publishedTime,
                dir: content.dir,
                lang: content.lang
            };
            
        } catch (error) {
            this.logger?.error('Content conversion failed', { error });
            throw new Error(`Content conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private generateSummary(text: string, maxLength: number = 200): string {
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
        let summary = '';
        
        for (const sentence of sentences) {
            if (summary.length + sentence.length > maxLength) {
                break;
            }
            summary += sentence.trim() + '. ';
        }
        
        return summary.trim();
    }

    private extractHeadings(html: string): string[] {
        const dom = new JSDOM(html);
        const headings = Array.from(dom.window.document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        return headings.map(h => h.textContent || '').filter(text => text.length > 0);
    }

    private extractLinks(html: string): Array<{ text: string; url: string }> {
        const dom = new JSDOM(html);
        const links = Array.from(dom.window.document.querySelectorAll('a[href]'));
        return links.map(link => ({
            text: link.textContent || '',
            url: link.getAttribute('href') || ''
        })).filter(link => link.text.length > 0 && link.url.length > 0);
    }

    private extractImages(html: string): Array<{ alt: string; src: string }> {
        const dom = new JSDOM(html);
        const images = Array.from(dom.window.document.querySelectorAll('img[src]'));
        return images.map(img => ({
            alt: img.getAttribute('alt') || '',
            src: img.getAttribute('src') || ''
        })).filter(img => img.src.length > 0);
    }
}

/**
 * Stage 4: Content Optimization and final formatting
 */
export class ContentOptimizer {
    private logger: any;

    constructor(logger?: any) {
        this.logger = logger;
    }

    async optimizeContent(content: ConvertedContent, options: OptimizationOptions = {}): Promise<OptimizedContent> {
        try {
            let optimizedContent = content.markdown;
            let optimizedPlainText = content.plainText;
            
            // Apply length limits
            if (options.maxLength) {
                if (optimizedContent.length > options.maxLength) {
                    optimizedContent = optimizedContent.substring(0, options.maxLength) + '...';
                }
                if (optimizedPlainText.length > options.maxLength) {
                    optimizedPlainText = optimizedPlainText.substring(0, options.maxLength) + '...';
                }
            }
            
            // Calculate metrics
            const wordCount = optimizedPlainText.split(/\s+/).filter(word => word.length > 0).length;
            const readingTimeMinutes = Math.ceil(wordCount / 200);
            
            // Create structured data
            const structured: StructuredContent = {
                title: content.title,
                author: content.byline,
                publishDate: content.publishedTime,
                wordCount,
                readingTime: readingTimeMinutes,
                summary: this.generateSummary(optimizedPlainText),
                headings: this.extractHeadings(optimizedContent),
                links: options.includeLinks ? this.extractLinks(optimizedContent) : [],
                images: options.includeImages ? this.extractImages(optimizedContent) : [],
                siteName: content.siteName,
                language: content.lang
            };
            
            this.logger?.debug('Content optimized', {
                originalLength: content.markdown.length,
                optimizedLength: optimizedContent.length,
                wordCount,
                readingTime: readingTimeMinutes,
                format: options.format || 'structured'
            });
            
            return {
                title: content.title,
                content: optimizedContent,
                plainText: optimizedPlainText,
                wordCount,
                readingTimeMinutes,
                structured,
                siteName: content.siteName,
                byline: content.byline,
                publishedTime: content.publishedTime,
                dir: content.dir,
                lang: content.lang
            };
            
        } catch (error) {
            this.logger?.error('Content optimization failed', { error });
            throw new Error(`Content optimization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private generateSummary(text: string, maxLength: number = 200): string {
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
        let summary = '';
        
        for (const sentence of sentences) {
            if (summary.length + sentence.length > maxLength) {
                break;
            }
            summary += sentence.trim() + '. ';
        }
        
        return summary.trim();
    }

    private extractHeadings(content: string): string[] {
        const headingRegex = /^(#{1,6})\s+(.+)$/gm;
        const headings: string[] = [];
        let match;
        
        while ((match = headingRegex.exec(content)) !== null) {
            headings.push(match[2].trim());
        }
        
        return headings;
    }

    private extractLinks(content: string): Array<{ text: string; url: string }> {
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        const links: Array<{ text: string; url: string }> = [];
        let match;
        
        while ((match = linkRegex.exec(content)) !== null) {
            links.push({
                text: match[1],
                url: match[2]
            });
        }
        
        return links;
    }

    private extractImages(content: string): Array<{ alt: string; src: string }> {
        const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        const images: Array<{ alt: string; src: string }> = [];
        let match;
        
        while ((match = imageRegex.exec(content)) !== null) {
            images.push({
                alt: match[1],
                src: match[2]
            });
        }
        
        return images;
    }
}

/**
 * Main Content Processor - Orchestrates all 4 stages
 */
export class ContentProcessor {
    private sanitizer: HtmlSanitizer;
    private extractor: ContentExtractor;
    private converter: ContentConverter;
    private optimizer: ContentOptimizer;
    private logger: any;

    constructor(logger?: any) {
        this.logger = logger;
        this.sanitizer = new HtmlSanitizer(logger);
        this.extractor = new ContentExtractor(logger);
        this.converter = new ContentConverter(logger);
        this.optimizer = new ContentOptimizer(logger);
    }

    async processContent(html: string, baseUrl: string, options: OptimizationOptions = {}): Promise<OptimizedContent> {
        try {
            // Stage 1: Sanitize HTML
            const sanitizedHtml = await this.sanitizer.sanitizeHtml(html, baseUrl);
            
            // Stage 2: Extract content
            const extractedContent = await this.extractor.extractContent(sanitizedHtml, baseUrl);
            
            // Stage 3: Convert to multiple formats
            const convertedContent = await this.converter.convertContent(extractedContent);
            
            // Stage 4: Optimize and finalize
            const optimizedContent = await this.optimizer.optimizeContent(convertedContent, options);
            
            this.logger?.info('Content processing completed', {
                url: baseUrl,
                title: optimizedContent.title,
                wordCount: optimizedContent.wordCount,
                readingTime: optimizedContent.readingTimeMinutes,
                format: options.format || 'structured'
            });
            
            return optimizedContent;
            
        } catch (error) {
            this.logger?.error('Content processing failed', { error, url: baseUrl });
            throw new Error(`Content processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}