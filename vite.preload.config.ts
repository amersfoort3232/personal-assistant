import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron', ...builtinModules],
    },
  },
});
