/**
 * MXF CLI TUI — Markdown Text Component
 *
 * Renders markdown content as styled ANSI terminal output using
 * marked + marked-terminal. Handles headers, bold, italic, inline code,
 * fenced code blocks (with syntax highlighting via cli-highlight),
 * tables, lists, blockquotes, links, and horizontal rules.
 *
 * Uses an isolated Marked instance (not the global singleton) to avoid
 * side effects on any other markdown processing in the codebase.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React from 'react';
import { Text } from 'ink';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import chalk from 'chalk';

/**
 * Module-level isolated Marked instance configured with terminal rendering.
 * Styles chosen to match existing MXF TUI color conventions:
 *   - Yellow for inline code (matches prior CodeBlock style)
 *   - Cyan underline for links
 *   - Gray italic for blockquotes
 *   - Bold for headings and strong text
 */
const markedInstance = new Marked(
    markedTerminal({
        // Heading styles
        firstHeading: chalk.bold.underline,
        heading: chalk.bold,

        // Inline styles
        strong: chalk.bold,
        em: chalk.italic,
        codespan: chalk.yellow,
        del: chalk.dim.gray.strikethrough,

        // Block styles
        blockquote: chalk.gray.italic,
        code: chalk.yellow,

        // Links
        link: chalk.cyan,
        href: chalk.cyan.underline,

        // Layout options
        reflowText: false,         // Let Ink/yoga handle terminal wrapping
        showSectionPrefix: false,  // No "# " prefix echoed in output
        emoji: false,              // Keep output deterministic
        tab: 2,                    // 2-space indent for nested lists
    }) as Parameters<Marked['use']>[0],
);

interface MarkdownTextProps {
    /** Raw markdown string to render */
    children: string;
}

/**
 * MarkdownText — renders a markdown string as styled ANSI text
 * inside an Ink <Text> element.
 *
 * marked.parse() returns ANSI escape sequences that Ink's <Text>
 * passes through to the terminal, producing colored/styled output.
 */
export const MarkdownText: React.FC<MarkdownTextProps> = ({ children }) => {
    // marked.parse() is synchronous when no async extensions are registered
    const rendered = markedInstance.parse(children) as string;

    // Trim trailing whitespace/newlines that marked-terminal appends
    const trimmed = rendered.replace(/\n+$/, '');

    return <Text>{trimmed}</Text>;
};
