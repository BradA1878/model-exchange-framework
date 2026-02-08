# MXF Workbench Dashboard — Style Remediation Guide

> **Purpose**: Handoff document for Claude Code to complete the internal view styling across the MXF Dashboard.
> The outer shell (DashboardLayout.vue, sidebar, app bar) and parent views (Dashboard.vue, Analytics.vue, Channels.vue) have been restyled to a cohesive "neural command center" aesthetic. The **internal/child views** still use generic Vuetify defaults and need to be brought into alignment.

---

## 1. Design System Reference

All views should use the existing CSS custom properties defined in `App.vue`. **Never hardcode colors, fonts, spacing, or border-radius values.** Always reference these tokens.

### 1.1 Color Tokens (Dark Theme — Primary)

```css
--bg-void: #07090d;        /* Deepest background (nav drawer) */
--bg-deep: #0c1117;        /* Page background */
--bg-base: #121920;        /* Card/panel background */
--bg-elevated: #1a2330;    /* Modals, dropdowns, table headers */
--bg-hover: #232d3d;       /* Hover states */

--primary-400: #6BA3D6;    /* Light blue accent */
--primary-500: #4A90C2;    /* Primary blue */
--primary-600: #3A7CAB;    /* Darker primary */
--primary-700: #2C5F82;    /* Darkest primary */

--accent-500: #22D3EE;     /* Cyan accent */

--text-primary: #E8EDF2;   /* Headings, important values */
--text-secondary: #94A3B8; /* Body text, labels */
--text-muted: #64748B;     /* Tertiary text, hints */

--border-subtle: rgba(148, 163, 184, 0.08);  /* Card borders, dividers */
--border-default: rgba(148, 163, 184, 0.15); /* Hover borders, inputs */
--border-strong: rgba(148, 163, 184, 0.25);  /* Active/focus borders */

--glow-primary: 0 0 20px rgba(74, 144, 194, 0.3);
--glow-accent: 0 0 20px rgba(34, 211, 238, 0.3);
--glow-success: 0 0 20px rgba(16, 185, 129, 0.3);
```

### 1.2 Semantic Accent Colors (Per-Component)

The parent views define local accent variables. Child views should follow this pattern:

```css
--ch-blue: #4A90C2;   /* Primary actions, active states */
--ch-green: #10B981;  /* Success, active status */
--ch-amber: #F59E0B;  /* Warnings, pending */
--ch-cyan: #22D3EE;   /* Info, secondary metrics */
--ch-red: #EF4444;    /* Errors, destructive actions */
```

### 1.3 Typography

```css
--font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
--font-mono: 'JetBrains Mono', ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace;

/* Scale */
--text-xs: 0.75rem;    /* 12px — badges, labels, uppercase headers */
--text-sm: 0.875rem;   /* 14px — body text, buttons */
--text-base: 1rem;     /* 16px — default body */
--text-lg: 1.125rem;   /* 18px — section titles */
--text-xl: 1.25rem;    /* 20px — page titles */
--text-2xl: 1.5rem;    /* 24px — hero numbers */
--text-3xl: 2rem;      /* 32px — dashboard big stats */
```

### 1.4 Spacing

```css
--space-1: 0.25rem;  --space-2: 0.5rem;   --space-3: 0.75rem;
--space-4: 1rem;     --space-5: 1.25rem;  --space-6: 1.5rem;
--space-8: 2rem;     --space-10: 2.5rem;  --space-12: 3rem;
```

### 1.5 Border Radius

```css
--radius-sm: 4px;    --radius-md: 8px;    --radius-lg: 12px;
--radius-xl: 16px;   --radius-2xl: 24px;  --radius-full: 9999px;
```

### 1.6 Transitions

```css
--transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-base: 200ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-slow: 300ms cubic-bezier(0.4, 0, 0.2, 1);
```

---

## 2. Established Patterns (What "Done" Looks Like)

These patterns are already implemented in the parent views (Analytics.vue, Channels.vue) and should be replicated in all child/internal views.

### 2.1 Header Strip Pattern

Every view's top section uses this pattern — a flex row with title on the left and action buttons on the right, separated by a bottom border:

