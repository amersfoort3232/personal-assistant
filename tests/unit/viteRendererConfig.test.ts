import { describe, expect, it } from 'vitest';
import rendererConfig from '../../vite.renderer.config';

describe('renderer development server configuration', () => {
  it('disables HMR so the renderer does not open a WebSocket blocked by its CSP', () => {
    expect(rendererConfig.server).toEqual(expect.objectContaining({ hmr: false }));
  });
});
