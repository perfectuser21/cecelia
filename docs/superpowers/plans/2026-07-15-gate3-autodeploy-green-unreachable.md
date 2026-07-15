# Gate3 自动部署恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Gate3 webhook 自动部署两处根因——pre-swap smoke 在容器内连不上 green canary（主）、workflow 变更检测 fallback 死代码（latent）——恢复 brain merge 后自动上生产。

**Architecture:** 修 A 在 `scripts/lib/bluegreen.sh`：green 加入 blue 所在 docker 网络 + `GREEN_URL` 双模式解析（宿主 localhost:5223 / 容器内 green_ip:5221），smoke 用解析结果。修 B 抽 `scripts/ci/gate3-changed-paths.sh` 修死代码 fallback。全部 TDD：每修先 failing test（commit-1）再实现（commit-2）。

**Tech Stack:** bash + vitest（PATH mock docker/curl 模式，仿 `packages/brain/src/__tests__/bluegreen-swap.test.js`）+ bash 自洽测试（仿 `scripts/ci/__tests__/assert-deploy-effect.test.sh`）。

**规则**：TDD 铁律 NO PRODUCTION CODE WITHOUT FAILING TEST FIRST；所有输出简体中文。

---

### Task 1: gate3-changed-paths bash 测试（Red）

**Files:**
- Create: `scripts/ci/__tests__/gate3-changed-paths.test.sh`

- [ ] **Step 1: 写 failing test**

```bash
#!/usr/bin/env bash
# gate3-changed-paths.test.sh — Gate3 变更检测回归测试
# 根治 2026-07-15 假跳过 P1：原 workflow 内联管道的 || echo fallback 是死代码
# （管道退出码取 tr 恒 0），shallow diff 失败/无命中时静默送出空列表。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUT="$SCRIPT_DIR/../gate3-changed-paths.sh"
FAILED=0

# 自洽临时 git 仓库
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
git init -q
git config user.email t@t && git config user.name t
mkdir -p packages/brain/src
echo a > packages/brain/src/foo.js && echo r > README.md
git add -A && git commit -qm c1
C1=$(git rev-parse HEAD)
echo b > packages/brain/src/foo.js
git add -A && git commit -qm c2
C2=$(git rev-parse HEAD)
echo r2 > README.md
git add -A && git commit -qm c3
C3=$(git rev-parse HEAD)

assert_eq() { # $1=case $2=expected $3=actual
  if [[ "$3" == "$2" ]]; then echo "  ✅ $1"; else echo "  ❌ $1: 期望 [$2] 实得 [$3]"; FAILED=1; fi
}

# case1 正常命中：C1..C2 改了 packages/brain/src/foo.js
OUT=$(bash "$SUT" "$C1" "$C2")
assert_eq "正常命中" "packages/brain/src/foo.js " "$OUT"

# case2 grep 无命中（C2..C3 只改 README）→ fallback packages/brain/
OUT=$(bash "$SUT" "$C2" "$C3")
assert_eq "无 brain 命中 fallback" "packages/brain/" "$OUT"

# case3 diff 失败（伪 SHA）→ fallback packages/brain/
OUT=$(bash "$SUT" "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" "$C2")
assert_eq "diff 失败 fallback" "packages/brain/" "$OUT"

# case4 首次 push（BEFORE 全零）→ packages/brain/
OUT=$(bash "$SUT" "0000000000000000000000000000000000000000" "$C2")
assert_eq "首次 push" "packages/brain/" "$OUT"

[[ "$FAILED" == 0 ]] && echo "gate3-changed-paths.test.sh: OK" || { echo "gate3-changed-paths.test.sh: FAILED"; exit 1; }
```

- [ ] **Step 2: 跑测试确认 Red**

Run: `bash scripts/ci/__tests__/gate3-changed-paths.test.sh`
Expected: FAIL（SUT 不存在，bash 报 No such file）——proven-to-fire 证据，记录输出。

- [ ] **Step 3: Commit（test Red 先行）**

