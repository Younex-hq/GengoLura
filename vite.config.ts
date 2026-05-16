import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Using relative base path for better compatibility with GitHub Pages
  server: {
    port: 3000,
  },
});
