/**
 * MXF Desktop — Message Bubble Component
 *
 * Renders a single conversation message. Different visual styles
 * for user, agent, system, and error messages. Agent messages
 * render full markdown with syntax-highlighted code blocks,
 * tables, and GFM support.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';
import { CodeBlock } from './CodeBlock';
import { useAppState } from '../state/appState';
import type { ConversationMessage } from '../types';

interface MessageBubbleProps {
    message: ConversationMessage;
}

/**
 * Custom ReactMarkdown component overrides for rich rendering.
 * Routes fenced code blocks to the CodeBlock component with
 * copy button and language label.
 */
const markdownComponents: Components = {
    // Route fenced code blocks to our CodeBlock component
    code({ className, children, ...props }) {
        const match = /language-(\w+)/.exec(className || '');
        const isBlock = match || (typeof children === 'string' && children.includes('\n'));

        if (isBlock) {
            return (
                <CodeBlock
                    language={match?.[1]}
                    className={className}
                >
                    {String(children).replace(/\n$/, '')}
                </CodeBlock>
            );
        }

        // Inline code
        return (
            <code style={inlineStyles.inlineCode} className={className} {...props}>
                {children}
            </code>
        );
    },

    // Style pre to avoid double-wrapping with CodeBlock
    pre({ children }) {
        // CodeBlock already wraps in <pre>, so just pass through
        return <>{children}</>;
    },

    // Styled tables
    table({ children }) {
        return (
            <div style={inlineStyles.tableWrapper}>
                <table style={inlineStyles.table}>{children}</table>
            </div>
        );
    },
    th({ children }) {
        return <th style={inlineStyles.th}>{children}</th>;
    },
    td({ children }) {
        return <td style={inlineStyles.td}>{children}</td>;
    },

    // Links open in system browser
    a({ href, children }) {
        return (
            <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={inlineStyles.link}
            >
                {children}
            </a>
        );
    },

    // Blockquotes
    blockquote({ children }) {
        return <blockquote style={inlineStyles.blockquote}>{children}</blockquote>;
    },

    // Horizontal rules
    hr() {
        return <hr style={inlineStyles.hr} />;
    },
};

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
    const detailLevel = useAppState((s) => s.detailLevel);
    const { type, content, agentName, agentColor, streaming, timestamp, toolArgs } = message;

    // Minimal mode: hide tool-result, reasoning, and activity messages
    if (detailLevel === 'minimal' && (type === 'tool-result' || type === 'reasoning' || type === 'activity')) {
        return null;
    }

    // Detailed mode: show timestamp on all messages
    const showTimestamp = detailLevel === 'detailed' && timestamp;

    return (
        <div style={{
            ...styles.bubble,
            ...(type === 'user' ? styles.userBubble : {}),
            ...(type === 'error' ? styles.errorBubble : {}),
            ...(type === 'system' ? styles.systemBubble : {}),
            ...(type === 'activity' ? styles.activityBubble : {}),
            ...(type === 'tool-result' ? styles.toolResultBubble : {}),
            ...(type === 'reasoning' ? styles.reasoningBubble : {}),
        }}>
            {/* Timestamp in detailed mode */}
            {showTimestamp && (
                <div style={styles.timestamp}>
                    {new Date(timestamp).toLocaleTimeString()}
                </div>
            )}

            {/* Agent name label */}
            {agentName && type !== 'activity' && (
                <div style={{
                    ...styles.agentLabel,
                    color: agentColor || 'var(--accent)',
                }}>
                    {agentName}
                </div>
            )}

            {/* Message content */}
            {type === 'user' ? (
                <div style={styles.userContent}>{content}</div>
            ) : type === 'system' ? (
                <div style={styles.plainContent}>{content}</div>
            ) : type === 'error' ? (
                <div style={styles.errorContent}>{content}</div>
            ) : type === 'activity' ? (
                <div>
                    <div style={styles.activityContent}>
                        <span style={styles.activityDot}>●</span>
                        {agentName ? <span style={styles.activityAgent}>{agentName}</span> : null}
                        {content}
                    </div>
                    {/* Detailed mode: show tool call arguments */}
                    {detailLevel === 'detailed' && toolArgs && Object.keys(toolArgs).length > 0 && (
                        <pre style={styles.toolArgsBlock}>
                            {JSON.stringify(toolArgs, null, 2)}
                        </pre>
                    )}
                </div>
            ) : type === 'reasoning' ? (
                detailLevel === 'detailed' ? (
                    // Detailed mode: always expanded, no collapse
                    <div>
                        <div style={styles.reasoningSummary}>
                            {agentName ? `${agentName} reasoning` : 'Reasoning'}
                        </div>
                        <div style={styles.reasoningContent}>{content}</div>
                    </div>
                ) : (
                    <details style={styles.reasoningDetails} open>
                        <summary style={styles.reasoningSummary}>
                            {agentName ? `${agentName} reasoning` : 'Reasoning'}
                        </summary>
                        <div style={styles.reasoningContent}>{content}</div>
                    </details>
                )
            ) : (
                <div style={styles.markdownContent} className="mxf-markdown">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                        components={markdownComponents}
                    >
                        {content}
                    </ReactMarkdown>
                </div>
            )}

            {/* Streaming cursor indicator */}
            {streaming && (
                <span style={styles.cursor}>|</span>
            )}
        </div>
    );
};

