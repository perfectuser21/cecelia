# brain-deploy 真蓝绿改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** brain-deploy.sh 改 canary 蓝绿——新镜像验证不过时旧 blue 原封不动，杜绝每次 merge 把生产 Brain 打挂。

**Architecture:** 把 canary/切换逻辑抽成可 source 的 `scripts/lib/bluegreen.sh`（纯函数，docker 命令可 mock），brain-deploy.sh 源它。green canary 在临时端口起、`BRAIN_DEPLOY_CANARY=1` 关 tick 避免 double-dispatch、health 全过才切；失败保留 blue + Bark。staging 独立 compose project。部署后自检 5221 + Bark。

**Tech Stack:** bash, docker CLI, vitest（行为测试用 mock docker on PATH），Node（tick gate）。

## Global Constraints
- 生产容器名 `cecelia-node-brain`（blue）；canary 名 `cecelia-node-brain-green`；临时端口 `5223`。
- 任何 `docker rm -f cecelia-node-brain`(blue) 只能在 green canary health 通过之后发生。
- migrations additive-only（既有约定）；canary 不跑 tick。
- Bark 走 `~/.credentials/bark.env` 的 `BARK_TOKEN`，curl `https://api.day.app/$BARK_TOKEN/...`；不走飞书。
- 测试 CI 兼容：mock docker 用 shell 桩，不需真 docker。

---

### Task 1: 抽 bluegreen.sh + failing 行为测试（green 失败保留 blue）

**Files:**
- Create: `scripts/lib/bluegreen.sh`
- Test: `packages/brain/src/__tests__/bluegreen-swap.test.js`

**Interfaces:**
- Produces: `bluegreen_swap()` —— 环境变量入参 `BLUE_NAME`/`GREEN_NAME`/`TEMP_PORT`/`TARGET_VERSION`/`HEALTH_URL`；docker 命令走 PATH（可 mock）。green health 失败 → 不删 blue，`return 1`。green health 通过 → 删 blue、起新生产容器、返回 0。
- Produces: `send_bark(msg)` —— source bark.env 后 curl，未配 token 静默跳过。

- [ ] **Step 1: 写 failing 行为测试**

```javascript
// packages/brain/src/__tests__/bluegreen-swap.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const BG_LIB = resolve(REPO_ROOT, 'scripts/lib/bluegreen.sh');

// 造一个 mock docker：把每次调用参数追加写 $DOCKER_LOG；green health 探测返回 unhealthy
function makeMockDocker(dir, { greenHealthy }) {
  const log = join(dir, 'docker.log');
  const script = `#!/usr/bin/env bash
echo "$@" >> "${log}"
case "$1" in
  run) exit 0 ;;                       # 起容器成功
  inspect) echo "${greenHealthy ? 'healthy' : 'unhealthy'}" ; exit 0 ;;
  rm|stop|compose) exit 0 ;;
  *) exit 0 ;;
esac`;
  const bin = join(dir, 'docker');
  writeFileSync(bin, script); chmodSync(bin, 0o755);
  return { log, dir };
}

describe('bluegreen_swap', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'bg-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('green 健康检查失败时，绝不删 blue（cecelia-node-brain），且 return 非0', () => {
    makeMockDocker(tmp, { greenHealthy: false });
    const log = join(tmp, 'docker.log');
    let code = 0;
    try {
      execSync(
        `bash -c 'source "${BG_LIB}"; BLUE_NAME=cecelia-node-brain GREEN_NAME=cecelia-node-brain-green TEMP_PORT=5223 TARGET_VERSION=9.9.9 HEALTH_TIMEOUT=2 bluegreen_swap'`,
        { env: { ...process.env, PATH: `${tmp}:${process.env.PATH}`, DOCKER_LOG: log }, stdio: 'pipe' }
      );
    } catch (e) { code = e.status; }
    const calls = readFileSync(log, 'utf8');
    // 核心断言：blue 没被 rm -f
    expect(calls).not.toMatch(/rm -f cecelia-node-brain(?!-green)/);
    // green 被起 + 被清理
    expect(calls).toMatch(/run .*cecelia-node-brain-green/);
    expect(calls).toMatch(/rm .*cecelia-node-brain-green/);
    // 失败返回非0
    expect(code).not.toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `cd packages/brain && npx vitest run src/__tests__/bluegreen-swap.test.js`
Expected: FAIL —— `scripts/lib/bluegreen.sh` 不存在 / bluegreen_swap 未定义。

- [ ] **Step 3: commit failing test**

```bash
git add packages/brain/src/__tests__/bluegreen-swap.test.js
git commit -m "test(deploy): bluegreen_swap green失败保留blue 回归测试(Red)"
```

---

### Task 2: 实现 bluegreen.sh 让测试变绿

**Files:**
- Create/Modify: `scripts/lib/bluegreen.sh`
- Test: `packages/brain/src/__tests__/bluegreen-swap.test.js`（Task 1 已建）

**Interfaces:**
- Consumes: mock docker（测试）/ 真 docker（生产），通过 PATH。
- Produces: `bluegreen_swap` / `send_bark`（供 brain-deploy.sh source）。

- [ ] **Step 1: 写实现**

```bash
# scripts/lib/bluegreen.sh
# 蓝绿切换：green canary 验证健康后才切；失败保留 blue。可被 brain-deploy.sh source，也可单测。
set -uo pipefail

