# Runner Canonical Repin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 runner 镜像 digest/pin 漂移致 fleet 三机准入全挂：一次性 repin 到正规构建的 canonical 镜像 `sha256:08c904ff0dc216229b84d2ce7216760fcb9968a43351916f8495265b3956bd4f`，并加两道永久守卫（build 漂移守卫 + pin 互锁测试）与 installer ORBSTACK_HOME 自动推导。

**Architecture:** 数据变更（11 处 pin + 版本四处）+ 两个独立 shell 守卫（docker/verify-digest-pin.sh、canonical-pin-consistency.test.sh）+ installer 默认值推导链。全部 shell 测试走 ci.yml:406 的 `packages/brain/scripts/fleet-worker/*.test.sh` glob 自动接线。

**Tech Stack:** bash（macOS /bin/bash 3.2 兼容）、docker CLI、node（读 JSON）。

## Global Constraints

- 新 canonical digest（全文唯一真值）：`sha256:08c904ff0dc216229b84d2ce7216760fcb9968a43351916f8495265b3956bd4f`
- 旧 digest（被替换）：`sha256:349c40cc901caddf7ef491ee27f7e415603450824913be74a1d99f4bf14c85ff`
- 改 packages/brain 前后必过 DevGate：`node scripts/facts-check.mjs` && `bash scripts/check-version-sync.sh` && `node packages/quality/scripts/devgate/check-dod-mapping.cjs`
- brain 版本 bump patch（读 packages/brain/package.json 现值 +1），四处同步：package.json / package-lock.json(两处 version 字段) / .brain-versions(追加行) / DEFINITION.md「Brain 版本」行
- worker 版本 pin 三组必与新 brain 版本一致：node-profile.js version_policy.worker、fleet-node-profiles.json 三机、node-probe.cjs DEFAULT_WORKER_VERSION
- shell 脚本禁 bash 4+ 特性（macOS 自带 bash 3.2）；测试外部命令一律 env 注入 mock（禁 mock 不存在的接缝，见 install-fleet-worker.test.sh 既有模式）
- 提交遵循 Conventional Commits；测试先红后绿两段 commit

---

### Task 1: docker/verify-digest-pin.sh 漂移守卫（TDD）

**Files:**
- Create: `docker/verify-digest-pin.sh`
- Create: `packages/brain/scripts/fleet-worker/verify-digest-pin.test.sh`
- Modify: `docker/build.sh`（末尾接调用）

**Interfaces:**
- Produces: `bash docker/verify-digest-pin.sh [<image-ref>]`（默认 `cecelia/runner:latest`）。退出码：0=一致；3=漂移（stderr 打印实际 digest、pin digest、全部 pin 文件清单与 repin 指引）；1=环境错误（docker 不可用/镜像不存在/pin 解析失败）。env 注入：`VERIFY_PIN_DOCKER`（docker 命令 mock）、`VERIFY_PIN_NODE_PROFILE`（node-profile.js 路径覆盖）。

- [ ] **Step 1: 写 failing test**

`packages/brain/scripts/fleet-worker/verify-digest-pin.test.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
VERIFIER="$REPO_ROOT/docker/verify-digest-pin.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }

[[ -f "$VERIFIER" ]] || fail "missing docker/verify-digest-pin.sh"

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

PIN='sha256:1111111111111111111111111111111111111111111111111111111111111111'
OTHER='sha256:2222222222222222222222222222222222222222222222222222222222222222'

# 假 node-profile.js（只要 runner_image_digest 行形态一致即可被解析）
cat > "$test_root/node-profile.js" << EOF
const CANONICAL_BASELINE = Object.freeze({
  runner_image_digest: '$PIN',
});
EOF

# mock docker：docker image inspect --format {{.Id}} <ref> → 输出预设 digest
make_docker() {
  local digest="$1"
  cat > "$test_root/docker" << EOF
#!/usr/bin/env bash
if [[ "\$1" == image && "\$2" == inspect ]]; then
  printf '%s\n' '$digest'
  exit 0
fi
exit 64
EOF
  chmod +x "$test_root/docker"
}

# case 1: digest 与 pin 一致 → exit 0
make_docker "$PIN"
VERIFY_PIN_DOCKER="$test_root/docker" \
  VERIFY_PIN_NODE_PROFILE="$test_root/node-profile.js" \
  bash "$VERIFIER" cecelia/runner:test >/dev/null 2>&1 \
  || fail "match case should exit 0"

# case 2: 漂移 → exit 3 且 stderr 含 repin 指引
make_docker "$OTHER"
set +e
stderr_out="$(VERIFY_PIN_DOCKER="$test_root/docker" \
  VERIFY_PIN_NODE_PROFILE="$test_root/node-profile.js" \
  bash "$VERIFIER" cecelia/runner:test 2>&1 >/dev/null)"
status=$?
set -e
[[ "$status" -eq 3 ]] || fail "drift case should exit 3, got $status"
printf '%s' "$stderr_out" | grep -q "$OTHER" || fail "drift stderr should show actual digest"
printf '%s' "$stderr_out" | grep -q 'node-profile.js' || fail "drift stderr should list pin files"

# case 3: 镜像不存在（docker inspect 失败）→ exit 1
cat > "$test_root/docker" << 'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$test_root/docker"
set +e
VERIFY_PIN_DOCKER="$test_root/docker" \
  VERIFY_PIN_NODE_PROFILE="$test_root/node-profile.js" \
  bash "$VERIFIER" cecelia/runner:test >/dev/null 2>&1
status=$?
set -e
[[ "$status" -eq 1 ]] || fail "missing image should exit 1, got $status"

echo "PASS: verify-digest-pin.test.sh"
```

