import path from 'node:path';
import { describe, expect, it } from 'vitest';

import config from '../../vite.renderer.config';

describe('renderer Vite output', () => {
  it('writes beneath the root .vite directory that Forge packages', () => {
    if (typeof config === 'function' || config instanceof Promise || Array.isArray(config)) {
      throw new Error('Expected an object Vite config');
    }

    expect(path.resolve(config.build?.outDir ?? '')).toBe(
      path.resolve('.vite', 'renderer', 'main_window'),
    );
    expect(config.build?.emptyOutDir).toBe(true);
    expect(config.base).toBe('./');
  });
});
