import { describe, expect, it } from 'vitest';
import { selectUserDataPath } from '../../src/main/app/runtimeUserDataPath';

describe('runtime user-data path selection', () => {
  it('ignores the test override in a production build', () => {
    expect(selectUserDataPath(false, {
      PA_TEST_USER_DATA_PATH: 'C:\\temporary-e2e-profile',
    }, 'C:\\real-profile')).toBe('C:\\real-profile');
  });

  it('uses a non-empty test override in an E2E build', () => {
    expect(selectUserDataPath(true, {
      PA_TEST_USER_DATA_PATH: ' C:\\temporary-e2e-profile ',
    }, 'C:\\real-profile')).toBe('C:\\temporary-e2e-profile');
  });

  it('falls back to the normal path for an empty E2E override', () => {
    expect(selectUserDataPath(true, {
      PA_TEST_USER_DATA_PATH: '   ',
    }, 'C:\\real-profile')).toBe('C:\\real-profile');
  });
});