- [ ] **Step 2: 跑测试确认红**

Run: `bash packages/brain/scripts/fleet-worker/verify-digest-pin.test.sh`
Expected: `FAIL: missing docker/verify-digest-pin.sh`（exit 1）

- [ ] **Step 3: commit-1（红测试）**

```bash
git add packages/brain/scripts/fleet-worker/verify-digest-pin.test.sh
git commit -m "test(fleet): verify-digest-pin 漂移守卫 failing test [task 65334686]"
```

- [ ] **Step 4: 实现 docker/verify-digest-pin.sh**

```bash
#!/usr/bin/env bash
# docker/verify-digest-pin.sh — 校验 runner 镜像实际 digest 与 canonical pin 一致
#
# 用法: bash docker/verify-digest-pin.sh [<image-ref>]   # 默认 cecelia/runner:latest
# 退出码: 0=一致 / 3=漂移(必须 repin) / 1=环境错误
#
# 背景: 2026-08-08 #4720 绕过 build.sh 重建镜像未同步 pin，fleet 三机准入静默全挂。
# 本守卫由 build.sh 末尾强制调用：rebuild 后 pin 未同步就见红，漂移无法再静默。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_REF="${1:-cecelia/runner:latest}"
DOCKER="${VERIFY_PIN_DOCKER:-docker}"
NODE_PROFILE="${VERIFY_PIN_NODE_PROFILE:-$REPO_ROOT/packages/brain/src/orchestrator/fleet-node/node-profile.js}"

PIN_FILES='packages/brain/src/orchestrator/fleet-node/node-profile.js
packages/brain/src/orchestrator/fleet-node/node-profile.test.js
packages/brain/config/fleet-node-profiles.json
packages/brain/scripts/fleet-worker/fleet-rollout.sh
packages/brain/scripts/fleet-worker/fleet-rollout.test.sh
packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.sh
packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh
packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh
packages/brain/scripts/smoke/provider-neutral-phase4a-node-smoke.sh
DEFINITION.md'

[[ -f "$NODE_PROFILE" ]] || { echo "[verify-digest-pin] node-profile.js 不存在: $NODE_PROFILE" >&2; exit 1; }

pinned="$(sed -nE "s/.*runner_image_digest: '([^']+)'.*/\1/p" "$NODE_PROFILE" | head -1)"
[[ "$pinned" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || { echo "[verify-digest-pin] 无法从 node-profile.js 解析 pin digest" >&2; exit 1; }

actual="$("$DOCKER" image inspect --format '{{.Id}}' "$IMAGE_REF" 2>/dev/null)" \
  || { echo "[verify-digest-pin] docker inspect 失败（docker 不可用或镜像不存在: $IMAGE_REF）" >&2; exit 1; }
[[ "$actual" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || { echo "[verify-digest-pin] docker inspect 输出异常: $actual" >&2; exit 1; }

if [[ "$actual" == "$pinned" ]]; then
  echo "[verify-digest-pin] OK: $IMAGE_REF digest 与 canonical pin 一致 ($pinned)"
  exit 0
fi

{
  echo "[verify-digest-pin] ❌ 镜像 digest 与 canonical pin 漂移"
  echo "  实际: $actual"
  echo "  pin:  $pinned"
  echo "  这不是可忽略的警告——fleet 三机准入按 pin 校验，漂移=准入静默全挂。"
  echo "  正解（禁只改一处）：把以下全部文件中的旧 digest 一次性替换为新 digest，"
  echo "  并同步 bump worker 版本 pin（node-profile.js / fleet-node-profiles.json / node-probe.cjs），"
  echo "  走 PR 合并后用 fleet-rollout.sh 分发三机："
  printf '%s\n' "$PIN_FILES" | sed 's/^/    - /'
} >&2
exit 3
```

