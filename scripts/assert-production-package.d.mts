export function assertProductionAsar(
  asarPath: string,
  secretValues?: string[],
): Promise<void>;

export function productionCredentialValues(environment: NodeJS.ProcessEnv): Array<
  string | undefined
>;
