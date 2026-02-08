/**
 * MXF Neural Command Center Theme
 *
 * Dual theme configuration inspired by the MXF logo: isometric geometric shapes,
 * interconnected nodes, blue color palette conveying intelligence and precision.
 *
 * Aesthetic principles:
 * - Geometric depth: Layered surfaces with subtle shadows, not flat
 * - Connected intelligence: Visual patterns suggesting neural networks
 * - Technical precision: Clean typography, purposeful spacing
 * - Living system: Subtle animations suggesting active processing
 */

// Neural Dark Theme (Default)
export const neuralDark = {
    dark: true,
    colors: {
        // Backgrounds - deep, layered surfaces
        background: '#0c1117',         // --bg-deep: main content area
        surface: '#121920',            // --bg-base: cards
        'surface-bright': '#1a2330',   // --bg-elevated: hover states, modals
        'surface-light': '#232d3d',    // lighter surface for contrast
        'surface-variant': '#2a3647',  // variant for secondary surfaces
        'on-surface-variant': '#94A3B8',

        // Primary Blue (from MXF logo)
        primary: '#4A90C2',            // main - matches logo
        'primary-darken-1': '#3A7CAB', // hover
        'primary-darken-2': '#2C5F82', // pressed

        // Secondary Steel
        secondary: '#5B7B95',
        'secondary-darken-1': '#4A6578',

        // Accent Cyan
        accent: '#22D3EE',             // active indicators, notifications

        // Semantic colors
        error: '#EF4444',
        info: '#3B82F6',
        success: '#10B981',
        warning: '#F59E0B',

        // Text colors
        'on-background': '#E8EDF2',    // --text-primary: headings, important
        'on-surface': '#E8EDF2',
        'on-primary': '#FFFFFF',
        'on-secondary': '#FFFFFF',
        'on-error': '#FFFFFF',
        'on-info': '#FFFFFF',
        'on-success': '#FFFFFF',
        'on-warning': '#000000',

        // Custom MXF colors for dashboard elements
        'sidebar-bg': '#07090d',       // --bg-void: deepest - sidebar
        'card-bg': '#121920',          // same as surface
        'nav-bg': '#0c1117',           // navigation background

        // Text hierarchy
        'text-primary': '#E8EDF2',
        'text-secondary': '#94A3B8',
        'text-muted': '#64748B',
    },
    variables: {
        // Border styling
        'border-color': 'rgba(148, 163, 184, 0.15)',
        'border-opacity': 0.15,

        // Emphasis levels
        'high-emphasis-opacity': 0.95,
        'medium-emphasis-opacity': 0.70,
        'disabled-opacity': 0.38,

        // Interactive states
        'idle-opacity': 0.04,
        'hover-opacity': 0.08,
        'focus-opacity': 0.12,
        'selected-opacity': 0.12,
        'activated-opacity': 0.16,
        'pressed-opacity': 0.16,
        'dragged-opacity': 0.08,

        // Code/kbd styling
        'kbd-background-color': '#1a2330',
        'kbd-color': '#E8EDF2',
        'code-background-color': '#1a2330',

        // Border radius
        'border-radius-root': '8px',
    },
};

// Neural Light Theme
export const neuralLight = {
    dark: false,
    colors: {
        // Backgrounds - clean, layered surfaces
        background: '#F8FAFC',         // --bg-deep
        surface: '#FFFFFF',            // --bg-base: cards
        'surface-bright': '#FFFFFF',   // --bg-elevated
        'surface-light': '#F1F5F9',    // lighter surface
        'surface-variant': '#E2E8F0',  // variant for secondary surfaces
        'on-surface-variant': '#475569',

        // Primary Blue (darker for contrast on light)
        primary: '#2563EB',
        'primary-darken-1': '#1D4ED8',
        'primary-darken-2': '#1E40AF',

        // Secondary Steel
        secondary: '#64748B',
        'secondary-darken-1': '#475569',

        // Accent Cyan (slightly darker for light mode)
        accent: '#0891B2',

        // Semantic colors (slightly adjusted for light mode)
        error: '#DC2626',
        info: '#2563EB',
        success: '#059669',
        warning: '#D97706',

        // Text colors
        'on-background': '#0F172A',    // --text-primary
        'on-surface': '#0F172A',
        'on-primary': '#FFFFFF',
        'on-secondary': '#FFFFFF',
        'on-error': '#FFFFFF',
        'on-info': '#FFFFFF',
        'on-success': '#FFFFFF',
        'on-warning': '#000000',

        // Custom MXF colors for dashboard elements
        'sidebar-bg': '#F1F5F9',       // --bg-void
        'card-bg': '#FFFFFF',
        'nav-bg': '#F8FAFC',

        // Text hierarchy
        'text-primary': '#0F172A',
        'text-secondary': '#475569',
        'text-muted': '#94A3B8',
    },
    variables: {
        // Border styling
        'border-color': 'rgba(15, 23, 42, 0.12)',
        'border-opacity': 0.12,

        // Emphasis levels
        'high-emphasis-opacity': 0.95,
        'medium-emphasis-opacity': 0.70,
        'disabled-opacity': 0.38,

        // Interactive states
        'idle-opacity': 0.04,
        'hover-opacity': 0.06,
        'focus-opacity': 0.10,
        'selected-opacity': 0.08,
        'activated-opacity': 0.12,
        'pressed-opacity': 0.12,
        'dragged-opacity': 0.06,

        // Code/kbd styling
        'kbd-background-color': '#E2E8F0',
        'kbd-color': '#0F172A',
        'code-background-color': '#F1F5F9',

        // Border radius
        'border-radius-root': '8px',
    },
};

// Legacy export for backward compatibility during migration
export const mxfTheme = neuralDark;
