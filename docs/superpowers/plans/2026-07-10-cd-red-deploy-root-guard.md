# CD 连红根治：部署根解耦 + 守卫硬红 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CD 部署根从活人主仓切到专用 cecelia-deploy-main，并把 git pull 静默降级改成守卫硬红（专用根自愈）。

**Architecture:** deploy-local.sh 在计算改动范围后、部署动作前插入"部署根守卫"：AUTORESET 模式（专用根）fetch+checkout -f+reset --hard 自愈；非 AUTORESET 模式 branch=main+无脏+ff-pull 否则 exit 1。docker-compose.yml 顶层 name: cecelia + REPO_ROOT 指向 deploy-main + 挂载 + AUTORESET env。

**Tech Stack:** bash / vitest (spawnSync 驱动脚本 + 临时 git fixture)

---

### Task 1: 守卫 regression test（先红）

**Files:**
- Test: `packages/brain/src/__tests__/deploy-root-guard.test.js`

- [ ] **Step 1: 写 failing test**

```js
/**
 * deploy-root-guard.test.js
 * 部署根守卫回归测试（07-10 Gate3 五连红根因：部署根被有头会话带离 main + 静默降级）。
 * 用临时 bare origin + clone 驱动真实 deploy-local.sh：
 *  - 非 main 分支 / tracked 脏 → exit≠0 且输出含"部署根守卫"
 *  - CECELIA_DEPLOY_AUTORESET=1 → 自愈（回 main + reset --hard）后继续
 *  - 干净 main → 通过守卫（无相关改动 → exit 0 跳过部署）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, appendFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const SCRIPT = new URL('../../../../scripts/deploy-local.sh', import.meta.url).pathname;
const GIT_ID = '-c user.email=t@t.t -c user.name=t';

let base, clone;

function sh(cmd) { return execSync(cmd, { encoding: 'utf8' }); }

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'deploy-guard-'));
  const origin = join(base, 'origin.git');
  clone = join(base, 'clone');
  sh(`git init --bare -q "${origin}"`);
  sh(`git clone -q "${origin}" "${clone}"`);
  sh(`git -C "${clone}" checkout -q -b main`);
  writeFileSync(join(clone, 'tracked.txt'), 'v1\n');
  sh(`git -C "${clone}" add tracked.txt && git -C "${clone}" ${GIT_ID} commit -q -m init`);
  sh(`git -C "${clone}" push -q -u origin main`);
});

afterEach(() => { rmSync(base, { recursive: true, force: true }); });

function runDeploy(extraEnv = {}) {
  return spawnSync('bash', [SCRIPT, '--changed=README.md', 'main'], {
    cwd: clone,
    env: {
      ...process.env,
      CECELIA_DEPLOY_ROOT: clone,
      CECELIA_DEPLOY_FORCE_GUARD: '1',
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

describe('deploy-root-guard', () => {
  it('部署根不在 main 分支 → 硬红 exit≠0', () => {
    sh(`git -C "${clone}" checkout -q -b cp-somework`);
    const r = runDeploy();
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('部署根守卫');
  });

  it('部署根 tracked 文件脏 → 硬红 exit≠0', () => {
    appendFileSync(join(clone, 'tracked.txt'), 'dirty\n');
    const r = runDeploy();
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('部署根守卫');
  });

  it('AUTORESET=1：离 main + 脏 → 自愈回 origin/main 后通过（exit 0）', () => {
    sh(`git -C "${clone}" checkout -q -b cp-somework`);
    appendFileSync(join(clone, 'tracked.txt'), 'dirty\n');
    const r = runDeploy({ CECELIA_DEPLOY_AUTORESET: '1' });
    expect(r.status).toBe(0);
    const branch = sh(`git -C "${clone}" symbolic-ref --short HEAD`).trim();
    expect(branch).toBe('main');
    const dirty = sh(`git -C "${clone}" status --porcelain --untracked-files=no`).trim();
    expect(dirty).toBe('');
  });

  it('干净 main → 通过守卫，无相关改动 exit 0', () => {
    const r = runDeploy();
    expect(r.status).toBe(0);
  });

  it('无 FORCE_GUARD（现有 smoke 隔离模式）→ 不跑守卫，行为不变', () => {
    sh(`git -C "${clone}" checkout -q -b cp-somework`);
    const r = spawnSync('bash', [SCRIPT, '--changed=README.md', 'main'], {
      cwd: clone,
      env: { ...process.env, CECELIA_DEPLOY_ROOT: clone },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd packages/brain && npx vitest run src/__tests__/deploy-root-guard.test.js`
Expected: FAIL（前两个用例 exit 0 ≠ 期望非0；AUTORESET 用例分支未自愈）

- [ ] **Step 3: commit-1（红测试入库）**

