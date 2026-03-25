/**
 * MXF CLI Context Builder
 *
 * Reads file or directory contents for inclusion in task descriptions
 * when using the --context flag with `mxf run`.
 *
 * Files are formatted with headers for clear delineation:
 *   --- FILE: path/to/file.ts ---
 *   <file contents>
 *
 * Directories are read recursively, skipping binaries, node_modules, .git,
 * and other non-text content. Warns at 100KB, truncates at 500KB.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import * as fs from 'fs';
import * as path from 'path';
import { logWarning } from './output';

/** Maximum context size before truncation (500KB) */
const MAX_CONTEXT_BYTES = 500 * 1024;

/** Warning threshold for context size (100KB) */
const WARN_CONTEXT_BYTES = 100 * 1024;

/** Directories to skip when reading recursively */
const SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    '.next',
    '.nuxt',
    'dist',
    'build',
    'coverage',
    '.cache',
    '__pycache__',
    '.tox',
    '.venv',
    'venv',
]);

/** File extensions considered binary (skip these) */
const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
    '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv',
    '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.exe', '.dll', '.so', '.dylib', '.o', '.a',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.pyc', '.pyo', '.class',
    '.db', '.sqlite', '.sqlite3',
    '.lock',
]);

/**
 * Build a context string from a file or directory path.
 *
 * @param contextPath - Absolute or relative path to a file or directory
 * @returns Formatted context string with file headers and contents
 * @throws Error if the path does not exist
 */
export function buildContextString(contextPath: string): string {
    const resolvedPath = path.resolve(contextPath);

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Context path does not exist: ${contextPath}`);
    }

    const stat = fs.statSync(resolvedPath);
    let result: string;

    if (stat.isFile()) {
        result = readSingleFile(resolvedPath, contextPath);
    } else if (stat.isDirectory()) {
        result = readDirectory(resolvedPath, contextPath);
    } else {
        throw new Error(`Context path is not a file or directory: ${contextPath}`);
    }

    // Check size and warn/truncate
    const byteLength = Buffer.byteLength(result, 'utf-8');

    if (byteLength > MAX_CONTEXT_BYTES) {
        logWarning(`Context exceeds 500KB (${formatBytes(byteLength)}), truncating...`);
        // Truncate to MAX_CONTEXT_BYTES and append a notice
        const truncated = result.substring(0, MAX_CONTEXT_BYTES);
        return truncated + '\n\n--- CONTEXT TRUNCATED (exceeded 500KB limit) ---\n';
    }

    if (byteLength > WARN_CONTEXT_BYTES) {
        logWarning(`Context is large (${formatBytes(byteLength)}). Consider narrowing the --context path.`);
    }

    return result;
}

/**
 * Read a single file and format it with a header.
 */
function readSingleFile(absolutePath: string, displayPath: string): string {
    const ext = path.extname(absolutePath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
        return `--- FILE: ${displayPath} ---\n[Binary file, skipped]\n`;
    }

    try {
        const content = fs.readFileSync(absolutePath, 'utf-8');
        return `--- FILE: ${displayPath} ---\n${content}\n`;
    } catch {
        return `--- FILE: ${displayPath} ---\n[Could not read file]\n`;
    }
}

/**
 * Recursively read all text files in a directory.
 */
function readDirectory(dirPath: string, basePath: string): string {
    const parts: string[] = [];
    collectFiles(dirPath, basePath, parts);

    if (parts.length === 0) {
        return `--- DIRECTORY: ${basePath} ---\n[No readable text files found]\n`;
    }

    return parts.join('\n');
}

/**
 * Recursively collect formatted file contents from a directory.
 */
function collectFiles(dirPath: string, basePath: string, parts: string[]): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return; // Skip unreadable directories
    }

    // Sort entries for deterministic output
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
                continue;
            }
            collectFiles(fullPath, basePath, parts);
        } else if (entry.isFile()) {
            const relativePath = path.relative(path.resolve(basePath), fullPath);
            const displayPath = path.join(basePath, relativePath);
            parts.push(readSingleFile(fullPath, displayPath));
        }
    }
}

/**
 * Format byte count as a human-readable string.
 */
function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
