import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

function removeDisabledHmrClient(): Plugin {
  let hmrDisabled = false;

  return {
    name: 'remove-disabled-hmr-client',
    apply: 'serve',
    configResolved(config) {
      hmrDisabled = config.server.hmr === false;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!hmrDisabled) return html;
        return html.replace(
          /\s*<script type="module" src="\/@vite\/client"><\/script>\s*/u,
          '\n',
        );
      },
    },
  };
}

export default defineConfig({
  base: './',
  root: 'src',
  build: {
    emptyOutDir: true,
    outDir: path.join(projectRoot, '.vite', 'renderer', 'main_window'),
  },
  plugins: [react(), removeDisabledHmrClient()],
  server: { hmr: false },
});
