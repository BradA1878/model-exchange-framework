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
import { mxfTheme } from './plugins/theme';

// Create Vuetify instance with all components
const vuetify = createVuetify({
    components,
    directives,
    theme: {
        defaultTheme: 'mxfTheme',
        themes: {
            mxfTheme,
        },
    },
    icons: {
        defaultSet: 'mdi',
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
