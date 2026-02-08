<script setup lang="ts">
import { onMounted, watch, computed } from 'vue';
import { useTheme } from 'vuetify';
import { useAuthStore } from './stores/auth';

const authStore = useAuthStore();
const theme = useTheme();

// Computed property for current theme name
const currentTheme = computed(() => theme.global.name.value);

// Apply theme class to document root for CSS variable scoping
const applyThemeClass = (themeName: string) => {
    document.documentElement.classList.remove('theme-neural-dark', 'theme-neural-light');
    document.documentElement.classList.add(themeName === 'neuralLight' ? 'theme-neural-light' : 'theme-neural-dark');
};

// Watch for theme changes
watch(currentTheme, (newTheme) => {
    applyThemeClass(newTheme);
    // Persist theme preference
    localStorage.setItem('mxf-theme', newTheme);
});

onMounted(async () => {
    // Restore saved theme preference
    const savedTheme = localStorage.getItem('mxf-theme');
    if (savedTheme && (savedTheme === 'neuralDark' || savedTheme === 'neuralLight')) {
        theme.global.name.value = savedTheme;
    }
    applyThemeClass(theme.global.name.value);

    // Check for existing authentication token on app startup
    await authStore.checkAuth();
});
</script>

<template>
    <v-app>
        <router-view />
    </v-app>
</template>

<style>
/*
 * MXF Neural Command Center - Global Styles
 *
 * Design tokens and global CSS variables for the Neural theme system.
 * These variables complement Vuetify's theme system and provide
 * additional customization for MXF-specific components.
 */

/* ============================================
   CSS CUSTOM PROPERTIES (Design Tokens)
   ============================================ */

:root {
    /* Typography Scale */
    --text-xs: 0.75rem;    /* 12px - badges, labels */
    --text-sm: 0.875rem;   /* 14px - secondary text */
    --text-base: 1rem;     /* 16px - body */
    --text-lg: 1.125rem;   /* 18px - subheadings */
    --text-xl: 1.25rem;    /* 20px - section titles */
    --text-2xl: 1.5rem;    /* 24px - page titles */
    --text-3xl: 2rem;      /* 32px - hero headings */

    /* Spacing Scale */
    --space-1: 0.25rem;    /* 4px */
    --space-2: 0.5rem;     /* 8px */
    --space-3: 0.75rem;    /* 12px */
    --space-4: 1rem;       /* 16px */
    --space-5: 1.25rem;    /* 20px */
    --space-6: 1.5rem;     /* 24px */
    --space-8: 2rem;       /* 32px */
    --space-10: 2.5rem;    /* 40px */
    --space-12: 3rem;      /* 48px */

    /* Border Radius */
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --radius-xl: 16px;
    --radius-2xl: 24px;
    --radius-full: 9999px;

    /* Shadows - used for layered depth */
    --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
    --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
    --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);

    /* Transitions */
    --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
    --transition-base: 200ms cubic-bezier(0.4, 0, 0.2, 1);
    --transition-slow: 300ms cubic-bezier(0.4, 0, 0.2, 1);
    --transition-slower: 500ms cubic-bezier(0.4, 0, 0.2, 1);

    /* Font Families */
    --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --font-mono: 'JetBrains Mono', ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace;
}

/* Dark Theme Variables */
.theme-neural-dark {
    --bg-void: #07090d;
    --bg-deep: #0c1117;
    --bg-base: #121920;
    --bg-elevated: #1a2330;
    --bg-hover: #232d3d;

    --primary-400: #6BA3D6;
    --primary-500: #4A90C2;
    --primary-600: #3A7CAB;
    --primary-700: #2C5F82;

    --secondary-500: #5B7B95;
    --secondary-600: #4A6578;

    --accent-500: #22D3EE;

    --text-primary: #E8EDF2;
    --text-secondary: #94A3B8;
    --text-muted: #64748B;

    --border-subtle: rgba(148, 163, 184, 0.08);
    --border-default: rgba(148, 163, 184, 0.15);
    --border-strong: rgba(148, 163, 184, 0.25);

    /* Glow effects for active states */
    --glow-primary: 0 0 20px rgba(74, 144, 194, 0.3);
    --glow-accent: 0 0 20px rgba(34, 211, 238, 0.3);
    --glow-success: 0 0 20px rgba(16, 185, 129, 0.3);
}