```css
.xx-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: var(--space-4);
}

.xx-header__title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
    margin: 0;
}

/* Slash divider between title and subtitle */
.xx-header__divider {
    color: var(--text-muted);
    opacity: 0.4;
    font-weight: 300;
}

.xx-header__sub {
    font-size: var(--text-sm);
    color: var(--text-muted);
}
```

### 2.2 Metric Card Pattern

Small stat tiles with a left accent stripe:

```css
.xx-metric {
    position: relative;
    padding: var(--space-3) var(--space-4);
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    transition: all var(--transition-base);
    overflow: hidden;
}

/* Left accent stripe via ::before */
.xx-metric::before {
    content: '';
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 3px;
    border-radius: 3px 0 0 3px;
    opacity: 0.6;
    transition: opacity var(--transition-base);
}

/* Color variants via data-accent attribute */
.xx-metric[data-accent="blue"]::before  { background: var(--ch-blue); }
.xx-metric[data-accent="green"]::before { background: var(--ch-green); }
.xx-metric[data-accent="amber"]::before { background: var(--ch-amber); }
.xx-metric[data-accent="cyan"]::before  { background: var(--ch-cyan); }

.xx-metric:hover {
    border-color: var(--border-default);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.xx-metric__label {
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}

.xx-metric__number {
    font-family: var(--font-mono);
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
    letter-spacing: -0.02em;
}

.xx-metric__unit {
    font-size: 0.6em;
    font-weight: 500;
    opacity: 0.7;
}
```

### 2.3 Ghost Button Pattern

```css
.xx-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-base);
    border: 1px solid transparent;
    white-space: nowrap;
    font-family: var(--font-sans);
}

.xx-btn--ghost {
    background: transparent;
    border-color: var(--border-default);
    color: var(--text-secondary);
}

.xx-btn--ghost:hover {
    color: var(--text-primary);
    border-color: var(--ch-blue);
    background: rgba(74, 144, 194, 0.08);
}

.xx-btn--primary {
    background: var(--ch-blue);
    color: #fff;
    border-color: var(--ch-blue);
}

.xx-btn--primary:hover {
    background: #3a7db0;
    box-shadow: 0 2px 8px rgba(74, 144, 194, 0.3);
}
```

### 2.4 Card Container Pattern

Used for content sections (filter panels, data tables, chart wrappers):

```css
.xx-card {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition: border-color var(--transition-base);
}

.xx-card:hover {
    border-color: var(--border-default);
}

/* Card header with title + actions */
.xx-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
}

.xx-card__title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
}

.xx-card__body {
    padding: var(--space-5);
}
```

### 2.5 Tab Navigation Pattern

Segmented tab bar with bottom accent indicator on active tab:

```css
.xx-tabs {
    display: flex;
    gap: 1px;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    margin-bottom: var(--space-4);
}

.xx-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-2);
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: 500;
    font-family: var(--font-sans);
    cursor: pointer;
    transition: all var(--transition-base);
    position: relative;
}

.xx-tab:hover:not(.xx-tab--active) {
    color: var(--text-primary);
    background: var(--bg-hover);
}

.xx-tab--active {
    color: var(--ch-blue);
    background: linear-gradient(180deg, transparent 0%, rgba(74, 144, 194, 0.08) 100%);
}

.xx-tab--active::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 20%; right: 20%;
    height: 2px;
    background: var(--ch-blue);
    border-radius: 2px 2px 0 0;
}
```

### 2.6 Empty State Pattern

```css
.xx-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-12) var(--space-4);
    text-align: center;
}

.xx-empty-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin: var(--space-3) 0 var(--space-1);
}

.xx-empty-sub {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin: 0;
    max-width: 300px;
    line-height: 1.5;
}
```

### 2.7 Table Section Labels (Uppercase Mini-Headers)

```css
.xx-section-label {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}
```

### 2.8 Mono Font for Values

All numeric values, IDs, durations, keys, and code-like content should use:

```css
font-family: var(--font-mono);
```

---

## 3. Files Already Styled (COMPLETED)

These files have been restyled and use the patterns above. **Do not re-style these** — they are the reference implementations.