```bash
git add scripts/ci/__tests__/gate3-changed-paths.test.sh
git commit -m "test(ci): gate3-changed-paths 回归测试先行（Red）——假跳过 P1 复现"
```

### Task 2: gate3-changed-paths.sh 实现（Green）

**Files:**
- Create: `scripts/ci/gate3-changed-paths.sh`

- [ ] **Step 1: 实现**

```bash
#!/usr/bin/env bash
# gate3-changed-paths.sh — Gate3「计算变更路径」抽出可测脚本
# 用法: gate3-changed-paths.sh <BEFORE_SHA> <AFTER_SHA>
# stdout: 空格分隔的 brain 相关变更路径；检测不出时 fallback "packages/brain/"
#
# 背景（2026-07-15 假跳过 P1）：原 workflow 内联
#   git diff | grep | tr '\n' ' ' || echo "packages/brain/"
# 的 fallback 是死代码——管道退出码取最后命令 tr（恒 0），shallow diff 失败
# （fetch-depth:2 下 BEFORE 不可达）或 grep 无命中时静默送出空列表，下游
# deploy-local.sh 判"无 Brain 改动"跳过真部署。
# 本 workflow job 有 paths 过滤器（packages/brain/** + scripts/brain-deploy.sh），
# 跑到这里必然有 brain 改动 → 空结果 fallback 全量 brain 部署是安全的。
set -uo pipefail

BEFORE="${1:-}"
AFTER="${2:-}"
CHANGED=""

if [[ -n "$BEFORE" && "$BEFORE" != "0000000000000000000000000000000000000000" ]]; then
  CHANGED=$(git diff --name-only "$BEFORE" "$AFTER" 2>/dev/null \
    | grep -E "^packages/brain/|^scripts/brain-deploy\.sh" | tr '\n' ' ') || true
fi

if [[ -z "${CHANGED//[[:space:]]/}" ]]; then
  echo "WARN: 变更检测为空（首次 push / shallow diff 失败 / grep 无命中）→ fallback 全量 brain 部署" >&2
  CHANGED="packages/brain/"
fi

echo "$CHANGED"
```

`chmod +x scripts/ci/gate3-changed-paths.sh`

- [ ] **Step 2: 跑测试确认 Green**

Run: `bash scripts/ci/__tests__/gate3-changed-paths.test.sh`
Expected: 4 个 ✅ + `OK`

- [ ] **Step 3: ci.yml 接线（必办——scripts/ci 的 bash 测试无 glob 自动发现）**

在 `.github/workflows/ci.yml` 中找到 `run: bash scripts/ci/__tests__/assert-deploy-effect.test.sh` 那一行（约 497 行）所在 job，紧随其后加同级 step：

```yaml
      - name: gate3-changed-paths 回归测试
        run: bash scripts/ci/__tests__/gate3-changed-paths.test.sh
```

（缩进对齐相邻 step；先 `grep -n "assert-deploy-effect.test.sh" .github/workflows/ci.yml` 找准位置和缩进。）

- [ ] **Step 4: Commit**

```bash
git add scripts/ci/gate3-changed-paths.sh .github/workflows/ci.yml
git commit -m "fix(ci): gate3 变更检测抽脚本修死代码 fallback——空结果强制全量 brain 部署"
```

### Task 3: brain-ci-deploy.yml 改调脚本

**Files:**
- Modify: `.github/workflows/brain-ci-deploy.yml`（「计算变更路径」step，约 88-102 行）

- [ ] **Step 1: 替换 step**

把原 step：

```yaml
      - name: 计算变更路径
        id: paths
        run: |
          BEFORE="${{ github.event.before }}"
          AFTER="${{ github.event.after }}"

          if [ "$BEFORE" = "0000000000000000000000000000000000000000" ]; then
            CHANGED="packages/brain/"
          else
            CHANGED=$(git diff --name-only "$BEFORE" "$AFTER" 2>/dev/null \
              | grep -E "^packages/brain/|^scripts/brain-deploy\.sh" | tr '\n' ' ' || echo "packages/brain/")
          fi

          echo "changed_paths=$CHANGED" >> $GITHUB_OUTPUT
          echo "Brain 变更路径: $CHANGED"
```

