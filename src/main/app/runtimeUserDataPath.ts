type RuntimeEnvironment = {
  readonly PA_TEST_USER_DATA_PATH?: string;
};

export function selectUserDataPath(
  e2eBuild: boolean,
  environment: RuntimeEnvironment,
  defaultPath: string,
): string {
  if (!e2eBuild) return defaultPath;
  return environment.PA_TEST_USER_DATA_PATH?.trim() || defaultPath;
}