/* Light Theme Variables */
.theme-neural-light {
    --bg-void: #F1F5F9;
    --bg-deep: #F8FAFC;
    --bg-base: #FFFFFF;
    --bg-elevated: #FFFFFF;
    --bg-hover: #F1F5F9;

    --primary-400: #60A5FA;
    --primary-500: #2563EB;
    --primary-600: #1D4ED8;
    --primary-700: #1E40AF;

    --secondary-500: #64748B;
    --secondary-600: #475569;

    --accent-500: #0891B2;

    --text-primary: #0F172A;
    --text-secondary: #475569;
    --text-muted: #94A3B8;

    --border-subtle: rgba(15, 23, 42, 0.06);
    --border-default: rgba(15, 23, 42, 0.12);
    --border-strong: rgba(15, 23, 42, 0.20);

    /* Glow effects for active states */
    --glow-primary: 0 0 20px rgba(37, 99, 235, 0.2);
    --glow-accent: 0 0 20px rgba(8, 145, 178, 0.2);
    --glow-success: 0 0 20px rgba(5, 150, 105, 0.2);
}

/* ============================================
   GLOBAL STYLES
   ============================================ */

*, *::before, *::after {
    box-sizing: border-box;
}

html {
    font-size: 16px;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

body {
    font-family: var(--font-sans);
    line-height: 1.5;
}

/* Monospace text utility */
.font-mono {
    font-family: var(--font-mono) !important;
}

/* ============================================
   VUETIFY COMPONENT OVERRIDES
   ============================================ */

/* Application root */
.v-application {
    font-family: var(--font-sans) !important;
}

/* Cards - Layered depth with subtle borders */
.v-card {
    background: var(--bg-base) !important;
    border: 1px solid var(--border-subtle) !important;
    transition: all var(--transition-base) !important;
}

.v-card:hover {
    border-color: var(--border-default) !important;
}

/* Elevated cards (modals, dropdowns) */
.v-card--elevated,
.v-dialog .v-card,
.v-menu .v-card {
    background: var(--bg-elevated) !important;
    box-shadow: var(--shadow-xl) !important;
}

/* Card with hover lift effect */
.v-card--hover:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-lg), var(--glow-primary) !important;
}

/* Primary buttons - gradient style */
.v-btn--variant-flat.bg-primary,
.v-btn--variant-elevated.bg-primary {
    background: linear-gradient(135deg, var(--primary-500) 0%, var(--primary-600) 100%) !important;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1) !important;
    transition: all var(--transition-base) !important;
}

.v-btn--variant-flat.bg-primary:hover,
.v-btn--variant-elevated.bg-primary:hover {
    background: linear-gradient(135deg, var(--primary-400) 0%, var(--primary-500) 100%) !important;
    box-shadow: 0 4px 12px rgba(74, 144, 194, 0.3) !important;
    transform: translateY(-1px);
}

/* Ghost/outlined buttons */
.v-btn--variant-outlined {
    border-color: var(--border-default) !important;
    transition: all var(--transition-base) !important;
}

.v-btn--variant-outlined:hover {
    background: var(--bg-hover) !important;
    border-color: var(--primary-500) !important;
}

/* Text buttons */
.v-btn--variant-text:hover {
    background: var(--bg-hover) !important;
}

/* Tables - clean styling */
.v-table {
    background: transparent !important;
}

.v-table > .v-table__wrapper > table > thead > tr > th {
    font-size: var(--text-xs) !important;
    font-weight: 600 !important;
    text-transform: uppercase !important;
    letter-spacing: 0.05em !important;
    color: var(--text-muted) !important;
    border-bottom: 1px solid var(--border-default) !important;
    padding: var(--space-3) var(--space-4) !important;
}

.v-table > .v-table__wrapper > table > tbody > tr {
    transition: background var(--transition-fast) !important;
}

.v-table > .v-table__wrapper > table > tbody > tr:hover {
    background: var(--bg-hover) !important;
}

.v-table > .v-table__wrapper > table > tbody > tr > td {
    border-bottom: 1px solid var(--border-subtle) !important;
    padding: var(--space-3) var(--space-4) !important;
}

/* Form inputs - subtle focus states */
.v-field {
    transition: all var(--transition-base) !important;
}

.v-field--focused {
    /* Subtle shadow instead of prominent focus ring */
    box-shadow: 0 0 0 1px rgba(var(--v-theme-primary), 0.15) !important;
}

.v-field__outline {
    border-color: var(--border-default) !important;
    /* Reduce the outline opacity when focused */
    --v-field-border-opacity: 0.4;
}

