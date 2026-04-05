/**
 * MXF Desktop — Code Block Component
 *
 * Renders syntax-highlighted code blocks with a language label,
 * copy button, and optional line numbers. Used as a custom code
 * renderer inside ReactMarkdown.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React, { useState, useCallback } from 'react';

interface CodeBlockProps {
    /** Programming language for the label (from markdown fence) */
    language?: string;
    /** Code content */
    children: string;
    /** Pre-highlighted HTML from rehype-highlight (rendered via className) */
    className?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, children, className }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(children);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback for clipboard API failure
            const textarea = document.createElement('textarea');
            textarea.value = children;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    }, [children]);

    // Detect language from className if not passed directly
    const lang = language || className?.replace(/^language-/, '') || '';

    return (
        <div style={styles.container}>
            {/* Header bar with language label and copy button */}
            <div style={styles.header}>
                <span style={styles.language}>{lang}</span>
                <button
                    onClick={handleCopy}
                    style={styles.copyButton}
                    title="Copy to clipboard"
                >
                    {copied ? 'Copied!' : 'Copy'}
                </button>
            </div>

            {/* Code content — rehype-highlight handles syntax coloring via className */}
            <pre style={styles.pre}>
                <code className={className} style={styles.code}>
                    {children}
                </code>
            </pre>
        </div>
    );
};

const styles: Record<string, React.CSSProperties> = {
    container: {
        borderRadius: '6px',
        border: '1px solid var(--border)',
        overflow: 'hidden',
        margin: '8px 0',
        backgroundColor: 'var(--bg-primary)',
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '4px 12px',
        backgroundColor: 'var(--bg-tertiary)',
        borderBottom: '1px solid var(--border)',
    },
    language: {
        fontSize: '11px',
        color: 'var(--text-dim)',
        fontFamily: 'var(--font-mono)',
        textTransform: 'lowercase',
    },
    copyButton: {
        fontSize: '11px',
        color: 'var(--text-dim)',
        backgroundColor: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: '4px',
        padding: '2px 8px',
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        transition: 'color 0.15s, border-color 0.15s',
    },
    pre: {
        margin: 0,
        padding: '12px',
        overflowX: 'auto',
        fontSize: '13px',
        lineHeight: '1.5',
    },
    code: {
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
    },
};
