import { defineConfig } from 'vite';

export default defineConfig({
    base: './', // Use relative paths for deployment
    server: {
        port: 3000,
        open: true,
        host: true // Expose to network
    }
});