send_bark() {
  local msg="$1"
  [[ -f "$HOME/.credentials/bark.env" ]] && source "$HOME/.credentials/bark.env"
  [[ -z "${BARK_TOKEN:-}" ]] && { echo "  [bark] 未配 BARK_TOKEN，跳过"; return 0; }
  curl -sf --max-time 10 "https://api.day.app/${BARK_TOKEN}/$(printf '%s' "Brain部署" | jq -sRr @uri)/$(printf '%s' "$msg" | jq -sRr @uri)?group=brain-deploy" >/dev/null 2>&1 \
    && echo "  [bark] 已推送: $msg" || echo "  [bark] 推送失败(不阻塞)"
}

# 入参（env）：BLUE_NAME GREEN_NAME TEMP_PORT TARGET_VERSION HEALTH_TIMEOUT
# 依赖调用方已 export：GREEN_RUN_ARGS（起 green 的完整 docker run 追加参数，含 env/mounts/image）
bluegreen_swap() {
  local blue="${BLUE_NAME:-cecelia-node-brain}"
  local green="${GREEN_NAME:-cecelia-node-brain-green}"
  local port="${TEMP_PORT:-5223}"
  local timeout="${HEALTH_TIMEOUT:-60}"

  echo "[bluegreen] 起 green canary ($green, 端口 $port, tick 关)..."
  docker rm -f "$green" >/dev/null 2>&1 || true
  # BRAIN_DEPLOY_CANARY=1 关 tick，避免与 blue double-dispatch
  # shellcheck disable=SC2086
  docker run -d --name "$green" -p "${port}:5221" -e BRAIN_DEPLOY_CANARY=1 ${GREEN_RUN_ARGS:-} "cecelia-brain:${TARGET_VERSION}" >/dev/null 2>&1 || {
    echo "[bluegreen] green 起容器失败"; docker rm -f "$green" >/dev/null 2>&1 || true
    send_bark "green 镜像 v${TARGET_VERSION} 启动失败，已保留旧版"; return 1; }

  # poll green health
  local elapsed=0 healthy=false
  while [ "$elapsed" -lt "$timeout" ]; do
    if curl -sf "http://localhost:${port}/api/brain/tick/status" >/dev/null 2>&1; then healthy=true; break; fi
    # docker inspect health 兜底（mock docker 用）
    local hs; hs=$(docker inspect "$green" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || echo missing)
    [ "$hs" = "healthy" ] && { healthy=true; break; }
    [ "$hs" = "unhealthy" ] && break
    sleep 2; elapsed=$((elapsed+2))
  done

  if [ "$healthy" != true ]; then
    echo "[bluegreen] ❌ green 健康检查未通过，保留 blue($blue) 原封不动"
    docker rm -f "$green" >/dev/null 2>&1 || true
    send_bark "green 镜像 v${TARGET_VERSION} 健康检查失败，已保留旧版(5221不受影响)"
    return 1
  fi

  echo "[bluegreen] ✅ green 健康，切换：删 blue → 起新生产容器"
  docker rm -f "$green" >/dev/null 2>&1 || true   # canary 仅验证用
  docker rm -f "$blue" >/dev/null 2>&1 || true    # ← 仅在 green 通过后
  return 0   # 由调用方 brain-deploy.sh 执行既有 compose up + 5221 health + rollback
}
```

- [ ] **Step 2: 跑测试确认 pass**

Run: `cd packages/brain && npx vitest run src/__tests__/bluegreen-swap.test.js`
Expected: PASS。

- [ ] **Step 3: commit**

```bash
git add scripts/lib/bluegreen.sh
git commit -m "feat(deploy): scripts/lib/bluegreen.sh canary蓝绿切换(green失败保留blue)"
```

---

### Task 3: brain-deploy.sh 接 bluegreen_swap（替换先删后建）

**Files:**
- Modify: `scripts/brain-deploy.sh:211-248`（Docker 模式先删后建段）
- Test: `tests/packages/brain/bluegreen-deploy-contract.test.js`

**Interfaces:**
- Consumes: `scripts/lib/bluegreen.sh` 的 `bluegreen_swap`。

- [ ] **Step 1: 写文本契约 failing 测试**

```javascript
// tests/packages/brain/bluegreen-deploy-contract.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const SH = resolve(__dirname, '../../../scripts/brain-deploy.sh');
describe('brain-deploy blue-green contract', () => {
  const txt = readFileSync(SH, 'utf8');
  it('source bluegreen.sh 并调 bluegreen_swap', () => {
    expect(txt).toMatch(/source .*scripts\/lib\/bluegreen\.sh/);
    expect(txt).toContain('bluegreen_swap');
  });
  it('不再在 green 验证前无条件 docker rm -f blue', () => {
    // 原 line 225-228 的无条件 rm -f cecelia-node-brain 段必须移除/移入 bluegreen_swap
    const before = txt.split('bluegreen_swap')[0];
    expect(before).not.toMatch(/xargs docker rm -f/);
  });
});
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `cd packages/brain && npx vitest run ../../tests/packages/brain/bluegreen-deploy-contract.test.js` （或用仓库测试命令）
Expected: FAIL。

