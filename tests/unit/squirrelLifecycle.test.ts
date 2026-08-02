import { describe, expect, it } from 'vitest';
import { handleSquirrelLifecycleEvent } from '../../src/main/app/squirrelLifecycle';

function captureLifecycle(argv: string[]) {
  const updateArguments: string[][] = [];
  const quitDelays: number[] = [];
  const handled = handleSquirrelLifecycleEvent(argv, {
    executableName: 'personal-assistant.exe',
    runUpdate: (args) => updateArguments.push(args),
    scheduleQuit: (delayMs) => quitDelays.push(delayMs),
  });
  return { handled, quitDelays, updateArguments };
}

describe('Squirrel lifecycle events', () => {
  it.each([
    ['--squirrel-install', '--createShortcut'],
    ['--squirrel-updated', '--createShortcut'],
    ['--squirrel-uninstall', '--removeShortcut'],
  ])('handles %s before normal app startup', (event, updateCommand) => {
    expect(captureLifecycle(['personal-assistant.exe', event])).toEqual({
      handled: true,
      quitDelays: [1_000],
      updateArguments: [[updateCommand, 'personal-assistant.exe']],
    });
  });

  it('quits an obsolete build without running Update.exe', () => {
    expect(captureLifecycle(['personal-assistant.exe', '--squirrel-obsolete'])).toEqual({
      handled: true,
      quitDelays: [0],
      updateArguments: [],
    });
  });

  it('leaves ordinary launches untouched', () => {
    expect(captureLifecycle(['personal-assistant.exe'])).toEqual({
      handled: false,
      quitDelays: [],
      updateArguments: [],
    });
  });
});