.v-field--focused .v-field__outline {
    border-color: var(--primary-500) !important;
    /* Subtle border when focused */
    opacity: 0.7;
}

/* Remove outline on all form elements when focused */
.v-field:focus-within {
    outline: none !important;
}

.v-input:focus-within .v-field__outline {
    border-width: 1px !important;
}

/* Chips/badges - refined styling with smaller default size */
.v-chip {
    font-weight: 500 !important;
    letter-spacing: 0.01em !important;
    font-size: 0.8125rem !important;
}

.v-chip--size-small {
    font-size: 0.75rem !important;
    height: 22px !important;
    padding: 0 8px !important;
}

.v-chip--size-x-small {
    font-size: 0.6875rem !important;
    height: 18px !important;
    padding: 0 6px !important;
}

.v-chip--variant-tonal {
    background: var(--bg-hover) !important;
}

/* Status chips with subtle glow */
.v-chip.bg-success {
    box-shadow: inset 0 0 0 1px rgba(16, 185, 129, 0.3) !important;
}

.v-chip.bg-warning {
    box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.3) !important;
}

.v-chip.bg-error {
    box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.3) !important;
}

.v-chip.bg-info {
    box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.3) !important;
}

/* Tabs - active indicator styling */
.v-tabs {
    border-bottom: 1px solid var(--border-subtle);
}

.v-tab {
    font-weight: 500 !important;
    font-size: 0.875rem !important;
    letter-spacing: 0.01em !important;
    text-transform: none !important;
    min-width: 80px !important;
    padding: 0 12px !important;
    transition: all var(--transition-base) !important;
}

.v-tab--selected {
    color: var(--primary-500) !important;
}

.v-tab:hover:not(.v-tab--selected) {
    background: var(--bg-hover) !important;
}

/* Buttons - refined styling */
.v-btn {
    font-weight: 500 !important;
    letter-spacing: 0.02em !important;
    text-transform: none !important;
}

.v-btn--size-small {
    font-size: 0.8125rem !important;
    height: 32px !important;
    padding: 0 12px !important;
}

.v-btn--size-x-small {
    font-size: 0.75rem !important;
    height: 26px !important;
    padding: 0 8px !important;
}

.v-btn--variant-elevated {
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1) !important;
}

.v-btn--variant-elevated:hover {
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15) !important;
}

.v-btn--variant-text:hover,
.v-btn--variant-outlined:hover {
    background: var(--bg-hover) !important;
}

/* Typography refinements */
.text-h3, .text-h4, .text-h5, .text-h6 {
    font-weight: 600 !important;
    letter-spacing: -0.01em !important;
}

.text-body-1 {
    font-weight: 400 !important;
    line-height: 1.5 !important;
}

.text-body-2 {
    font-weight: 400 !important;
    line-height: 1.5 !important;
    font-size: 0.875rem !important;
}

.text-caption {
    font-weight: 400 !important;
    font-size: 0.75rem !important;
    letter-spacing: 0.02em !important;
}

.text-medium-emphasis {
    opacity: 0.7 !important;
}

/* Subtle hover effects */
.v-card:not(.no-hover):hover {
    border-color: var(--border-default) !important;
}

/* Badge styling */
.v-badge .v-badge__badge {
    font-size: 0.6875rem !important;
    font-weight: 600 !important;
    min-width: 18px !important;
    height: 18px !important;
    padding: 0 4px !important;
}

/* Expansion panels - cleaner look */
.v-expansion-panel-title {
    font-weight: 500 !important;
    font-size: 0.875rem !important;
    padding: 12px 16px !important;
    min-height: 44px !important;
}

.v-expansion-panel-text__wrapper {
    padding: 12px 16px 16px !important;
}

/* Alerts - more compact */
.v-alert {
    padding: 12px 16px !important;
}

.v-alert--density-compact {
    padding: 8px 12px !important;
}

/* Dividers - subtle */
.v-divider {
    opacity: 0.6 !important;
}

/* Navigation drawer */
.v-navigation-drawer {
    border-right: 1px solid var(--border-subtle) !important;
}

/* List items in navigation */
.v-list-item {
    transition: all var(--transition-base) !important;
    border-radius: var(--radius-md) !important;
    margin: 2px 8px !important;
}

.v-list-item:hover {
    background: var(--bg-hover) !important;
}

.v-list-item--active {
    background: linear-gradient(135deg, rgba(74, 144, 194, 0.15) 0%, rgba(74, 144, 194, 0.08) 100%) !important;
    border-left: 3px solid var(--primary-500) !important;
}