- [ ] **Step 3: 改 brain-deploy.sh**

替换 211-248 段为：source `$SCRIPT_DIR/lib/bluegreen.sh`；保留幂等 skip（217-221）；导出 `GREEN_RUN_ARGS`（从既有 compose 的 env/mounts 组装，或复用 compose：先 `TARGET_VERSION=$VERSION bluegreen_swap`，通过则走既有 `docker compose up -d` + health + rollback；未通过则脚本 `exit 1`）。删除 223-228 的无条件 `docker rm -f`。

```bash
    # 7. Blue-green swap（green canary 验证后才动 blue）
    echo "[7/8] Blue-green 切换..."
    source "$SCRIPT_DIR/lib/bluegreen.sh"
    # 幂等：同 image SHA 跳过（保留原 217-221 逻辑于此之前）
    if ! TARGET_VERSION="${VERSION}" BLUE_NAME=cecelia-node-brain \
         GREEN_NAME=cecelia-node-brain-green TEMP_PORT=5223 bluegreen_swap; then
      echo "[FAIL] green 未通过，已保留旧生产容器，终止部署"
      exit 1
    fi
    # green 已通过、blue 已删，起新生产容器（既有 compose up + rollback 逻辑）
    if ! BRAIN_VERSION="${VERSION}" ENV_REGION="${ENV_REGION}" \
       docker compose -f "$ROOT_DIR/docker-compose.yml" up -d; then
      # …既有 rollback 段保留…
      exit 1
    fi
```

- [ ] **Step 4: 跑测试确认 pass**

Run: 同 Step 2
Expected: PASS。

- [ ] **Step 5: commit**

```bash
git add scripts/brain-deploy.sh tests/packages/brain/bluegreen-deploy-contract.test.js
git commit -m "feat(deploy): brain-deploy.sh 接 bluegreen_swap 替换先删后建"
```

---

### Task 4: BRAIN_DEPLOY_CANARY 关 tick（canary 不 double-dispatch）

**Files:**
- Modify: `packages/brain/src/tick-recovery.js`（initTickLoop 入口早返）
- Test: `packages/brain/src/__tests__/canary-no-tick.test.js`

- [ ] **Step 1: 写 failing 测试**

