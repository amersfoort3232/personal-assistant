import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    __PA_E2E_BUILD__: JSON.stringify(process.env.PA_E2E_BUILD === '1'),
    __PA_PRODUCTION_BUILD__: JSON.stringify(
      process.env.PA_PRODUCTION === '1' && process.env.PA_E2E_BUILD !== '1',
    ),
    GOOGLE_OAUTH_CLIENT_ID: JSON.stringify(process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''),
    GOOGLE_OAUTH_CLIENT_SECRET: JSON.stringify(process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? ''),
  },
  build: {
    rollupOptions: {
      external: ['electron', ...builtinModules],
    },
  },
});
