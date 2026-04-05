import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri expects a fixed port for dev server — don't change this
const TAURI_DEV_HOST = process.env.TAURI_DEV_HOST;

export default defineConfig({
    plugins: [react()],

    // Prevent Vite from obscuring Rust errors
    clearScreen: false,

    server: {
        // Tauri needs a fixed port — use 5199 to avoid conflicts with other Vite servers
        port: 5199,
        strictPort: true,
        // Allow Tauri dev host for mobile dev
        host: TAURI_DEV_HOST || false,
        hmr: TAURI_DEV_HOST
            ? { protocol: 'ws', host: TAURI_DEV_HOST, port: 5174 }
            : undefined,
    },
});
