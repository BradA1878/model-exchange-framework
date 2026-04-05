/**
 * MXF Desktop — Theme Definitions
 *
 * Applies theme tokens as CSS custom properties on the document root.
 * Components use var(--token-name) for all colors.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { darkTheme, lightTheme, type ThemeTokens } from './tokens';

const themes: Record<string, ThemeTokens> = {
    dark: darkTheme,
    light: lightTheme,
};

/**
 * Apply a theme by setting CSS custom properties on :root.
 * Called when the app loads and when the user toggles theme.
 */
export function applyTheme(themeName: 'dark' | 'light'): void {
    const tokens = themes[themeName] || darkTheme;
    const root = document.documentElement;

    root.style.setProperty('--bg-primary', tokens.bgPrimary);
    root.style.setProperty('--bg-secondary', tokens.bgSecondary);
    root.style.setProperty('--bg-tertiary', tokens.bgTertiary);
    root.style.setProperty('--text-primary', tokens.textPrimary);
    root.style.setProperty('--text-secondary', tokens.textSecondary);
    root.style.setProperty('--text-dim', tokens.textDim);
    root.style.setProperty('--accent', tokens.accent);
    root.style.setProperty('--accent-hover', tokens.accentHover);
    root.style.setProperty('--border', tokens.border);
    root.style.setProperty('--success', tokens.success);
    root.style.setProperty('--warning', tokens.warning);
    root.style.setProperty('--error', tokens.error);
    root.style.setProperty('--info', tokens.info);
}