| File | Status | Notes |
|------|--------|-------|
| `src/App.vue` | ✅ Done | Global tokens, Vuetify overrides, utility classes |
| `src/layouts/DashboardLayout.vue` | ✅ Done | Sidebar nav, app bar, breadcrumbs, search dialog |
| `src/views/Dashboard.vue` | ✅ Done | `cc-` prefix BEM classes, metrics grid, feed panels |
| `src/views/Analytics.vue` | ✅ Done | `an-` prefix, header/metrics/tabs/overview cards |
| `src/views/analytics/Data.vue` | ✅ Done | `an-data__` prefix, filters, data table, empty state |
| `src/views/analytics/Charts.vue` | ✅ Done | `an-charts__` prefix, time range pills, chart cards, channel/agent panels |
| `src/views/Channels.vue` | ✅ Done | `ch-` prefix, channel selector, metrics, tabs, create dialog (dialog still uses raw Vuetify — see section 4) |

---

## 4. Files That Need Styling (TODO)

These views still use either raw Vuetify components with no scoped styles, or have incomplete/inconsistent styling that doesn't match the design system.

### 4.1 Channel Sub-Views (HIGH PRIORITY)

These are the views rendered inside the Channels.vue `<router-view>` when a user clicks through the tab navigation. They are the most visible internal pages and look noticeably clunky compared to their parent.

#### `src/views/channels/Memory.vue` (621 lines)
**Current state**: Has *some* token usage (`var(--bg-base)`, `var(--font-mono)`) but is inconsistent. Uses `!important` overrides and raw Vuetify cards. The stat cards and memory list items need the metric card pattern and card container pattern.

**What to fix**:
- Replace raw `v-card` usage with custom-classed card containers following the card pattern (section 2.4)
- Stat items at the top should follow the metric card pattern (section 2.2) with accent stripes
- Memory list items (expandable cards) should use `--bg-base` background, `--border-subtle` borders, and the hover lift effect (`translateY(-2px)`, `box-shadow: var(--shadow-md)`)
- Action buttons (Create, Refresh, Delete) should use the ghost/primary button pattern (section 2.3)
- Filter/search section should match Data.vue's filter pattern
- Metadata labels should use `--text-xs`, uppercase, `letter-spacing: 0.06em`
- All numeric values should use `var(--font-mono)`
- Remove all `!important` overrides where possible — use scoped specificity instead

#### `src/views/channels/Context.vue` (818 lines)
**Current state**: Uses hardcoded values like `rgba(255, 255, 255, 0.1)`, `rgba(255, 255, 255, 0.02)`, and literal font stacks like `'Monaco', 'Menlo', 'Ubuntu Mono', monospace`. Does not use design tokens.

**What to fix**:
- Replace ALL hardcoded `rgba(255, 255, 255, ...)` with `var(--border-subtle)`, `var(--border-default)`, etc.
- Replace literal font stacks with `var(--font-mono)` and `var(--font-sans)`
- Replace hardcoded spacing (`0.75rem`, `0.5rem`) with spacing tokens
- Context items should use the card container pattern
- Stat section should use the metric card pattern
- Apply the header strip pattern if not already present
- Add hover transitions matching the established pattern

#### `src/views/channels/Docs.vue` (627 lines)
**Current state**: Same issues as Context.vue — hardcoded values, no design tokens.

**What to fix**:
- Same token replacement as Context.vue
- Document list items should use card pattern with hover lift
- Upload/action area should use ghost/primary button patterns
- Stat section → metric card pattern
- Empty state → empty state pattern

#### `src/views/channels/Tools.vue` (1329 lines)
**Current state**: Uses hardcoded values like `rgba(255, 255, 255, 0.02)`, literal font stacks. Has some structure but doesn't match the design system.

**What to fix**:
- Token replacement throughout
- Tool list items should be cards with the hover lift pattern
- Tool checkboxes/toggles should be styled consistently
- `.tool-name` should use `var(--font-mono)` instead of literal font names
- Stat section → metric card pattern
- Action buttons → ghost/primary button pattern

#### `src/views/channels/Tasks.vue` (879 lines)
**Current state**: Has some token usage but incomplete. Task cards have basic hover but could be more polished.

**What to fix**:
- Ensure all hardcoded values are replaced with tokens
- Task cards should use the card container pattern with status-colored left accent stripes (similar to metric cards but for task status: green=completed, amber=pending, red=failed)
- Stat section should use consistent metric card pattern
- Timeline/list view should have clean row styling with subtle separators

