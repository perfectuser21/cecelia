import { readFileSync } from 'node:fs';
import { resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
type Entry = { name?: string; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
type Lock = { packages: Record<string, Entry> };

// Resolve actual lock locations, rather than trusting a hoisted node's dev flag.
function runtimePaths(lock: Lock, start: string) {
  const queue = [{ key: start, chain: [start || 'api'] }];
  const found = new Map<string, string[]>();
  for (let i = 0; i < queue.length; i++) {
    const { key, chain } = queue[i];
    if (found.has(key)) continue;
    found.set(key, chain);
    const entry = lock.packages[key];
    if (!entry) throw new Error(`Missing lock entry: ${key}`);
    for (const name of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) {
      let parent = key;
      let target: string | undefined;
      while (true) {
        const candidate = posix.join(parent, 'node_modules', name);
        if (lock.packages[candidate]) { target = candidate; break; }
        if (!parent) break;
        parent = posix.dirname(parent);
        if (parent === '.') parent = '';
      }
      // Platform-optional dependencies may be absent from a generated lock.
      if (!target && !(name in (entry.optionalDependencies || {}))) throw new Error(`Unresolved runtime dependency: ${name}`);
      if (target) queue.push({ key: target, chain: [...chain, name] });
    }
  }
  return found;
}

describe('Dashboard production proxy dependency boundary', () => {
  it('both native entry paths call the original literal slash matcher before preparation', () => {
    const source = ts.createSourceFile('proxy-adapter.ts', readFileSync(resolve(root, 'apps/api/src/dashboard/proxy-adapter.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'defaultPathMatches') calls.push(node); ts.forEachChild(node, visit); };
    visit(source);
    expect(calls.map(call => call.arguments[0].getText(source))).toEqual(['req.url', 'req.url']);
    const imports = source.statements.filter(ts.isImportDeclaration).map(node => (node.moduleSpecifier as ts.StringLiteral).text);
    expect(imports).toContain('node:url');
  });
  it('production entry and adapter do not import the dev-only compatibility library', () => {
    for (const file of ['apps/api/src/dashboard/server.ts', 'apps/api/src/dashboard/proxy-adapter.ts']) {
      const source = ts.createSourceFile(file, readFileSync(resolve(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
      const imports = source.statements.filter(ts.isImportDeclaration).map(node => (node.moduleSpecifier as ts.StringLiteral).text);
      expect(imports).not.toContain('http-proxy-middleware');
      expect(imports).not.toContain('hpm-docker-baseline');
      expect(imports).toContain(file.endsWith('/server.ts') ? './proxy-adapter.js' : 'http-proxy');
    }
  });
  for (const [file, start] of [['package-lock.json', 'apps/api'], ['apps/api/package-lock.json', '']] as const) {
    it(`${file} excludes vulnerable glob traversal from the real API runtime graph`, () => {
      const lock: Lock = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
      const paths = runtimePaths(lock, start);
      const forbidden = [...paths].filter(([key]) => ['http-proxy-middleware', 'micromatch', 'braces'].includes(lock.packages[key].name || key.split('node_modules/').at(-1)!));
      expect(forbidden.map(([, chain]) => chain.join(' → '))).toEqual([]);
      expect(paths.has('node_modules/http-proxy')).toBe(true);
    });
  }
});