- [ ] **Step 5: 跑测试确认绿**

Run: `bash packages/brain/scripts/fleet-worker/verify-digest-pin.test.sh`
Expected: `PASS: verify-digest-pin.test.sh`

- [ ] **Step 6: build.sh 末尾接守卫**

`docker/build.sh` 末行（`docker images ...` 之后）追加：

```bash
# 漂移守卫：rebuild 后 pin 未同步立即见红（exit 3），禁静默漂移
bash "$SCRIPT_DIR/verify-digest-pin.sh" "$IMAGE_TAG"
```

- [ ] **Step 7: proven-to-fire（真实环境点火，留档）**

Run: `bash docker/verify-digest-pin.sh cecelia/runner:canonical-candidate; echo "exit=$?"`
Expected（当前 pin 还是旧 349c40cc）: stderr 打印漂移报告，`exit=3` ——守卫真报红实证。把输出粘进 commit message 或 PR body。

- [ ] **Step 8: commit-2（实现绿）**

```bash
git add docker/verify-digest-pin.sh docker/build.sh
git commit -m "feat(fleet): build.sh 接 digest-vs-pin 漂移守卫,rebuild不repin必见红 [task 65334686]"
```

---

### Task 2: installer ORBSTACK_HOME 自动推导（TDD）

**Files:**
- Modify: `packages/brain/scripts/fleet-worker/install-fleet-worker.sh:87`
- Test: `packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh`（新增用例）

**Interfaces:**
- Produces: 推导链 = env `FLEET_WORKER_ORBSTACK_HOME` → `/var/run/docker.sock` 属主（stat -f %Su，拒 root/_cecelia）→ `SUDO_USER`（拒 root/_cecelia）→ `/var/empty`。新增测试注入点：`FLEET_WORKER_DOCKER_SOCKET`（socket 路径覆盖，默认 `/var/run/docker.sock`）；复用既有 `FLEET_WORKER_STAT` mock。

- [ ] **Step 1: 在 install-fleet-worker.test.sh 新增 failing 用例**

在既有用例区（文件尾部 echo PASS 之前）插入。先读该文件既有 stat mock 的实现形态，保持同款；新增用例形如：

```bash
# ---- ORBSTACK_HOME 默认值自动推导（2026-08-08 kernel 战役：/var/empty 默认值致 _cecelia 探测不到 OrbStack）----
derive_root="$(mktemp -d)"
fake_socket="$derive_root/docker.sock"
: > "$fake_socket"
cat > "$derive_root/stat" << 'STAT_EOF'
#!/usr/bin/env bash
# mock: stat -f %Su <path> → 固定属主 administrator
if [[ "$1" == '-f' && "$2" == '%Su' ]]; then printf 'administrator\n'; exit 0; fi
exit 64
STAT_EOF
chmod +x "$derive_root/stat"

derived="$(env -u FLEET_WORKER_ORBSTACK_HOME \
  FLEET_WORKER_DOCKER_SOCKET="$fake_socket" \
  FLEET_WORKER_STAT="$derive_root/stat" \
  FLEET_WORKER_PRINT_ORBSTACK_HOME=1 \
  bash "$INSTALLER" us-mac-m4 --render-to /dev/null 2>/dev/null | tail -1)"
[[ "$derived" == '/Users/administrator' ]] \
  || fail "ORBSTACK_HOME should derive /Users/administrator from socket owner, got: $derived"

# 属主是 root → 拒绝，回落 /var/empty（无 SUDO_USER 时）
cat > "$derive_root/stat" << 'STAT_EOF'
#!/usr/bin/env bash
if [[ "$1" == '-f' && "$2" == '%Su' ]]; then printf 'root\n'; exit 0; fi
exit 64
STAT_EOF
chmod +x "$derive_root/stat"
derived="$(env -u FLEET_WORKER_ORBSTACK_HOME -u SUDO_USER \
  FLEET_WORKER_DOCKER_SOCKET="$fake_socket" \
  FLEET_WORKER_STAT="$derive_root/stat" \
  FLEET_WORKER_PRINT_ORBSTACK_HOME=1 \
  bash "$INSTALLER" us-mac-m4 --render-to /dev/null 2>/dev/null | tail -1)"
[[ "$derived" == '/var/empty' ]] \
  || fail "root socket owner should fall back to /var/empty, got: $derived"
rm -rf "$derive_root"
```

