import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

describe('renderer Vite development server', () => {
  let server: ViteDevServer | undefined;

  afterEach(async () => {
    await server?.close();
  });

  it('serves the renderer without a dev client that would violate connect-src none', async () => {
    server = await createServer({
      configFile: resolve('vite.renderer.config.ts'),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0 },
    });
    await server.listen();
    const { port } = server.httpServer?.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/`);
    const html = await response.text();
    const rendererModule = await (
      await fetch(`http://127.0.0.1:${port}/renderer.tsx`)
    ).text();
    const cssModuleUrls = [
      ...rendererModule.matchAll(/["']([^"']+\.css(?:\?[^"']*)?)["']/gu),
    ].map((match) => match[1]);
    const cssModuleBodies = await Promise.all(
      cssModuleUrls.map(async (url) =>
        (await fetch(new URL(url, response.url))).text(),
      ),
    );

    expect(response.ok).toBe(true);
    expect(html).toContain('src="/renderer.tsx"');
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toContain('/@vite/client');
    expect(html).not.toContain('@react-refresh');
    expect(cssModuleBodies.join('\n')).not.toContain('/@vite/client');

    const stylesheetHref = html.match(
      /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/>/u,
    )?.[1];
    expect(stylesheetHref).toBe('/renderer/styles.css');
    const stylesheetResponse = await fetch(
      new URL(stylesheetHref as string, response.url),
      { headers: { Accept: 'text/css', 'Sec-Fetch-Dest': 'style' } },
    );
    expect(stylesheetResponse.headers.get('content-type')).toContain('text/css');
    expect(await stylesheetResponse.text()).not.toContain('/@vite/client');
  });

  it('leaves the Vite dev client in place when HMR is enabled', async () => {
    server = await createServer({
      configFile: resolve('vite.renderer.config.ts'),
      logLevel: 'silent',
      server: { host: '127.0.0.1', hmr: true, port: 0 },
    });
    await server.listen();
    const { port } = server.httpServer?.address() as AddressInfo;

    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();

    expect(html).toContain('/@vite/client');
  });
});
