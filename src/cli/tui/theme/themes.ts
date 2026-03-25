/**
 * MXF CLI TUI — Built-in Theme Definitions
 *
 * Provides three preset color themes for the TUI:
 * - dark: Default theme for dark terminals (cyan accent, white text)
 * - light: For light terminal backgrounds (blue accent, dark text)
 * - minimal: Reduced color palette (white/gray only)
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import type { Theme } from './types';

/** Dark theme — default, optimized for dark terminal backgrounds */
const darkTheme: Theme = {
    name: 'dark',
    border: 'gray',
    dimText: 'gray',
    userText: 'white',
    systemText: 'gray',
    errorText: 'red',
    agentColors: {
        'mxf-planner': 'white',
        'mxf-operator': 'cyan',
        'mxf-executor': 'yellow',
        'mxf-reviewer': 'green',
    },
    statusActive: 'green',
    statusIdle: 'gray',
    statusError: 'red',
    promptColor: 'white',
    confirmColor: 'yellow',
    accent: 'cyan',
    success: 'green',
    warning: 'yellow',
};

/** Light theme — for light terminal backgrounds */
const lightTheme: Theme = {
    name: 'light',
    border: 'blackBright',
    dimText: 'blackBright',
    userText: 'black',
    systemText: 'blackBright',
    errorText: 'red',
    agentColors: {
        'mxf-planner': 'black',
        'mxf-operator': 'blue',
        'mxf-executor': 'magenta',
        'mxf-reviewer': 'green',
    },
    statusActive: 'green',
    statusIdle: 'blackBright',
    statusError: 'red',
    promptColor: 'black',
    confirmColor: 'magenta',
    accent: 'blue',
    success: 'green',
    warning: 'magenta',
};

/** Minimal theme — reduced colors, low contrast */
const minimalTheme: Theme = {
    name: 'minimal',
    border: 'gray',
    dimText: 'gray',
    userText: 'white',
    systemText: 'gray',
    errorText: 'red',
    agentColors: {
        'mxf-planner': 'white',
        'mxf-operator': 'white',
        'mxf-executor': 'white',
        'mxf-reviewer': 'white',
    },
    statusActive: 'white',
    statusIdle: 'gray',
    statusError: 'red',
    promptColor: 'white',
    confirmColor: 'white',
    accent: 'white',
    success: 'white',
    warning: 'white',
};

/** All available themes, keyed by name */
export const THEMES: Record<string, Theme> = {
    dark: darkTheme,
    light: lightTheme,
    minimal: minimalTheme,
};

/** Get list of available theme names */
export function getThemeNames(): string[] {
    return Object.keys(THEMES);
}