替换为：

```yaml
      - name: 计算变更路径
        id: paths
        run: |
          CHANGED=$(bash scripts/ci/gate3-changed-paths.sh "${{ github.event.before }}" "${{ github.event.after }}")
          echo "changed_paths=$CHANGED" >> $GITHUB_OUTPUT
          echo "Brain 变更路径: $CHANGED"
```

- [ ] **Step 2: 语法验证**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/brain-ci-deploy.yml'))" && echo YAML_OK`
Expected: `YAML_OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/brain-ci-deploy.yml
git commit -m "fix(gate3): 计算变更路径改调 gate3-changed-paths.sh（fallback 可测可用）"
```

### Task 4: bluegreen GREEN_URL vitest（Red）

**Files:**
- Create: `packages/brain/src/__tests__/bluegreen-green-url.test.js`

- [ ] **Step 1: 写 failing test**

先读 `packages/brain/src/__tests__/bluegreen-swap.test.js` 全文，掌握其 helper（HOME 覆盖、PATH 注入、runSwap 调用方式），然后新建：

```js
/**
 * bluegreen-green-url.test.js — 回归测试（2026-07-15 Gate3 全红根因）
 *
 * 根因：webhook 链路 brain-deploy.sh 在 cecelia-node-brain 容器内执行，
 * pre-swap smoke 用 BRAIN_URL=http://localhost:5223 探 green，但 green 发布端口
 * 在宿主且 green 起在默认 bridge（blue 在 cecelia_default）→ 容器内秒拒，
 * 4/5 smoke 必挂 → 自动部署永远失败（手动宿主跑则可达全过）。
 *
 * 不变量：
 *  1. green docker run 必须带 --network <blue 所在网络>
 *  2. localhost:TEMP_PORT 不可达而 green_ip 可达时，smoke 的 BRAIN_URL = http://<green_ip>:5221
 *  3. localhost:TEMP_PORT 可达（宿主模式）时，smoke 的 BRAIN_URL = http://localhost:5223（回归保护）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const BG_LIB = resolve(REPO_ROOT, 'scripts/lib/bluegreen.sh');
const GREEN_IP = '192.168.97.99';

/**
 * mock docker：
 *  - inspect ... NetworkSettings.Networks + $k（取网络名）→ cecelia_default
 *  - inspect ... IPAddress → GREEN_IP
 *  - inspect ... State.Status → running
 *  - inspect ... State.Health → healthy（但 curl 先通就轮不到它）
 *  - run/rm/tag/start/compose → 记录 args 后 exit 0
 * mock curl：
 *  - 记录 URL；URL 含 CURL_OK_PATTERN 才 exit 0，否则 exit 7（connect refused 模拟）
 */
function makeMocks(dir, { curlOkPattern }) {
  const dockerLog = join(dir, 'docker.log');
  const curlLog = join(dir, 'curl.log');
  writeFileSync(dockerLog, '');
  writeFileSync(curlLog, '');
  const docker = `#!/usr/bin/env bash
echo "$@" >> "${dockerLog}"
case "$1" in
  inspect)
    if echo "$@" | grep -q 'IPAddress'; then echo "${GREEN_IP}"; exit 0; fi
    if echo "$@" | grep -q 'NetworkSettings.Networks'; then echo "cecelia_default "; exit 0; fi
    if echo "$@" | grep -q 'State.Status'; then echo "running"; exit 0; fi
    if echo "$@" | grep -q 'State.Health'; then echo "healthy"; exit 0; fi
    echo "sha256:fake"; exit 0 ;;
  *) exit 0 ;;
esac
`;
  const curl = `#!/usr/bin/env bash
