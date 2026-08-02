type SquirrelLifecycleDependencies = {
  executableName: string;
  runUpdate(args: string[]): void;
  scheduleQuit(delayMs: number): void;
};

export function handleSquirrelLifecycleEvent(
  argv: readonly string[],
  dependencies: SquirrelLifecycleDependencies,
): boolean {
  const event = argv[1];
  if (event === '--squirrel-install' || event === '--squirrel-updated') {
    dependencies.runUpdate(['--createShortcut', dependencies.executableName]);
    dependencies.scheduleQuit(1_000);
    return true;
  }
  if (event === '--squirrel-uninstall') {
    dependencies.runUpdate(['--removeShortcut', dependencies.executableName]);
    dependencies.scheduleQuit(1_000);
    return true;
  }
  if (event === '--squirrel-obsolete') {
    dependencies.scheduleQuit(0);
    return true;
  }
  return false;
}
