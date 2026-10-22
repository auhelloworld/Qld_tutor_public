import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Guards against props that exist everywhere except on screen. */

const SRC = path.resolve(__dirname, '..');
const INTENTIONALLY_UNUSED: Record<string, { props: string[]; reason: string }> = {};

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Props declared on a *Props interface but never destructured by the component. */
function unusedProps(source: string): Record<string, string[]> {
  const findings: Record<string, string[]> = {};
  const interfaceRe = /(?:interface|type)\s+(\w*Props)\s*=?\s*\{([\s\S]*?)\n\}/g;
  let match: RegExpExecArray | null;
  while ((match = interfaceRe.exec(source)) !== null) {
    const [, name, body] = match;
    const declared = [...body.matchAll(/^\s*(\w+)\??\s*:/gm)].map((m) => m[1]);
    if (declared.length === 0) continue;
    const signature = new RegExp(`\\(\\s*\\{([\\s\\S]*?)\\}\\s*:\\s*${name}`).exec(source);
    if (!signature) continue;
    const destructured = new Set(signature[1].match(/\w+/g) ?? []);
    const missing = declared.filter((prop) => !destructured.has(prop));
    if (missing.length > 0) findings[name] = missing;
  }
  return findings;
}

describe('UI entry points are reachable', () => {
  const files = tsxFiles(SRC);
  /** Every JSX attribute name used anywhere, so we can tell a real prop from a
   * field of some nested data type that happens to sit in a *Props file. */
  const passedAttributes = new Set<string>();
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(/(?:^|\s)([a-zA-Z_]\w*)=\{/g)) passedAttributes.add(m[1]);
  }

  it('finds components to inspect', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('has no undocumented props that a parent passes but the child ignores', () => {
    const problems: string[] = [];
    for (const file of files) {
      const relative = path.relative(SRC, file).split(path.sep).join('/');
      const findings = unusedProps(fs.readFileSync(file, 'utf8'));
      const allowed = new Set(INTENTIONALLY_UNUSED[relative]?.props ?? []);
      for (const [interfaceName, missing] of Object.entries(findings)) {
        const undocumented = missing.filter(
          (prop) => !allowed.has(prop) && passedAttributes.has(prop)
        );
        if (undocumented.length > 0) {
          problems.push(`${relative} (${interfaceName}): ${undocumented.join(', ')}`);
        }
      }
    }
    expect(
      problems,
      'These props are declared and passed but never destructured, so the feature ' +
        'they gate cannot be reached. Either wire them up, delete them, or add them ' +
        'to INTENTIONALLY_UNUSED with a reason.'
    ).toEqual([]);
  });

  it('has no standalone Hint API wiring in public frontend source', () => {
    const banned = /\b(?:tutorHint|onGetHint|onHint|onStuck)\b/;
    const problems = files
      .filter((file) => banned.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file).split(path.sep).join('/'));
    expect(problems).toEqual([]);
  });
});
