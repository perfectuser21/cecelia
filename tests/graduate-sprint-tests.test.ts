// graduate-sprint-tests.test.ts — 刀1 毕业搬运脚本 TDD
// 计划: docs/superpowers/plans/2026-07-14-test-graduation.md Task 1
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error 纯 .mjs 无类型声明
import { sprintSlug, planGraduation, graduate } from '../scripts/graduate-sprint-tests.mjs';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'graduate-sprint-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function makeSprint(
  name: string,
  opts: { tests?: string[]; e2e?: boolean } = {}
): string {
  const dir = path.join(root, 'sprints', name);
  fs.mkdirSync(dir, { recursive: true });
  for (const t of opts.tests ?? []) {
    const f = path.join(dir, 'tests', t);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `// fixture ${t}\n`);
  }
  if (opts.e2e) {
    fs.writeFileSync(path.join(dir, 'e2e-verify.sh'), '#!/bin/bash\necho ok\n');
  }
  return dir;
}

describe('sprintSlug', () => {
  it('去掉前导日期数字前缀', () => {
    expect(sprintSlug('07130752-relay-a85e0582')).toBe('relay-a85e0582');
  });

  it('非 [a-zA-Z0-9-_] 字符转 -', () => {
    expect(sprintSlug('07130752-relay a85e@0582')).toBe('relay-a85e-0582');
  });

  it('无日期前缀的目录名原样保留', () => {
    expect(sprintSlug('relay-a85e0582')).toBe('relay-a85e0582');
  });
});

describe('planGraduation / graduate dry-run', () => {
  it('返回 tests/e2e 搬运计划，to 指向 tests/regression/<slug>/ 与 scripts/smoke/e2e/<slug>.sh', () => {
    makeSprint('07130752-relay-a85e0582', { tests: ['a.test.ts'], e2e: true });
    const plan = graduate(root, path.join('sprints', '07130752-relay-a85e0582'), { dryRun: true });
    expect(plan.tests).toEqual([
      {
        from: path.join('sprints', '07130752-relay-a85e0582', 'tests', 'a.test.ts'),
        to: path.join('tests', 'regression', 'relay-a85e0582', 'a.test.ts'),
      },
    ]);
    expect(plan.e2e).toEqual([
      {
        from: path.join('sprints', '07130752-relay-a85e0582', 'e2e-verify.sh'),
        to: path.join('scripts', 'smoke', 'e2e', 'relay-a85e0582.sh'),
      },
    ]);
  });

  it('dry-run 不落盘：源文件不动、目标不产生', () => {
    const dir = makeSprint('07130752-relay-a85e0582', { tests: ['a.test.ts'], e2e: true });
    graduate(root, path.join('sprints', '07130752-relay-a85e0582'), { dryRun: true });
    expect(fs.existsSync(path.join(dir, 'tests', 'a.test.ts'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'e2e-verify.sh'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'tests', 'regression'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'scripts', 'smoke', 'e2e'))).toBe(false);
  });

  it('sprint 无 tests/ 且无 e2e-verify.sh：返回空数组不报错', () => {
    makeSprint('07130752-empty-sprint');
    const plan = graduate(root, path.join('sprints', '07130752-empty-sprint'), { dryRun: true });
    expect(plan).toEqual({ tests: [], e2e: [] });
  });
});

describe('graduate 真搬', () => {
  it('fs 层面 rename+mkdir 搬运，保留 tests/ 下子目录结构', () => {
    const dir = makeSprint('07130752-relay-a85e0582', {
      tests: ['a.test.ts', path.join('sub', 'b.test.ts'), 'helper.ts'],
      e2e: true,
    });
    const plan = graduate(root, path.join('sprints', '07130752-relay-a85e0582'));
    // 目标就位
    expect(
      fs.existsSync(path.join(root, 'tests', 'regression', 'relay-a85e0582', 'a.test.ts'))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(root, 'tests', 'regression', 'relay-a85e0582', 'sub', 'b.test.ts'))
    ).toBe(true);
    // 伴随文件（helper）一起毕业，测试不断依赖
    expect(
      fs.existsSync(path.join(root, 'tests', 'regression', 'relay-a85e0582', 'helper.ts'))
    ).toBe(true);
    expect(fs.existsSync(path.join(root, 'scripts', 'smoke', 'e2e', 'relay-a85e0582.sh'))).toBe(
      true
    );
    // 源文件已搬走
    expect(fs.existsSync(path.join(dir, 'tests', 'a.test.ts'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'e2e-verify.sh'))).toBe(false);
    // 内容保真
    expect(
      fs.readFileSync(
        path.join(root, 'tests', 'regression', 'relay-a85e0582', 'sub', 'b.test.ts'),
        'utf8'
      )
    ).toContain('b.test.ts');
    expect(plan.tests.length).toBe(3);
    expect(plan.e2e.length).toBe(1);
  });

  it('目标已存在同名文件：抛错不覆盖，源文件保持原位', () => {
    const dir = makeSprint('07130752-relay-a85e0582', { tests: ['a.test.ts'] });
    const target = path.join(root, 'tests', 'regression', 'relay-a85e0582', 'a.test.ts');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '// 已存在的老文件\n');
    expect(() =>
      graduate(root, path.join('sprints', '07130752-relay-a85e0582'))
    ).toThrow(/已存在/);
    // 不覆盖
    expect(fs.readFileSync(target, 'utf8')).toContain('已存在的老文件');
    // 源文件原位不动
    expect(fs.existsSync(path.join(dir, 'tests', 'a.test.ts'))).toBe(true);
  });

  it('planGraduation 与 graduate dry-run 返回同一计划', () => {
    makeSprint('07130752-relay-a85e0582', { tests: ['a.test.ts'], e2e: true });
    const sprintDir = path.join('sprints', '07130752-relay-a85e0582');
    expect(planGraduation(root, sprintDir)).toEqual(graduate(root, sprintDir, { dryRun: true }));
  });
});

describe('updateRefs', () => {
  it('毕业后重写根 DoD.md 里的旧路径引用（updateRefs: true）', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grad-refs-'));
    try {
      fs.mkdirSync(path.join(root, 'sprints/07130939-relay-x/tests'), { recursive: true });
      fs.writeFileSync(path.join(root, 'sprints/07130939-relay-x/tests/a.test.ts'), '');
      fs.writeFileSync(path.join(root, 'sprints/07130939-relay-x/e2e-verify.sh'), '');
      fs.writeFileSync(path.join(root, 'DoD.md'),
        'Test: manual:bash sprints/07130939-relay-x/e2e-verify.sh\n' +
        'Test: sprints/07130939-relay-x/tests/a.test.ts\n');
      graduate(root, 'sprints/07130939-relay-x', { updateRefs: true });
      const dod = fs.readFileSync(path.join(root, 'DoD.md'), 'utf8');
      expect(dod).toContain('scripts/smoke/e2e/relay-x.sh');
      expect(dod).toContain('tests/regression/relay-x/a.test.ts');
      expect(dod).not.toContain('sprints/07130939-relay-x/e2e-verify.sh');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('无 DoD.md 时 updateRefs 静默跳过', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grad-norefs-'));
    try {
      fs.mkdirSync(path.join(root, 'sprints/s1/tests'), { recursive: true });
      fs.writeFileSync(path.join(root, 'sprints/s1/tests/a.test.ts'), '');
      expect(() => graduate(root, 'sprints/s1', { updateRefs: true })).not.toThrow();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
