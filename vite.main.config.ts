import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    GOOGLE_OAUTH_CLIENT_ID: JSON.stringify(process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''),
    GOOGLE_OAUTH_CLIENT_SECRET: JSON.stringify(process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? ''),
  },
  build: {
    rollupOptions: {
      external: ['electron', ...builtinModules],
    },
  },
});