> 实现注意：`FLEET_WORKER_PRINT_ORBSTACK_HOME=1` 是新增的自测出口——installer 解析完推导后打印结果并 exit 0（在做任何写动作之前），避免为测推导逻辑而 mock 整条安装链。若该文件既有用例已有更顺的注入形态，跟随既有形态改写本用例，断言不变。

- [ ] **Step 2: 跑测试确认新用例红**

Run: `bash packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh`
Expected: `FAIL: ORBSTACK_HOME should derive ...`（既有用例全过，新用例红）

- [ ] **Step 3: commit-1（红测试）**

```bash
git add packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh
git commit -m "test(fleet): installer ORBSTACK_HOME 自动推导 failing test [task 65334686]"
```

- [ ] **Step 4: 实现推导链**

`install-fleet-worker.sh:87` 一行替换为：

```bash
DOCKER_SOCKET_PATH="${FLEET_WORKER_DOCKER_SOCKET:-/var/run/docker.sock}"
derive_orbstack_home() {
  local owner=''
  if [[ -e "$DOCKER_SOCKET_PATH" ]]; then
    owner="$("$STAT_COMMAND" -f '%Su' "$DOCKER_SOCKET_PATH" 2>/dev/null || true)"
  fi
  if [[ -z "$owner" || "$owner" == root || "$owner" == _cecelia ]]; then
    owner="${SUDO_USER:-}"
  fi
  if [[ -n "$owner" && "$owner" != root && "$owner" != _cecelia \
    && "$owner" =~ ^[A-Za-z0-9._-]+$ ]]; then
    printf '/Users/%s' "$owner"
  else
    printf '/var/empty'
  fi
}
ORBSTACK_HOME="${FLEET_WORKER_ORBSTACK_HOME:-$(derive_orbstack_home)}"
```

其中 `$STAT_COMMAND` 用文件里既有的 stat 变量名（读 install-fleet-worker.sh 确认，若名为 `FLEET_WORKER_STAT`/`STAT` 就用那个；没有就新建 `STAT_COMMAND="${FLEET_WORKER_STAT:-/usr/bin/stat}"`）。同时在参数解析完、执行安装动作之前加自测出口：

```bash
if [[ "${FLEET_WORKER_PRINT_ORBSTACK_HOME:-}" == '1' ]]; then
  printf '%s\n' "$ORBSTACK_HOME"
  exit 0
fi
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `bash packages/brain/scripts/fleet-worker/install-fleet-worker.test.sh`
Expected: `PASS`（全部用例）

- [ ] **Step 6: commit-2（实现绿）**

```bash
git add packages/brain/scripts/fleet-worker/install-fleet-worker.sh
git commit -m "fix(fleet): installer ORBSTACK_HOME 从 docker.sock 属主自动推导 [task 65334686]"
```

---

### Task 3: canonical repin + worker 版本 pin + brain 版本 bump（数据变更，一次到位）

**Files:**
- Modify: Global Constraints 列出的 10 个 pin 文件 + `packages/brain/scripts/fleet-worker/node-probe.cjs:22` + 版本四处

**Interfaces:**
- Consumes: Task 1 的 verify-digest-pin.sh（repin 后转绿的实证）
- Produces: 全仓 digest = `08c904ff…`；worker 版本 pin = 新 brain 版本（三组一致）

- [ ] **Step 1: 确定新版本号**

```bash
CUR=$(node -e "process.stdout.write(require('./packages/brain/package.json').version)")
echo "current=$CUR"   # 期望 1.270.6（以实际为准），新版本 = patch+1
```

- [ ] **Step 2: 全仓 digest 替换（含 DEFINITION.md）**

```bash
OLD='349c40cc901caddf7ef491ee27f7e415603450824913be74a1d99f4bf14c85ff'
NEW='08c904ff0dc216229b84d2ce7216760fcb9968a43351916f8495265b3956bd4f'
grep -rl "$OLD" --exclude-dir=node_modules --exclude-dir=.git \
  --exclude-dir=.worktrees --exclude-dir=.claude --exclude-dir=docs --exclude-dir=sprints . \
  | while read -r f; do sed -i '' "s/$OLD/$NEW/g" "$f"; done