URL=""
for a in "$@"; do case "$a" in http*) URL="$a";; esac; done
echo "$URL" >> "${curlLog}"
echo "$URL" | grep -q "${curlOkPattern}" && exit 0
exit 7
`;
  writeFileSync(join(dir, 'docker'), docker); chmodSync(join(dir, 'docker'), 0o755);
  writeFileSync(join(dir, 'curl'), curl); chmodSync(join(dir, 'curl'), 0o755);
  return { dockerLog, curlLog };
}

/** 部署根 fixture：smoke-core.txt + 一条把 BRAIN_URL 写盘的 smoke */
function makeDeployRoot(dir) {
  const root = join(dir, 'deployroot');
  mkdirSync(join(root, 'packages/quality'), { recursive: true });
  mkdirSync(join(root, 'packages/brain/scripts/smoke'), { recursive: true });
  writeFileSync(join(root, 'packages/quality/smoke-core.txt'), 'echo-brain-url-smoke.sh\n');
  const resultFile = join(dir, 'smoke-brain-url.txt');
  writeFileSync(
    join(root, 'packages/brain/scripts/smoke/echo-brain-url-smoke.sh'),
    `#!/usr/bin/env bash\necho "\${BRAIN_URL:-UNSET}" > "${resultFile}"\nexit 0\n`
  );
  chmodSync(join(root, 'packages/brain/scripts/smoke/echo-brain-url-smoke.sh'), 0o755);
  return { root, resultFile };
}

function runSwap(dir, extraEnv = {}) {
  const fakeHome = join(dir, 'home');
  mkdirSync(fakeHome, { recursive: true });
  return execSync(
    `bash -c 'source "${BG_LIB}" && TARGET_VERSION=9.9.9 TEMP_PORT=5223 HEALTH_TIMEOUT=6 bluegreen_swap'`,
    {
      env: {
        ...process.env,
        ...extraEnv,
        PATH: `${dir}:${process.env.PATH}`,
        HOME: fakeHome,
      },
      encoding: 'utf8',
    }
  );
}

describe('bluegreen GREEN_URL 双模式（Gate3 全红根因回归）', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bg-url-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('green docker run 带 --network <blue 所在网络>', () => {
    const { dockerLog } = makeMocks(dir, { curlOkPattern: 'localhost:5223' });
    const { root } = makeDeployRoot(dir);
    runSwap(dir, { DEPLOY_ROOT_DIR: root });
    const runLine = readFileSync(dockerLog, 'utf8').split('\n')
      .find((l) => l.startsWith('run ') && l.includes('cecelia-node-brain-green'));
    expect(runLine).toBeTruthy();
    expect(runLine).toContain('--network cecelia_default');
  });

  it('容器模式：localhost 不可达 → smoke BRAIN_URL 用 green_ip:5221', () => {
    makeMocks(dir, { curlOkPattern: `${GREEN_IP}:5221` });
    const { root, resultFile } = makeDeployRoot(dir);
    runSwap(dir, { DEPLOY_ROOT_DIR: root });
    expect(existsSync(resultFile)).toBe(true);
    expect(readFileSync(resultFile, 'utf8').trim()).toBe(`http://${GREEN_IP}:5221`);
  });

  it('宿主模式：localhost 可达 → smoke BRAIN_URL 保持 localhost:5223（回归保护）', () => {
    makeMocks(dir, { curlOkPattern: 'localhost:5223' });
    const { root, resultFile } = makeDeployRoot(dir);
    runSwap(dir, { DEPLOY_ROOT_DIR: root });
    expect(existsSync(resultFile)).toBe(true);
    expect(readFileSync(resultFile, 'utf8').trim()).toBe('http://localhost:5223');
  });
});
```

> 若读 bluegreen-swap.test.js 发现其 runSwap/source 调用方式不同（如需先 `set +e`、或 bluegreen_swap 非 0 退出会 throw），照它的写法调整——execSync 对非 0 退出会 throw，本用例期望 swap 成功（exit 0），若 mock 造成中途失败先修 mock 而非吞异常。

- [ ] **Step 2: 跑测试确认 Red**

Run: `cd packages/brain && npx vitest run src/__tests__/bluegreen-green-url.test.js --reporter=verbose`
Expected: 3 个用例全 FAIL（现网代码无 --network、BRAIN_URL 写死 localhost）。case3 可能意外 PASS（现状就是 localhost）——允许，前两个必须 Red。记录输出（proven-to-fire）。

- [ ] **Step 3: Commit（Red 先行）**

```bash
git add packages/brain/src/__tests__/bluegreen-green-url.test.js
git commit -m "test(bluegreen): GREEN_URL 双模式回归测试先行（Red）——Gate3 全红根因复现"
```

### Task 5: bluegreen.sh 实现（Green）

**Files:**
- Modify: `scripts/lib/bluegreen.sh`（green 启动块 + health poll 块 + smoke BRAIN_URL 行）

- [ ] **Step 1: green 启动加 --network**

在 `bluegreen_swap()` 内，把：

```bash
  echo "[bluegreen] 起 green canary（${green}，端口 ${port}，tick 关）..."
  docker rm -f "$green" >/dev/null 2>&1 || true
  # BRAIN_DEPLOY_CANARY=1 关 tick，避免 canary 与 blue 连同一 DB double-dispatch
  # shellcheck disable=SC2086
  if ! docker run -d --name "$green" -p "${port}:5221" \
        -e BRAIN_DEPLOY_CANARY=1 ${GREEN_RUN_ARGS:-} "cecelia-brain:${version}" >/dev/null 2>&1; then