/* App bar */
.v-app-bar {
    border-bottom: 1px solid var(--border-subtle) !important;
}

/* Dialogs/modals */
.v-dialog > .v-overlay__content > .v-card {
    border: 1px solid var(--border-default) !important;
    box-shadow: var(--shadow-xl) !important;
}

/* Progress indicators */
.v-progress-linear {
    border-radius: var(--radius-full) !important;
    overflow: hidden;
}

/* Skeleton loaders - shimmer effect */
.v-skeleton-loader {
    background: var(--bg-base) !important;
}

.v-skeleton-loader__bone {
    background: linear-gradient(
        90deg,
        var(--bg-hover) 25%,
        var(--bg-elevated) 50%,
        var(--bg-hover) 75%
    ) !important;
    background-size: 200% 100% !important;
    animation: shimmer 1.5s infinite !important;
}

@keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}

/* Timeline styling */
.v-timeline-item__dot {
    box-shadow: var(--glow-primary) !important;
}

/* Snackbars */
.v-snackbar__wrapper {
    border-radius: var(--radius-lg) !important;
}

/* Tooltips */
.v-tooltip > .v-overlay__content {
    background: var(--bg-elevated) !important;
    border: 1px solid var(--border-default) !important;
    border-radius: var(--radius-md) !important;
    font-size: var(--text-sm) !important;
    box-shadow: var(--shadow-lg) !important;
}

/* ============================================
   UTILITY CLASSES
   ============================================ */

/* Text colors */
.text-primary-color { color: var(--text-primary) !important; }
.text-secondary-color { color: var(--text-secondary) !important; }
.text-muted-color { color: var(--text-muted) !important; }

/* Background utilities */
.bg-void { background: var(--bg-void) !important; }
.bg-deep { background: var(--bg-deep) !important; }
.bg-base { background: var(--bg-base) !important; }
.bg-elevated { background: var(--bg-elevated) !important; }

/* Border utilities */
.border-subtle { border-color: var(--border-subtle) !important; }
.border-default { border-color: var(--border-default) !important; }

/* Glow utilities */
.glow-primary { box-shadow: var(--glow-primary) !important; }
.glow-accent { box-shadow: var(--glow-accent) !important; }
.glow-success { box-shadow: var(--glow-success) !important; }

/* Status indicator - pulsing dot */
.status-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
}

.status-indicator--active {
    background: #10B981;
    animation: pulse 2s infinite;
}

.status-indicator--warning {
    background: #F59E0B;
    animation: pulse 2s infinite;
}

.status-indicator--error {
    background: #EF4444;
    animation: pulse 1.5s infinite;
}

.status-indicator--inactive {
    background: var(--text-muted);
}

@keyframes pulse {
    0%, 100% {
        opacity: 1;
        transform: scale(1);
    }
    50% {
        opacity: 0.6;
        transform: scale(1.1);
    }
}

/* ============================================
   ACCESSIBILITY
   ============================================ */

/* Respect reduced motion preferences */
@media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
    }

    .status-indicator--active,
    .status-indicator--warning,
    .status-indicator--error {
        animation: none !important;
    }

    .v-skeleton-loader__bone {
        animation: none !important;
    }
}

/* Focus visible styles for keyboard navigation */
:focus-visible {
    outline: 2px solid var(--primary-500) !important;
    outline-offset: 2px !important;
}

/* ============================================
   SCROLLBAR STYLING
   ============================================ */

/* Custom scrollbar for webkit browsers */
::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}

::-webkit-scrollbar-track {
    background: transparent;
}

::-webkit-scrollbar-thumb {
    background: var(--border-default);
    border-radius: var(--radius-full);
}

::-webkit-scrollbar-thumb:hover {
    background: var(--text-muted);
}

/* Firefox scrollbar */
* {
    scrollbar-width: thin;
    scrollbar-color: var(--border-default) transparent;
}

/* ============================================
   PAGE TRANSITIONS
   ============================================ */

.page-enter-active,
.page-leave-active {
    transition: opacity var(--transition-base), transform var(--transition-base);
}

.page-enter-from {
    opacity: 0;
    transform: translateY(10px);
}

.page-leave-to {
    opacity: 0;
    transform: translateY(-10px);
}

/* Fade transition */
.fade-enter-active,
.fade-leave-active {
    transition: opacity var(--transition-base);
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>
