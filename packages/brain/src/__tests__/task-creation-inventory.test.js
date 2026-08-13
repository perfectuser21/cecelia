import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TASK_CREATION_INVENTORY } from '../task-creation-inventory.js';

async function listProductionModules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const modules = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      modules.push(...await listProductionModules(absolute));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      modules.push(absolute);
    }
  }
  return modules;
}

describe('task creation inventory', () => {
  it('records each executable creation boundary', () => {
    expect(TASK_CREATION_INVENTORY.length).toBeGreaterThanOrEqual(33);
    for (const row of TASK_CREATION_INVENTORY) expect(row).toMatchObject({ module: expect.any(String), source: expect.any(String), creates_executable_task: expect.any(Boolean), migration_status: expect.any(String) });
  });

  it('lists every production module that calls the task creation boundary', async () => {
    const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
    const modules = await listProductionModules(sourceRoot);
    const inventoried = new Set(TASK_CREATION_INVENTORY.map((row) => row.module));
    const missing = [];
    for (const modulePath of modules) {
      if (modulePath === path.join(sourceRoot, 'work-routing-store.js')) continue;
      const source = await readFile(modulePath, 'utf8');
      if (/\b(?:createTask|createRoutedTask|taskCreator)\s*\(/.test(source)) {
        const relative = path.relative(sourceRoot, modulePath);
        if (!inventoried.has(relative)) missing.push(relative);
      }
    }
    expect(missing, 'task creation inventory must be generated from production callers').toEqual([]);
  });

  it('routes every inventoried executable boundary through the unique task writer', async () => {
    for (const row of TASK_CREATION_INVENTORY) {
      if (!row.creates_executable_task) continue;
      expect(row.migration_status, row.module).toBe('routed');
      const source = await readFile(new URL(`../${row.module}`, import.meta.url), 'utf8');
      const callsWriterDirectly = /(?:createRoutedTask|createTask)\s*\(/.test(source);
      const callsInjectedWriter = /taskCreator\s*\(/.test(source) && /=\s*createTask\b/.test(source);
      expect(callsWriterDirectly || callsInjectedWriter, row.module).toBe(true);
      if ((callsWriterDirectly || callsInjectedWriter) && row.module !== 'actions.js') {
        const importsActionsBoundary = /(?:from\s+|import\()['"].*actions\.js['"]/.test(source);
        const importsAtomicStore = /(?:from\s+|import\()['"].*work-routing-store\.js['"]/.test(source);
        expect(importsActionsBoundary || importsAtomicStore, row.module).toBe(true);
      }
      expect(source, row.module).not.toMatch(/INSERT\s+INTO\s+tasks/i);
    }
  });

  it('forbids production task writes outside the unique atomic routing store', async () => {
    const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
    const modules = await listProductionModules(sourceRoot);
    const violations = [];

    for (const modulePath of modules) {
      if (modulePath === path.join(sourceRoot, 'work-routing-store.js')) continue;
      const source = await readFile(modulePath, 'utf8');
      if (/INSERT\s+INTO\s+tasks/i.test(source)) {
        violations.push(path.relative(sourceRoot, modulePath));
      }
    }

    expect(violations, 'all executable task writes must create an atomic Routing Receipt').toEqual([]);
  });
});
