import * as fs from 'fs';
import * as path from 'path';

export type AuthoredBankGate = 'production' | 'scratch';

export function authoredBankGate(): AuthoredBankGate {
  return process.env.AUTHORED_BANK_GATE === 'scratch' ? 'scratch' : 'production';
}

export function authoredBankFiles(
  repoRoot: string,
  gate: AuthoredBankGate = authoredBankGate(),
): string[] {
  const directory = gate === 'production' ? 'data' : 'scratch';
  const pattern = gate === 'production' ? /^exercise_.*\.json$/ : /^qldtutor_.*\.json$/;
  const fullDirectory = path.join(repoRoot, directory);
  if (!fs.existsSync(fullDirectory)) return [];

  return fs.readdirSync(fullDirectory)
    .filter((name) => pattern.test(name))
    .filter((name) => !/artefact|bak|pre_|pre-|pre_repair|pre_latex|pre-answersplit/.test(name))
    .map((name) => path.join(fullDirectory, name))
    .sort();
}
