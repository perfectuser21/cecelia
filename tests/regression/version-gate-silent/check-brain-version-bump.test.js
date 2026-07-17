/**
 * check-brain-version-bump.sh 合同测试（GP-1 ~ GP-4）
 *
 * 门禁逻辑：
 *   - PR diff 含 packages/brain/src/** → 要求 PR version > main version（semver 严格大于）
 *   - PR diff 不含 packages/brain/src/** → 跳过，exit 0
 *
 * 测试用 mkdtempSync 搭建临时 git 仓库，模拟 main 分支和 PR 分支的不同状态，
 * 通过 BASE_REF 环境变量传入基准分支，执行脚本并断言退出码 + 输出内容。
 *
 * 合同来源: sprints/07162200-version-gate-silent/contract-draft.md
 * Task ID: d8189a83-3bd3-4da3-ac70-f0ed2ba4ece4
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../scripts/ci/check-brain-version-bump.sh');

/**
 * 搭建临时 git 仓库 fixture：
 *   1. init git repo
 *   2. 在 main 分支写 packages/brain/package.json（mainVersion）并 commit
 *   3. 切换到 pr 分支，写新的 package.json（prVersion），
 *      若 srcChanged=true 则写一个 src 文件，否则写测试文件
 *   4. 返回 { dir, baseRef: 'main' }
 */
function createFixture({ mainVersion, prVersion, srcChanged = true, extraPaths = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'brain-version-bump-test-'));

  const git = (cmd) =>
    execSync(`git ${cmd}`, {
      cwd: dir,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@test.com',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@test.com',
      },
    });

  // 初始化 git 仓库
  git('init');
  git('checkout -b main');

  // 搭建 packages/brain/ 目录结构
  mkdirSync(join(dir, 'packages', 'brain', 'src'), { recursive: true });
  mkdirSync(join(dir, 'packages', 'brain', '__tests__'), { recursive: true });

  // main 分支：写 package.json 并 commit
  writeFileSync(
    join(dir, 'packages', 'brain', 'package.json'),
    JSON.stringify({ name: 'brain', version: mainVersion }, null, 2),
  );
  // 写一个 src 文件作为基础（main 分支本来就有 src）
  writeFileSync(join(dir, 'packages', 'brain', 'src', 'server.js'), `// v${mainVersion}\n`);

  git('add .');
  git('commit -m "chore: init main"');

  // PR 分支
  git('checkout -b pr-branch');

  // 更新 package.json 版本
  writeFileSync(
    join(dir, 'packages', 'brain', 'package.json'),
    JSON.stringify({ name: 'brain', version: prVersion }, null, 2),
  );

  if (srcChanged) {
    // 改动 src 文件（模拟 PR 改了 brain src）
    writeFileSync(
      join(dir, 'packages', 'brain', 'src', 'server.js'),
      `// v${prVersion} - changed\n`,
    );
  } else {
    // 只改测试文件（不改 src）
    writeFileSync(
      join(dir, 'packages', 'brain', '__tests__', 'some.test.js'),
      `// test for ${prVersion}\n`,
    );
    // 额外路径（sprints/, *.md 等）
    for (const p of extraPaths) {
      const fullPath = join(dir, p);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, `# doc\n`);
    }
  }

  git('add .');
  git('commit -m "feat: pr changes"');

  return { dir, baseRef: 'main' };
}

function runScript({ dir, baseRef }) {
  const result = spawnSync('bash', [SCRIPT], {
    cwd: dir,
    env: {
      ...process.env,
      BASE_REF: baseRef,
    },
    encoding: 'utf8',
  });
  return {
    exitCode: result.status ?? 1,
    stdout: (result.stdout ?? '') + (result.stderr ?? ''),
  };
}

describe('check-brain-version-bump.sh', () => {
  // 确保脚本存在（如果不存在先跳过，等实现后再跑）
  beforeAll(() => {
    if (!existsSync(SCRIPT)) {
      // 脚本尚未实现 — 测试会失败（failing first，符合 TDD 要求）
    }
  });

  it('GP-1: 改 brain src 且 bump 了版本 → exit 0（门禁通过）', () => {
    const { dir, baseRef } = createFixture({
      mainVersion: '1.267.0',
      prVersion: '1.268.0',
      srcChanged: true,
    });

    try {
      const { exitCode, stdout } = runScript({ dir, baseRef });
      expect(exitCode, `脚本输出：\n${stdout}`).toBe(0);
      // 输出应含"bump"相关确认信息
      expect(stdout).toMatch(/bump|✅|版本已/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('GP-2: 改 brain src 未 bump 版本 → exit 1 且含 fix 提示（npm version patch）', () => {
    const { dir, baseRef } = createFixture({
      mainVersion: '1.267.0',
      prVersion: '1.267.0', // 未 bump，与 main 相同
      srcChanged: true,
    });

    try {
      const { exitCode, stdout } = runScript({ dir, baseRef });
      expect(exitCode, `脚本输出：\n${stdout}`).toBe(1);
      // 必须含可操作 fix 提示
      expect(stdout).toContain('npm version patch');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('GP-3: 未改 brain src（仅改 tests/__tests__）→ exit 0（跳过检查）', () => {
    const { dir, baseRef } = createFixture({
      mainVersion: '1.267.0',
      prVersion: '1.267.0', // 版本未 bump，但 src 也没改
      srcChanged: false,
    });

    try {
      const { exitCode, stdout } = runScript({ dir, baseRef });
      expect(exitCode, `脚本输出：\n${stdout}`).toBe(0);
      // 输出应含跳过提示
      expect(stdout).toMatch(/跳过|skip/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('GP-4: semver 任意步长 bump 均通过（patch / minor / major）', () => {
    const cases = [
      { mainVersion: '1.267.0', prVersion: '1.267.1', label: 'patch bump' },
      { mainVersion: '1.267.0', prVersion: '1.268.0', label: 'minor bump' },
      { mainVersion: '1.267.0', prVersion: '2.0.0', label: 'major bump' },
    ];

    for (const { mainVersion, prVersion, label } of cases) {
      const { dir, baseRef } = createFixture({ mainVersion, prVersion, srcChanged: true });
      try {
        const { exitCode, stdout } = runScript({ dir, baseRef });
        expect(exitCode, `[${label}] 脚本输出：\n${stdout}`).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});