/** Bubble-level styles */
const styles: Record<string, React.CSSProperties> = {
    bubble: {
        padding: '8px 12px',
        borderRadius: '8px',
        maxWidth: '100%',
        wordBreak: 'break-word',
    },
    userBubble: {
        backgroundColor: 'var(--bg-tertiary)',
        alignSelf: 'flex-end',
        borderBottomRightRadius: '2px',
    },
    errorBubble: {
        backgroundColor: 'rgba(196, 92, 92, 0.1)',
        borderLeft: '3px solid var(--error)',
    },
    systemBubble: {
        backgroundColor: 'transparent',
        color: 'var(--text-dim)',
        fontSize: '13px',
        padding: '4px 12px',
    },
    activityBubble: {
        backgroundColor: 'transparent',
        color: 'var(--text-dim)',
        fontSize: '12px',
        padding: '2px 12px',
    },
    toolResultBubble: {
        backgroundColor: 'rgba(107, 127, 58, 0.08)',
        borderLeft: '2px solid var(--info)',
        fontSize: '13px',
    },
    reasoningBubble: {
        backgroundColor: 'transparent',
        padding: '2px 12px',
    },
    agentLabel: {
        fontSize: '12px',
        fontWeight: 600,
        marginBottom: '4px',
        fontFamily: 'var(--font-mono)',
    },
    userContent: {
        color: 'var(--text-primary)',
        whiteSpace: 'pre-wrap',
        lineHeight: '1.5',
    },
    plainContent: {
        whiteSpace: 'pre-wrap',
        lineHeight: '1.5',
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
    },
    errorContent: {
        whiteSpace: 'pre-wrap',
        lineHeight: '1.5',
        color: 'var(--error)',
        fontSize: '13px',
    },
    activityContent: {
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        color: 'var(--text-dim)',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
    },
    activityDot: {
        color: 'var(--info)',
        fontSize: '8px',
    },
    activityAgent: {
        color: 'var(--accent)',
        fontWeight: 600,
    },
    reasoningDetails: {
        cursor: 'pointer',
    },
    reasoningSummary: {
        fontSize: '12px',
        color: 'var(--text-dim)',
        fontFamily: 'var(--font-mono)',
        fontStyle: 'italic',
        listStyle: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
    },
    reasoningContent: {
        fontSize: '12px',
        color: 'var(--text-dim)',
        fontFamily: 'var(--font-mono)',
        padding: '8px 0 4px 16px',
        borderLeft: '1px solid var(--border)',
        marginTop: '4px',
        whiteSpace: 'pre-wrap',
        lineHeight: '1.5',
    },
    markdownContent: {
        color: 'var(--text-primary)',
        lineHeight: '1.6',
        fontSize: '14px',
    },
    cursor: {
        color: 'var(--accent)',
        animation: 'blink 1s step-end infinite',
        fontWeight: 700,
    },
    timestamp: {
        fontSize: '10px',
        color: 'var(--text-dim)',
        fontFamily: 'var(--font-mono)',
        marginBottom: '2px',
    },
    toolArgsBlock: {
        fontSize: '11px',
        color: 'var(--text-dim)',
        fontFamily: 'var(--font-mono)',
        backgroundColor: 'var(--bg-tertiary)',
        padding: '6px 8px',
        borderRadius: '4px',
        marginTop: '4px',
        marginLeft: '20px',
        overflow: 'auto',
        maxHeight: '150px',
        whiteSpace: 'pre-wrap',
        lineHeight: '1.4',
    },
};

/** Inline element styles for markdown components */
const inlineStyles: Record<string, React.CSSProperties> = {
    inlineCode: {
        backgroundColor: 'var(--bg-tertiary)',
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '0.9em',
        fontFamily: 'var(--font-mono)',
        color: 'var(--accent)',
    },
    tableWrapper: {
        overflowX: 'auto',
        margin: '8px 0',
    },
    table: {
        borderCollapse: 'collapse',
        width: '100%',
        fontSize: '13px',
    },
    th: {
        backgroundColor: 'var(--bg-tertiary)',
        border: '1px solid var(--border)',
        padding: '6px 12px',
        textAlign: 'left',
        fontWeight: 600,
        fontSize: '12px',
    },
    td: {
        border: '1px solid var(--border)',
        padding: '6px 12px',
    },
    link: {
        color: 'var(--accent)',
        textDecoration: 'underline',
    },
    blockquote: {
        borderLeft: '3px solid var(--border)',
        margin: '8px 0',
        padding: '4px 16px',
        color: 'var(--text-secondary)',
    },
    hr: {
        border: 'none',
        borderTop: '1px solid var(--border)',
        margin: '12px 0',
    },
};
