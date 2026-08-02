import { extractFile, listPackage, statFile } from '@electron/asar';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ALWAYS_FORBIDDEN = [
  'fakeServiceFactory',
  'PA_E2E_FIXED_TASK_STUDY_REACT',
  'Study React',
  'Answer emails',
  'pa-e2e-placeholder-key-never-persisted',
];

export async function assertProductionAsar(asarPath, secretValues = []) {
  await access(asarPath);
  const forbidden = [
    ...ALWAYS_FORBIDDEN,
    ...secretValues.filter((value) => typeof value === 'string' && value.length > 0),
  ];
  const fileNames = listPackage(asarPath, { isPack: false }).filter((name) => {
    const archiveName = name.replace(/^[/\\]/u, '');
    const entry = statFile(asarPath, archiveName);
    return !('files' in entry) && !('link' in entry);
  });

  for (const fileName of fileNames) {
    const normalized = fileName.replaceAll('\\', '/');
    if (ALWAYS_FORBIDDEN.some((text) => normalized.includes(text))) {
      throw new Error(`Production ASAR contains forbidden content in path: ${normalized}`);
    }
    const archiveName = fileName.replace(/^[/\\]/u, '');
    const content = extractFile(asarPath, archiveName).toString('utf8');
    const matched = forbidden.find((text) => content.includes(text));
    if (matched) {
      throw new Error(`Production ASAR contains forbidden content in file: ${normalized}`);
    }
  }
}

export function productionCredentialValues(environment) {
  return [
    environment.DEEPSEEK_API_KEY,
    environment.GOOGLE_REFRESH_TOKEN,
  ];
}

async function findDefaultAsar() {
  const candidates = [
    path.resolve('out', 'Personal Assistant-win32-x64', 'resources', 'app.asar'),
    path.resolve('out', 'personal-assistant-win32-x64', 'resources', 'app.asar'),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known Forge output path.
    }
  }
  throw new Error('Production ASAR was not found under out/.');
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  const asarPath = process.argv[2] ? path.resolve(process.argv[2]) : await findDefaultAsar();
  const secrets = productionCredentialValues(process.env);
  await assertProductionAsar(asarPath, secrets);
  process.stdout.write(`Production ASAR passed: ${asarPath}\n`);
}