#### `src/views/channels/Agents.vue` (2493 lines)
**Current state**: The largest sub-view. Has extensive custom styles with some token usage. The agent cards, configuration panels, and tool assignment sections need consistency work.

**What to fix**:
- Verify all values use design tokens (check for any remaining hardcoded colors/spacing)
- Agent cards should be consistent with the card container pattern
- Configuration sections (model selection, tools, system prompts) should use the card pattern with section headers
- The empty state card uses dashed border — keep that but ensure token colors
- Status indicators should use the established dot pattern (`.status-indicator--active` etc from App.vue globals)
- Form inputs within agent config should inherit the Vuetify overrides from App.vue cleanly

### 4.2 Account View (MEDIUM PRIORITY)

#### `src/views/Account.vue` (841 lines)
**Current state**: Uses hardcoded values like `rgba(0, 0, 0, 0.3)`, `rgba(255, 255, 255, 0.1)`, and literal font stacks.

**What to fix**:
- Full token replacement
- Profile/account sections should use the card container pattern
- API key display should use `var(--font-mono)`
- Code examples should use `var(--bg-elevated)` with `var(--border-subtle)` borders
- Settings toggles/forms should inherit cleanly from Vuetify overrides
- Action buttons → ghost/primary button pattern

### 4.3 Channels.vue Create Dialog (LOW-MEDIUM PRIORITY)

The create channel dialog in `Channels.vue` still uses raw Vuetify `v-card`, `v-card-title`, `v-card-text`, `v-card-actions` with default styling. While the Vuetify overrides in App.vue help somewhat, the dialog should be upgraded.

**What to fix**:
- The key generation section card uses inline styles (`style="background-color: rgba(var(--v-theme-primary), 0.05)"`) — replace with proper classes
- The dialog's internal layout should use consistent spacing tokens
- Key ID / Secret Key fields should use mono font
- The info alert should match the design system
- Form validation states should use accent colors consistently

### 4.4 Admin Views (LOW PRIORITY — but same patterns apply)

The `src/views/admin/` directory contains 14 sub-views. These should eventually follow the same patterns, but they are lower priority since they're behind admin auth. When styling these:

- Use the same BEM naming convention with a view-specific prefix (e.g., `adm-users__`, `adm-logs__`)
- Apply all the same patterns: header strip, metric cards, card containers, ghost buttons, empty states
- Tables should use the established table override styles from Data.vue
- Form-heavy views (Config, Security, Webhooks) should rely on the Vuetify form overrides in App.vue

---

## 5. BEM Naming Convention

Each view uses a short prefix to scope its styles. Follow this convention:

| View | Prefix | Example |
|------|--------|---------|
| Dashboard | `cc-` | `.cc-metrics`, `.cc-feed` |
| Analytics | `an-` | `.an-header`, `.an-metrics` |
| Analytics/Data | `an-data__` | `.an-data__filters`, `.an-data__table-wrap` |
| Analytics/Charts | `an-charts__` | `.an-charts__card`, `.an-charts__range-btn` |
| Channels | `ch-` | `.ch-header`, `.ch-metrics`, `.ch-tabs` |
| Channels/Memory | `ch-mem__` | `.ch-mem__list`, `.ch-mem__card` |
| Channels/Context | `ch-ctx__` | `.ch-ctx__item`, `.ch-ctx__meta` |
| Channels/Docs | `ch-docs__` | `.ch-docs__list`, `.ch-docs__upload` |
| Channels/Tools | `ch-tools__` | `.ch-tools__list`, `.ch-tools__item` |
| Channels/Tasks | `ch-tasks__` | `.ch-tasks__list`, `.ch-tasks__card` |
| Channels/Agents | `ch-agents__` | `.ch-agents__card`, `.ch-agents__config` |
| Account | `acct-` | `.acct-header`, `.acct-section` |

---

## 6. Anti-Patterns to Eliminate

When refactoring, look for and fix these issues:

