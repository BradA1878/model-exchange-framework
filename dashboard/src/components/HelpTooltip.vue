<script setup lang="ts">
/**
 * HelpTooltip Component
 *
 * A reusable tooltip component that shows help text on hover with an optional
 * link to the full documentation on http://mxf.dev
 *
 * Usage:
 * <HelpTooltip text="Brief help text" docLink="http://mxf.dev/sdk/channels.html" />
 */

interface Props {
    // The tooltip text to display on hover
    text: string;
    // Optional URL to the documentation page
    docLink?: string;
    // Icon to use (default: mdi-help-circle-outline)
    icon?: string;
    // Size of the icon (default: 16)
    size?: number | string;
    // Color of the icon (default: uses theme muted color)
    color?: string;
}

const props = withDefaults(defineProps<Props>(), {
    icon: 'mdi-help-circle-outline',
    size: 16,
    color: undefined
});

const openDocs = (): void => {
    if (props.docLink) {
        window.open(props.docLink, '_blank', 'noopener,noreferrer');
    }
};
</script>

<template>
    <v-tooltip location="top" max-width="300">
        <template #activator="{ props: tooltipProps }">
            <v-icon
                v-bind="tooltipProps"
                :icon="props.icon"
                :size="props.size"
                :color="props.color || 'grey'"
                class="help-tooltip-icon"
                :class="{ 'cursor-pointer': !!props.docLink }"
            />
        </template>
        <div class="tooltip-content">
            <p class="tooltip-text">{{ props.text }}</p>
            <a
                v-if="props.docLink"
                class="tooltip-link"
                @click.stop="openDocs"
            >
                <v-icon size="12" class="mr-1">mdi-open-in-new</v-icon>
                View documentation
            </a>
        </div>
    </v-tooltip>
</template>

<style scoped>
.help-tooltip-icon {
    opacity: 0.6;
    transition: opacity 0.2s ease;
    margin-left: 4px;
    vertical-align: middle;
}

.help-tooltip-icon:hover {
    opacity: 1;
}

.cursor-pointer {
    cursor: pointer;
}

.tooltip-content {
    padding: 4px 0;
}

.tooltip-text {
    margin: 0 0 8px 0;
    line-height: 1.4;
}

.tooltip-text:last-child {
    margin-bottom: 0;
}

.tooltip-link {
    display: inline-flex;
    align-items: center;
    color: var(--primary-400, #60A5FA);
    font-size: 0.85rem;
    cursor: pointer;
    text-decoration: none;
    transition: color 0.2s ease;
}

.tooltip-link:hover {
    color: var(--primary-300, #93C5FD);
    text-decoration: underline;
}
</style>