```

改为：

```bash
  echo "[bluegreen] 起 green canary（${green}，端口 ${port}，tick 关）..."
  docker rm -f "$green" >/dev/null 2>&1 || true
  # green 必须加入 blue 所在网络：webhook 链路里本脚本在 blue 容器内执行，
  # 容器内 localhost:${port} 是 blue 自己的 loopback 而非宿主端口；green 落默认
  # bridge 则与 blue 跨网络隔离 → health/smoke 全部秒拒（2026-07-15 Gate3 全红根因）。
  local blue_net="" net_args=""
  blue_net=$(docker inspect "$blue" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null | awk '{print $1}') || true
  [[ -n "$blue_net" ]] && net_args="--network ${blue_net}"
  # BRAIN_DEPLOY_CANARY=1 关 tick，避免 canary 与 blue 连同一 DB double-dispatch
  # shellcheck disable=SC2086
  if ! docker run -d --name "$green" -p "${port}:5221" ${net_args} \
        -e BRAIN_DEPLOY_CANARY=1 ${GREEN_RUN_ARGS:-} "cecelia-brain:${version}" >/dev/null 2>&1; then
```

- [ ] **Step 2: health poll 改双模式并锁定 green_url**

把 poll 块：

```bash
  # poll green health（先 curl 临时端口，兜底 docker inspect health）
  local elapsed=0 healthy=false
  while [ "$elapsed" -lt "$timeout" ]; do
    if curl -sf "http://localhost:${port}/api/brain/tick/status" >/dev/null 2>&1; then
      healthy=true; break
    fi
    local hs
    hs=$(docker inspect "$green" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || echo missing)
    if [ "$hs" = "healthy" ]; then healthy=true; break; fi
    if [ "$hs" = "unhealthy" ]; then break; fi
    sleep 2; elapsed=$((elapsed + 2))
  done
```

改为：

```bash
  # poll green health（GREEN_URL 双模式：宿主执行走 localhost:${port}，容器内执行走
  # green_ip:5221 直连；兜底 docker inspect health）。锁定的 green_url 供 pre-swap smoke 复用。
  local elapsed=0 healthy=false green_url="" green_ip=""
  while [ "$elapsed" -lt "$timeout" ]; do
    if curl -sf --max-time 3 "http://localhost:${port}/api/brain/tick/status" >/dev/null 2>&1; then
      healthy=true; green_url="http://localhost:${port}"; break
    fi
    green_ip=$(docker inspect "$green" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null) || true
    if [[ -n "$green_ip" ]] && curl -sf --max-time 3 "http://${green_ip}:5221/api/brain/tick/status" >/dev/null 2>&1; then
      healthy=true; green_url="http://${green_ip}:5221"; break
    fi
    local hs
    hs=$(docker inspect "$green" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || echo missing)
    if [ "$hs" = "healthy" ]; then healthy=true; break; fi
    if [ "$hs" = "unhealthy" ]; then break; fi
    sleep 2; elapsed=$((elapsed + 2))
  done
  # docker inspect 兜底通过（两路 curl 都没通）时默认 green_ip 直连（容器内场景最可能可达）
  if [[ "$healthy" == true && -z "$green_url" ]]; then
    [[ -z "$green_ip" ]] && green_ip=$(docker inspect "$green" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null) || true
    if [[ -n "$green_ip" ]]; then green_url="http://${green_ip}:5221"; else green_url="http://localhost:${port}"; fi
  fi
