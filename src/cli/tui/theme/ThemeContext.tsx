/**
 * MXF CLI TUI — Theme Context Provider
 *
 * React context that provides the active color theme to all components.
 * Components use the `useTheme()` hook to access theme colors instead
 * of hardcoding color values.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React, { createContext, useContext } from 'react';
import type { Theme } from './types';
import { THEMES } from './themes';

/** Theme context — defaults to the dark theme */
const ThemeContext = createContext<Theme>(THEMES.dark);

interface ThemeProviderProps {
    /** Name of the theme to use (falls back to 'dark' if not found) */
    themeName: string;
    children: React.ReactNode;
}

/**
 * Theme provider component — wraps the app to provide theme context.
 * Resolves the theme name to a theme object, falling back to dark.
 */
export const ThemeProvider: React.FC<ThemeProviderProps> = ({ themeName, children }) => {
    const theme = THEMES[themeName] || THEMES.dark;
    return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
};

/**
 * Hook to access the current theme from any component.
 * @returns The active Theme object
 */
export const useTheme = (): Theme => useContext(ThemeContext);