### 6.1 Hardcoded Colors
```css
/* ❌ BAD */
border-top: 1px solid rgba(255, 255, 255, 0.1);
background: rgba(255, 255, 255, 0.02);
color: rgba(var(--v-theme-primary), 0.05);

/* ✅ GOOD */
border-top: 1px solid var(--border-subtle);
background: var(--bg-hover);
color: var(--primary-500);
```

### 6.2 Hardcoded Font Stacks
```css
/* ❌ BAD */
font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
font-family: 'Fira Code', 'Consolas', monospace;

/* ✅ GOOD */
font-family: var(--font-mono);
```

### 6.3 Hardcoded Spacing
```css
/* ❌ BAD */
padding: 0.75rem;
gap: 0.5rem;
margin-top: 1rem;

/* ✅ GOOD */
padding: var(--space-3);
gap: var(--space-2);
margin-top: var(--space-4);
```

### 6.4 Hardcoded Border Radius
```css
/* ❌ BAD */
border-radius: 8px;

/* ✅ GOOD */
border-radius: var(--radius-md);
```

### 6.5 Excessive !important
The Vuetify overrides in App.vue use `!important` because they're fighting framework specificity. Scoped component styles should NOT need `!important` in most cases. If you find yourself needing it, use `:deep()` selectors for Vuetify component internals instead:

```css
/* ❌ BAD */
.my-card {
    background: var(--bg-base) !important;
}

/* ✅ GOOD — use scoped class specificity */
.ch-mem__card {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
}

/* ✅ OK — :deep() for Vuetify internals */
.ch-mem__table :deep(.v-data-table__thead th) {
    background: var(--bg-elevated);
}
```

---

## 7. Implementation Strategy

### Recommended order of operations:

1. **Channel sub-views first** (Memory → Context → Docs → Tools → Tasks → Agents) — these are the most visible clunky views
2. **Account.vue** — visible to all users
3. **Channels.vue dialog cleanup** — polish pass
4. **Admin views** — if time permits

### For each file:

1. Read the full file to understand the template structure and data bindings
2. **Do NOT change any `<script>` logic or template data bindings** — only modify `<template>` class names/structure and `<style>` blocks
3. Add/rename CSS classes using the BEM prefix for that view
4. Replace all hardcoded values with design tokens
5. Apply the established patterns (header, metrics, cards, buttons, empty states)
6. Ensure responsive breakpoints are included (768px and 480px at minimum)
7. Test that scoped styles don't leak or conflict with parent view styles

### Key principle:
The goal is **visual consistency**, not reinvention. Every internal view should feel like it belongs to the same application as Dashboard.vue, Analytics.vue, and Channels.vue. Same spacing rhythm, same card treatment, same typography hierarchy, same interaction patterns.

---

## 8. Quick Reference: CSS Variable Cheat Sheet

| Need | Token |
|------|-------|
| Card background | `var(--bg-base)` |
| Card border | `1px solid var(--border-subtle)` |
| Card hover border | `var(--border-default)` |
| Card radius | `var(--radius-lg)` |
| Page background | `var(--bg-deep)` |
| Modal/elevated bg | `var(--bg-elevated)` |
| Hover bg | `var(--bg-hover)` |
| Primary text | `var(--text-primary)` |
| Body text | `var(--text-secondary)` |
| Hint/label text | `var(--text-muted)` |
| Primary blue | `var(--primary-500)` or `#4A90C2` local var |
| Success green | `#10B981` |
| Warning amber | `#F59E0B` |
| Error red | `#EF4444` |
| Info cyan | `#22D3EE` or `var(--accent-500)` |
| Mono font | `var(--font-mono)` |
| Sans font | `var(--font-sans)` |
| Small text | `var(--text-xs)` (12px) |
| Body text size | `var(--text-sm)` (14px) |
| Section title | `var(--text-lg)` (18px) |
| Big number | `var(--text-2xl)` (24px) or `1.5rem` with mono |
| Tight spacing | `var(--space-2)` (8px) |
| Standard padding | `var(--space-4)` (16px) |
| Section gap | `var(--space-4)` (16px) |
| Card internal padding | `var(--space-5)` (20px) |
| Fast transition | `var(--transition-fast)` |
| Standard transition | `var(--transition-base)` |
| Hover lift | `transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);` |
| Card hover lift | `transform: translateY(-2px); box-shadow: var(--shadow-md);` |