```bash
git add packages/brain/src/__tests__/deploy-root-guard.test.js
git commit -m "test(deploy): 部署根守卫 failing regression test（Gate3五连红根因）"
```

### Task 2: deploy-local.sh 实现守卫（变绿）

**Files:**
- Modify: `scripts/deploy-local.sh:104-121`（守卫插在"改动范围"打印后、NEED_* 判定前；删除原"拉取主仓库最新代码"静默降级块）

- [ ] **Step 1: 实现**

在第 80 行 `echo ""` （改动范围打印结束）之后插入：

```bash
# ── 部署根守卫（07-10 Gate3 五连红根治）──────────────────────────────
# 真实模式必跑；CECELIA_DEPLOY_ROOT 测试隔离模式默认跳过（现有 smoke 兼容），
# 测试要验守卫时用 CECELIA_DEPLOY_FORCE_GUARD=1 强制开启。
RUN_GUARD=true
[[ -n "${CECELIA_DEPLOY_ROOT:-}" && "${CECELIA_DEPLOY_FORCE_GUARD:-0}" != "1" ]] && RUN_GUARD=false
[[ "$DRY_RUN" == true ]] && RUN_GUARD=false

if [[ "$RUN_GUARD" == true ]]; then
    if [[ "${CECELIA_DEPLOY_AUTORESET:-0}" == "1" ]]; then
        # 专用部署根（机器独占，无人类工作）：自愈到 origin/main
        echo "🔒 部署根守卫（专用根自愈）: fetch + checkout -f + reset --hard origin/$BASE_BRANCH"
        git -C "$MAIN_ROOT" fetch origin "$BASE_BRANCH" \
            || { echo "❌ 部署根守卫: git fetch origin $BASE_BRANCH 失败，拒绝部署"; exit 1; }
        git -C "$MAIN_ROOT" checkout -f "$BASE_BRANCH" \
            || { echo "❌ 部署根守卫: checkout $BASE_BRANCH 失败，拒绝部署"; exit 1; }
        git -C "$MAIN_ROOT" reset --hard "origin/$BASE_BRANCH" \
            || { echo "❌ 部署根守卫: reset --hard origin/$BASE_BRANCH 失败，拒绝部署"; exit 1; }
    else
        # 可能是活人仓：绝不自动改动，任何异常状态硬红（禁止静默降级用脏代码部署）
        CURRENT_BRANCH=$(git -C "$MAIN_ROOT" symbolic-ref --short HEAD 2>/dev/null || echo "DETACHED")
        if [[ "$CURRENT_BRANCH" != "$BASE_BRANCH" ]]; then
            echo "❌ 部署根守卫: $MAIN_ROOT 在分支 $CURRENT_BRANCH（要求 $BASE_BRANCH），拒绝部署。"
            echo "   部署根疑似被工作会话占用；专用根请设 CECELIA_DEPLOY_AUTORESET=1。"
            exit 1
        fi
        if [[ -n "$(git -C "$MAIN_ROOT" status --porcelain --untracked-files=no)" ]]; then
            echo "❌ 部署根守卫: $MAIN_ROOT 有未提交 tracked 改动，拒绝部署（禁止用脏代码部署）。"
            exit 1
        fi
        git -C "$MAIN_ROOT" pull --ff-only origin "$BASE_BRANCH" \
            || { echo "❌ 部署根守卫: git pull --ff-only 失败（分叉/网络），拒绝部署"; exit 1; }
    fi
    echo ""
fi
```

同时**删除**原 110-121 行"📥 拉取主仓库最新代码..."整块（含 `git pull || warning 继续使用现有代码部署`）；DRY_RUN 分支原样保留的打印移除（守卫在 dry-run 下整体跳过即可）。

- [ ] **Step 2: 跑测试确认绿**

Run: `cd packages/brain && npx vitest run src/__tests__/deploy-root-guard.test.js`
Expected: 5 passed

- [ ] **Step 3: 现有 smoke 不回归**

Run: `bash scripts/smoke/dashboard-staging-gate-smoke.sh`（若该 smoke 本地可跑）
Expected: 与 main 相同结果（守卫在 CECELIA_DEPLOY_ROOT 模式默认跳过）

- [ ] **Step 4: commit-2**

```bash
git add scripts/deploy-local.sh
git commit -m "fix(deploy): 部署根守卫——AUTORESET自愈/非专用根硬红，删除git pull静默降级"
```

### Task 3: docker-compose 部署根切换（config test 先红）

**Files:**
- Test: `packages/brain/src/__tests__/deploy-root-config.test.js`
- Modify: `docker-compose.yml`

- [ ] **Step 1: 写 failing config test**

