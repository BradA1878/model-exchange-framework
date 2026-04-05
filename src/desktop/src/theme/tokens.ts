/**
 * MXF Desktop — Design Tokens
 *
 * CSS custom property values for theming. The dark theme uses
 * Brad's brand palette: black, gray, green (sage, OD, forest).
 * Light theme uses the same structure with inverted luminance.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

export interface ThemeTokens {
    bgPrimary: string;
    bgSecondary: string;
    bgTertiary: string;
    textPrimary: string;
    textSecondary: string;
    textDim: string;
    accent: string;
    accentHover: string;
    border: string;
    success: string;
    warning: string;
    error: string;
    info: string;
}

export const darkTheme: ThemeTokens = {
    bgPrimary: '#0d0d0d',       // Near-black
    bgSecondary: '#1a1a1a',     // Dark charcoal
    bgTertiary: '#262626',      // Medium charcoal
    textPrimary: '#d4d4d4',     // Light gray
    textSecondary: '#a3a3a3',   // Mid gray
    textDim: '#5c5c5c',         // Dark gray
    accent: '#87a878',          // Sage green
    accentHover: '#9dba8f',     // Lighter sage on hover
    border: '#333333',          // Charcoal border
    success: '#6b8f4a',         // Forest green
    warning: '#b8a44e',         // Muted gold
    error: '#c45c5c',           // Muted red
    info: '#6b7f3a',            // OD green
};

export const lightTheme: ThemeTokens = {
    bgPrimary: '#f0f0ed',       // Warm off-white
    bgSecondary: '#e0e0db',     // Light warm gray
    bgTertiary: '#d0d0c8',      // Medium warm gray
    textPrimary: '#1a1a1a',     // Near-black
    textSecondary: '#404040',   // Dark gray
    textDim: '#808078',         // Muted gray-green
    accent: '#4a6b3a',          // Forest green
    accentHover: '#5a7d48',     // Lighter forest
    border: '#c0c0b8',          // Warm gray border
    success: '#4a6b3a',         // Forest green
    warning: '#8a7a30',         // Dark gold
    error: '#9a3a3a',           // Dark red
    info: '#556b2f',            // Dark OD green
};