```

- [ ] **Step 3: smoke 用 green_url**

把 smoke 执行行：

```bash
      if BRAIN_URL="http://localhost:${port}" bash "$_sf"; then
```

改为：

```bash
      if BRAIN_URL="${green_url}" bash "$_sf"; then
```

并把 smoke 段开头的日志行 `echo "[bluegreen] 跑 pre-swap 核心 smoke（green:${port}，预算 ...` 改为 `echo "[bluegreen] 跑 pre-swap 核心 smoke（${green_url}，预算 ...`（保留原预算变量部分不动）。

- [ ] **Step 4: 语法冒烟 + 跑新测试确认 Green**

Run: `bash -n scripts/lib/bluegreen.sh && cd packages/brain && npx vitest run src/__tests__/bluegreen-green-url.test.js --reporter=verbose`
Expected: 3 个用例全 PASS

- [ ] **Step 5: 跑既有蓝绿回归（防打破 5 条既有不变量）**

Run: `cd packages/brain && npx vitest run src/__tests__/bluegreen-swap.test.js --reporter=verbose`
Expected: 全 PASS。若因 mock docker 不识别 `NetworkSettings.Networks` 格式而 FAIL：在该测试的 mock docker `inspect` 分支最前面加两个新 case（`IPAddress` → echo 空、`NetworkSettings.Networks` → echo 空），保持旧行为（green 落现状网络、无 IP → green_url 退回 localhost），不改断言。

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/bluegreen.sh packages/brain/src/__tests__/bluegreen-swap.test.js
git commit -m "fix(bluegreen): green 加入 blue 网络 + GREEN_URL 双模式——根治容器内 pre-swap smoke 秒拒"
```

### Task 6: brain 版本 bump + DevGate

**Files:**
- Modify: `packages/brain/package.json`（version 1.263.1 → 1.263.2）+ check-version-sync.sh 要求的其余同步点

- [ ] **Step 1: bump 并同步**

```bash
cd <worktree 根>
sed -i '' 's/"version": "1.263.1"/"version": "1.263.2"/' packages/brain/package.json
bash scripts/check-version-sync.sh || true   # 看它报哪些位置不同步
```

按脚本输出把所有不同步位置（如 package-lock.json 两处、.brain-versions 等）改到 1.263.2，直到：

Run: `bash scripts/check-version-sync.sh`
Expected: 通过（exit 0）

- [ ] **Step 2: DevGate**

Run: `node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && echo DEVGATE_OK`
Expected: `DEVGATE_OK`

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(brain): bump 1.263.2——Gate3 自动部署修复上线载体"
```

### Task 7: 全量相关测试

- [ ] **Step 1: brain 相关单测**

Run: `cd packages/brain && npx vitest run src/__tests__/bluegreen-green-url.test.js src/__tests__/bluegreen-swap.test.js src/__tests__/deploy-webhook-log.test.js src/__tests__/deploy-root-guard.test.js --reporter=verbose`
Expected: 全 PASS

- [ ] **Step 2: bash 测试**

Run: `bash scripts/ci/__tests__/gate3-changed-paths.test.sh && bash scripts/ci/__tests__/assert-deploy-effect.test.sh`
Expected: 两个 OK

## Self-Review 已过

- Spec 覆盖：修 A=Task 4/5，修 B=Task 1/2/3，ci.yml 接线=Task 2 Step 3，版本/DevGate=Task 6 ✅
- 无占位符；green_url 变量名各 Task 一致 ✅
