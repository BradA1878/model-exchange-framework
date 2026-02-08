import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';

import App from './App.vue';
import router from './router';
import './plugins/axios'; // Configure axios with base URL
import { neuralDark, neuralLight } from './plugins/theme';

// Create Vuetify instance with dual theme support
const vuetify = createVuetify({
    components,
    directives,
    theme: {
        defaultTheme: 'neuralDark',
        themes: {
            neuralDark,
            neuralLight,
        },
    },
    icons: {
        defaultSet: 'mdi',
    },
    defaults: {
        // Global component defaults for consistent styling
        VCard: {
            elevation: 0,
            rounded: 'lg',
        },
        VBtn: {
            rounded: 'lg',
        },
        VTextField: {
            variant: 'outlined',
            density: 'comfortable',
        },
        VSelect: {
            variant: 'outlined',
            density: 'comfortable',
        },
        VChip: {
            rounded: 'lg',
        },
    },
});

// Create Pinia store
const pinia = createPinia();

// Create and mount the app
const app = createApp(App);

app.use(pinia);
app.use(router);
app.use(vuetify);

app.mount('#app');