```js
/**
 * deploy-root-config.test.js
 * 守住 CD 部署根配置：REPO_ROOT 必须指向专用部署仓（不是活人主仓）、
 * compose 项目名固定 cecelia（防换目录跑 compose 容器名冲突）、AUTORESET 开启、挂载存在。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const COMPOSE = readFileSync(
  new URL('../../../../docker-compose.yml', import.meta.url), 'utf8'
);

describe('deploy-root-config', () => {
  it('compose 顶层项目名固定 cecelia', () => {
    expect(COMPOSE).toMatch(/^name: cecelia$/m);
  });
  it('REPO_ROOT 指向专用部署仓 cecelia-deploy-main', () => {
    expect(COMPOSE).toContain('REPO_ROOT=/Users/administrator/perfect21/cecelia-deploy-main');
    expect(COMPOSE).not.toContain('REPO_ROOT=/Users/administrator/perfect21/cecelia\n');
  });
  it('专用部署根开启 AUTORESET 自愈', () => {
    expect(COMPOSE).toContain('CECELIA_DEPLOY_AUTORESET=1');
  });
  it('专用部署仓已挂载 rw', () => {
    expect(COMPOSE).toContain(
      '/Users/administrator/perfect21/cecelia-deploy-main:/Users/administrator/perfect21/cecelia-deploy-main:rw'
    );
  });
});
```

- [ ] **Step 2: 跑测试确认红** → `cd packages/brain && npx vitest run src/__tests__/deploy-root-config.test.js` Expected: FAIL

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/deploy-root-config.test.js
git commit -m "test(deploy): 部署根配置守卫 failing test"
```

- [ ] **Step 4: 改 docker-compose.yml**

1. 文件头 `services:` 之前加一行 `name: cecelia`（带注释：项目名与目录解耦，防换部署根容器名冲突）
2. `- REPO_ROOT=/Users/administrator/perfect21/cecelia` → `- REPO_ROOT=/Users/administrator/perfect21/cecelia-deploy-main`
3. environment 段加 `- CECELIA_DEPLOY_AUTORESET=1`（注释：专用部署根自愈）
4. volumes 段"主仓库全目录"挂载下方加：
   `- /Users/administrator/perfect21/cecelia-deploy-main:/Users/administrator/perfect21/cecelia-deploy-main:rw`

- [ ] **Step 5: 跑测试确认绿** + `docker compose -f docker-compose.yml config -q` 校验语法

- [ ] **Step 6: commit-2**

```bash
git add docker-compose.yml
git commit -m "fix(deploy): CD部署根切到cecelia-deploy-main+name:cecelia+AUTORESET"
```

### Task 4: DevGate + 版本 + DoD

- [ ] **Step 1: DevGate**

Run: `node scripts/facts-check.mjs && bash scripts/check-version-sync.sh`
Expected: 通过；若 version sync 要求 bump（packages/brain 有改动），brain patch bump（package.json/package-lock/.brain-versions 追加/DEFINITION.md 按 check 脚本提示四处同步）后重跑至绿。

- [ ] **Step 2: 写 dod.md（worktree 根）**

```markdown
# DoD — CD 连红根治：部署根解耦 + 守卫硬红
- [x] [BEHAVIOR] 部署根非 main/脏 → deploy-local.sh 硬红 exit≠0（不再静默降级）
  Test: tests/ → packages/brain/src/__tests__/deploy-root-guard.test.js
- [x] [BEHAVIOR] AUTORESET=1 专用根自愈回 origin/main 后部署继续
  Test: tests/ → packages/brain/src/__tests__/deploy-root-guard.test.js
- [x] [BEHAVIOR] compose 项目名/REPO_ROOT/挂载/AUTORESET 配置锁定
  Test: manual: node -e "const s=require('fs').readFileSync('docker-compose.yml','utf8');if(!/^name: cecelia$/m.test(s)||!s.includes('cecelia-deploy-main'))process.exit(1)"
- [x] 守卫 proven-to-fire（测试红用例即守卫报红实录）
- [x] CI 全绿
```

- [ ] **Step 3: 全量相关测试**

Run: `cd packages/brain && npx vitest run src/__tests__/deploy-root-guard.test.js src/__tests__/deploy-root-config.test.js src/__tests__/deploy-repo-root.test.js`
Expected: all pass

- [ ] **Step 4: commit**

```bash
git add -A && git commit -m "chore: DevGate版本同步+DoD"
```

### Task 5: 合并后 ops（不在 PR 内，watchdog merge 后执行）

- [ ] merge 后从 cecelia-deploy-main 手动跑一次 `git fetch && git reset --hard origin/main && bash scripts/brain-deploy.sh`（SOP，蓝绿 ~10s 窗口）让容器吃到新 REPO_ROOT env
- [ ] 验证：`docker inspect cecelia-node-brain | grep REPO_ROOT` = deploy-main；下一次 brain merge 的 Gate3 绿
- [ ] 回写 Brain task a4c383f7 completed + PR url
