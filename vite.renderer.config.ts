import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

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
  root: 'src',
  plugins: [react(), removeDisabledHmrClient()],
  server: { hmr: false },
});