# docs/ 与 sprints/ 是历史记录不改；核对清单应恰为 10 个文件（9 个 brain 文件 + DEFINITION.md）：
grep -rl "$NEW" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.worktrees --exclude-dir=.claude --exclude-dir=docs --exclude-dir=sprints .
```

- [ ] **Step 3: worker 版本三组 + brain 版本四处**

用 Edit 逐处改（新版本号记为 NEWV）：
- `packages/brain/package.json` version → NEWV
- `packages/brain/package-lock.json` 顶部两处 version → NEWV
- `.brain-versions` 追加一行 NEWV
- `DEFINITION.md`「Brain 版本」行 → NEWV
- `packages/brain/src/orchestrator/fleet-node/node-profile.js` version_policy.worker `'1.267.100'` → NEWV
- `packages/brain/config/fleet-node-profiles.json` 三机 version_policy.worker → NEWV
- `packages/brain/scripts/fleet-worker/node-probe.cjs` DEFAULT_WORKER_VERSION → NEWV

- [ ] **Step 4: DevGate + 全套 fleet 测试**

```bash
node scripts/facts-check.mjs && bash scripts/check-version-sync.sh \
  && node packages/quality/scripts/devgate/check-dod-mapping.cjs
for t in packages/brain/scripts/fleet-worker/*.test.sh; do bash "$t" || exit 1; done
npx vitest run packages/brain/src/orchestrator/fleet-node/ 2>/dev/null || \
  (cd packages/brain && npx vitest run src/orchestrator/fleet-node/)
```

Expected: 全绿。

- [ ] **Step 5: 守卫转绿实证（与 Task 1 Step 7 成对）**

Run: `bash docker/verify-digest-pin.sh cecelia/runner:canonical-candidate; echo "exit=$?"`
Expected: `OK: ... digest 与 canonical pin 一致`，`exit=0`

- [ ] **Step 6: commit**

```bash
git add -A
git commit -m "fix(fleet): canonical runner 镜像 repin 08c904ff+worker版本pin同步 [task 65334686]

镜像从 main aa4e45ee 经 docker/build.sh 正规构建(label齐),与真机四测过的
84018cb1 逐层一致;凭据合同探针 PASS。修复 #4720 绕 build.sh 重建导致的
pin/镜像漂移(fleet 三机准入静默全挂根因)。"
```

---

### Task 4: canonical-pin-consistency 互锁测试（防局部 repin 永久守卫）

**Files:**
- Create: `packages/brain/scripts/fleet-worker/canonical-pin-consistency.test.sh`

**Interfaces:**
- Consumes: Task 3 完成后的全仓一致状态
- Produces: CI 每 PR 断言全部 pin 点两两一致（digest + worker 版本三组）

- [ ] **Step 1: 写测试**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
fail() { echo "FAIL: $*" >&2; exit 1; }

NODE_PROFILE="$REPO_ROOT/packages/brain/src/orchestrator/fleet-node/node-profile.js"
baseline_digest="$(sed -nE "s/.*runner_image_digest: '([^']+)'.*/\1/p" "$NODE_PROFILE" | head -1)"
[[ "$baseline_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "cannot parse baseline digest"
hex="${baseline_digest#sha256:}"

# 全部 pin 文件必须含 baseline digest（互锁：漏改任何一处即红）
PIN_FILES='src/orchestrator/fleet-node/node-profile.test.js
config/fleet-node-profiles.json
scripts/fleet-worker/fleet-rollout.sh
scripts/fleet-worker/fleet-rollout.test.sh
scripts/fleet-worker/reconcile-fleet-node-baseline.sh
scripts/fleet-worker/reconcile-fleet-node-baseline.test.sh
scripts/fleet-worker/install-fleet-worker.test.sh
scripts/smoke/provider-neutral-phase4a-node-smoke.sh'
while IFS= read -r rel; do
  grep -q "$hex" "$REPO_ROOT/packages/brain/$rel" \
    || fail "pin file missing baseline digest: packages/brain/$rel"
done <<< "$PIN_FILES"
grep -q "$hex" "$REPO_ROOT/DEFINITION.md" || fail "DEFINITION.md missing baseline digest"

# 全仓不允许残留任何其它 runner digest pin 形态（防新旧并存）
# （只查 pin 语境行：runner_image_digest / RUNNER_DIGEST）
stray="$(grep -rn "runner_image_digest\|RUNNER_DIGEST=" "$REPO_ROOT/packages/brain" \
  --include='*.js' --include='*.json' --include='*.sh' \
  | grep -oE 'sha256:[0-9a-f]{64}' | sort -u | grep -v "^$baseline_digest\$" || true)"
[[ -z "$stray" ]] || fail "stray runner digest pin found: $stray"

# worker 版本三组一致
policy_worker="$(sed -nE "s/.*worker: '([0-9.]+)'.*/\1/p" "$NODE_PROFILE" | head -1)"
[[ -n "$policy_worker" ]] || fail "cannot parse version_policy.worker"
probe_worker="$(sed -nE "s/.*DEFAULT_WORKER_VERSION = '([0-9.]+)'.*/\1/p" \
  "$REPO_ROOT/packages/brain/scripts/fleet-worker/node-probe.cjs" | head -1)"
[[ "$probe_worker" == "$policy_worker" ]] \
  || fail "node-probe DEFAULT_WORKER_VERSION ($probe_worker) != version_policy.worker ($policy_worker)"
profiles_worker_count="$(grep -c "\"worker\": \"$policy_worker\"" \
  "$REPO_ROOT/packages/brain/config/fleet-node-profiles.json")"
[[ "$profiles_worker_count" -eq 3 ]] \
  || fail "fleet-node-profiles.json should pin worker=$policy_worker on 3 machines, got $profiles_worker_count"

echo "PASS: canonical-pin-consistency.test.sh"
```

- [ ] **Step 2: 跑测试确认绿**

Run: `bash packages/brain/scripts/fleet-worker/canonical-pin-consistency.test.sh`
Expected: `PASS`

- [ ] **Step 3: proven-to-fire（临时弄坏一处亲眼看红，再复原）**

```bash
sed -i '' 's/08c904ff0dc2/deadbeefdead/' packages/brain/config/fleet-node-profiles.json
bash packages/brain/scripts/fleet-worker/canonical-pin-consistency.test.sh; echo "exit=$?"
git checkout -- packages/brain/config/fleet-node-profiles.json
bash packages/brain/scripts/fleet-worker/canonical-pin-consistency.test.sh
```

Expected: 中间一次 `FAIL: pin file missing baseline digest`（exit 1），复原后 PASS。

- [ ] **Step 4: commit**

```bash
git add packages/brain/scripts/fleet-worker/canonical-pin-consistency.test.sh
git commit -m "test(fleet): canonical pin 互锁一致性守卫,漏改任何一处即红 [task 65334686]"
```

---

### Task 5: 收尾（DevGate 复跑 + push + PR）

- [ ] **Step 1: DevGate 三闸 + 全部 fleet 测试复跑**

```bash
node scripts/facts-check.mjs && bash scripts/check-version-sync.sh \
  && node packages/quality/scripts/devgate/check-dod-mapping.cjs
for t in packages/brain/scripts/fleet-worker/*.test.sh; do echo "== $t"; bash "$t" || exit 1; done
```

Expected: 全绿。

- [ ] **Step 2: 清理自查**

确认无 console.log/死代码/未用 import 引入；`git status` 无计划外文件。

- [ ] **Step 3: push + PR（superpowers:finishing-a-development-branch Option 2）**

PR body 必须含：canonical 镜像来历（build.sh@aa4e45ee、层一致、探针 PASS）、两道守卫的 proven-to-fire 日志、合并后 ops 步骤（brain 部署 → fleet-rollout → 三机验证 → kernel 重跑）。

---

## 合并后 Ops（不在 PR 内，本 session 继续执行，写进 handoff）

1. `bash scripts/brain-deploy.sh`（Brain 容器跑镜像快照，必须重建）
2. 干净树 checkout 合并 commit → `CECELIA_MACHINE_ID=us-mac-m4 bash packages/brain/scripts/fleet-worker/fleet-rollout.sh us-mac-m4 --apply` 先单机验证 → `... all --apply` 全量
3. 三机 health + admission 验证（getMachineHealth 无 drift/docker 红项）
4. 重跑 kernel 验证任务（harness_runtime:kernel-v1, target_environment:playground），tail /tmp/cecelia-kernel-logs/kernel-*.log 确认 planner 推进出 planning
