import { afterAll, afterEach, expect, vi } from 'vitest';

const boundary = vi.hoisted(() => {
  const state = { dirs: [] as string[], blocked: [] as string[], actual: null as any };
  return {
    state,
    async fsFactory(importOriginal: () => Promise<any>) {
      const fs = await importOriginal();
      const path = await import('node:path');
      state.actual = fs;
      const owned = (value: any) => {
        const resolved = path.resolve(String(value));
        return state.dirs.some(dir => resolved === dir || resolved.startsWith(dir + path.sep));
      };
      const deny = (kind: string): never => {
        state.blocked.push(kind);
        throw new Error('forensics_test_boundary_denied:' + kind);
      };
      const guarded: any = { ...fs };
      for (const name of ['writeFileSync', 'mkdirSync', 'unlinkSync', 'rmSync', 'rmdirSync', 'appendFileSync']) {
        guarded[name] = (target: any, ...args: any[]) => {
          if (!owned(target)) return deny('fs.' + name);
          return fs[name](target, ...args);
        };
      }
      guarded.mkdtempSync = (prefix: string, ...args: any[]) => {
        if (path.basename(prefix) !== 'forensics-vt-') return deny('fs.mkdtempSync');
        const dir = fs.mkdtempSync(prefix, ...args);
        state.dirs.push(dir);
        return dir;
      };
      guarded.existsSync = (target: any) => {
        if (String(target).startsWith('/tmp/cecelia-prompts')) return false;
        if (/[/\\]\.(credentials|claude)/.test(String(target))) return deny('fs.sensitive-exists');
        return fs.existsSync(target);
      };
      guarded.readFileSync = (target: any, ...args: any[]) => {
        if (/[/\\]\.(credentials|claude)/.test(String(target))) return deny('fs.sensitive-read');
        return fs.readFileSync(target, ...args);
      };
      return { ...guarded, default: guarded };
    },
    deny(kind: string): never {
      state.blocked.push(kind);
      throw new Error('forensics_test_boundary_denied:' + kind);
    },
  };
});
vi.mock('fs', boundary.fsFactory);
vi.mock('node:fs', boundary.fsFactory);
vi.mock('../../db.js', () => ({ default: {
  query: () => boundary.deny('db.query'), connect: () => boundary.deny('db.connect'),
} }));
vi.mock('child_process', () => ({
  spawn: () => boundary.deny('process.spawn'),
  exec: () => boundary.deny('process.exec'),
  execSync: () => boundary.deny('process.execSync'),
  execFile: () => boundary.deny('process.execFile'),
  execFileSync: () => boundary.deny('process.execFileSync'),
  default: {},
}));
vi.stubGlobal('fetch', () => boundary.deny('fetch'));
afterEach(() => expect(boundary.state.blocked).toEqual([]));
afterAll(() => {
  for (const dir of boundary.state.dirs) {
    boundary.state.actual.rmSync(dir, { recursive: true, force: true });
    expect(boundary.state.actual.existsSync(dir)).toBe(false);
  }
  vi.unstubAllGlobals();
});