```javascript
// canary-no-tick.test.js —— BRAIN_DEPLOY_CANARY=1 时 initTickLoop 不启动 tick loop
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../tick-loop.js', () => ({ startTickLoop: vi.fn(), stopTickLoop: vi.fn() }));
describe('canary tick gate', () => {
  beforeEach(() => vi.resetModules());
  it('BRAIN_DEPLOY_CANARY=1 → initTickLoop 不调 startTickLoop', async () => {
    vi.stubEnv('BRAIN_DEPLOY_CANARY', '1');
    const loop = await import('../tick-loop.js');
    const { initTickLoop } = await import('../tick-recovery.js');
    await initTickLoop();
    expect(loop.startTickLoop).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑确认 fail** — `cd packages/brain && npx vitest run src/__tests__/canary-no-tick.test.js` → FAIL。

- [ ] **Step 3: 改 tick-recovery.js** —— initTickLoop 函数体最前面加：

```javascript
  if (process.env.BRAIN_DEPLOY_CANARY === '1') {
    tickLog('[tick-loop] BRAIN_DEPLOY_CANARY=1 — canary 模式，跳过 tick loop 启动');
    return { success: true, enabled: false, loop_running: false, canary: true };
  }
```

- [ ] **Step 4: 跑确认 pass**。

- [ ] **Step 5: commit** — `git commit -m "feat(brain): BRAIN_DEPLOY_CANARY 关 tick，canary 不与生产抢派发"`

---

### Task 5: docker-compose.staging.yml 独立 compose project

**Files:**
- Modify: `docker-compose.staging.yml`（顶部加 name）
- Test: `packages/brain/src/__tests__/staging-project-isolation.test.js`

- [ ] **Step 1: failing 测试**

```javascript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const F = resolve(__dirname, '../../../../docker-compose.staging.yml');
it('staging 有独立 compose project name（不共用 cecelia）', () => {
  const txt = readFileSync(F, 'utf8');
  expect(txt).toMatch(/^name:\s*cecelia-staging\s*$/m);
});
```

- [ ] **Step 2: 跑确认 fail**。
- [ ] **Step 3: docker-compose.staging.yml 顶部加** `name: cecelia-staging`（在 services: 之前）。
- [ ] **Step 4: 跑确认 pass**。
- [ ] **Step 5: commit** — `git commit -m "fix(deploy): staging 独立 compose project cecelia-staging，杜绝跨环境 orphan"`

---

### Task 6: 部署后 5221 自检 + Bark（proven-to-fire 环境守卫）

**Files:**
- Modify: `scripts/brain-deploy.sh`（run_post_deploy_smoke 末尾或 health 段后加 5221 自检 + send_bark）
- Test: `tests/packages/brain/post-deploy-selfcheck-contract.test.js`

- [ ] **Step 1: failing 文本契约测试**

```javascript
import { readFileSync } from 'node:fs'; import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
const SH = resolve(__dirname, '../../../scripts/brain-deploy.sh');
it('部署后自检 5221 /health 非200 → send_bark 告警', () => {
  const txt = readFileSync(SH, 'utf8');
  expect(txt).toMatch(/localhost:5221\/api\/brain\/tick\/status/);
  expect(txt).toContain('send_bark');   // 失败告警
});
```

- [ ] **Step 2: 跑确认 fail**。
- [ ] **Step 3: brain-deploy.sh** 在部署成功 health 段后加：curl 5221 /tick/status，非 200 → `send_bark "部署后自检失败：5221 未响应"`（source bluegreen.sh 已引入 send_bark）。
- [ ] **Step 4: 跑确认 pass**。
- [ ] **Step 5: proven-to-fire 手动验证**（记 sprint 笔记）：本地停 5221 容器 → 跑自检段 → 亲眼见 send_bark 触发。
- [ ] **Step 6: commit** — `git commit -m "feat(deploy): 部署后 5221 自检失败 Bark 告警(环境守卫)"`

---

## Self-Review 覆盖核对
- 蓝绿(失败保留blue)=Task1/2/3；canary不double-dispatch=Task4；staging隔离=Task5；部署后自检Bark=Task6。全部 spec 验收项有对应 task。
- 命名一致：blue=cecelia-node-brain / green=cecelia-node-brain-green / 端口5223 / env BRAIN_DEPLOY_CANARY，全 plan 统一。
