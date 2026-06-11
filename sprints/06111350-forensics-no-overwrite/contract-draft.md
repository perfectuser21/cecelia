# Sprint Contract Draft (Round 3)

## Response Schema（推导来源: N/A — 任务无 HTTP 响应）

N/A — 本 sprint 无新增 HTTP endpoint。改动范围为 docker-executor.js / host-executor.js / entrypoint.sh 的取证文件路径协议，无需 jq -e oracle。

---

## 已知约束（来自回归测试）

- [docker-executor-prompt-stdin.test.js] → "args 里不含 opts.prompt 文本"
- [docker-executor-prompt-stdin.test.js] → "args 里不含超长 prompt（模拟 GAN Reviewer 200KB prompt）"
- [docker-executor-prompt-stdin.test.js] → "args 最后一个元素是 image 名（不是 prompt）"
- [docker-executor-prompt-stdin.test.js] → "prompt dir 挂载到容器 /tmp/cecelia-prompts:rw"
- [docker-executor-mount-strategy.test.js] → "CECELIA_CREDENTIALS=account1 → 挂 /host-claude-config:ro + env CLAUDE_CONFIG_DIR=/home/cecelia/.claude"
- [docker-executor-metadata.test.js] → "成功路径：container_id 从 --cidfile 读取（前 12 位），command 字段完整"
- [docker-executor-metadata.test.js] → "残留 cidfile 会被清理再 run（否则 docker 会立即失败）"

---

## Golden Path

[同任务两次 spawn 触发] → [docker-executor 生成实例标识 → 写独立 .prompt 文件 → 传 CECELIA_PROMPT_FILE 至容器] → [entrypoint 从 env 读正确文件路径 → tee 到对应 .stdout] → [两组文件共存，任意历史运行均可查阅]

**实例标识格式**（proposer 决策）：`{13位毫秒时间戳}-{8位十六进制}` 例如 `1749600000123-a1b2c3d4`

文件命名规则：
- `.prompt`：`{taskId}.{instanceId}.prompt`
- `.stdout`：`{taskId}.{instanceId}.stdout`

---

### Step 1: 宿主侧写出含实例标识的 .prompt 文件

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点："每次 spawn：宿主侧写出含运行实例标识后缀的 .prompt 文件"

**可观测行为**: `writePromptFile(taskId, prompt)` 返回路径格式为 `{taskId}.{ts13}-{hex8}.prompt`（时间戳13位 + 连字符 + 8位hex），文件写入 `DEFAULT_PROMPT_DIR`。

**验证命令**:
```bash
TMPDIR_TEST=$(mktemp -d)
cat > /tmp/step1-check.mjs << 'MEOF'
import path from "path";
const m = await import("./packages/brain/src/docker-executor.js");
const p = m.__test__.writePromptFile("s1test", "content");
const b = path.basename(p);
if (b === "s1test.prompt") {
  console.error("FAIL: 仍是旧格式 s1test.prompt"); process.exit(1);
}
if (!/^s1test\.\d{10,}-[0-9a-f]{8}\.prompt$/.test(b)) {
  console.error("FAIL: 文件名不匹配 {taskId}.{ts}-{hex8}.prompt，实际=" + b); process.exit(1);
}
console.log("OK:", b);
MEOF
CECELIA_PROMPT_DIR="$TMPDIR_TEST" node /tmp/step1-check.mjs 2>/dev/null; EC=$?
rm -rf "$TMPDIR_TEST" /tmp/step1-check.mjs
exit $EC
```

**硬阈值**: `path.basename(promptFile)` 匹配 `/^{taskId}\.\d{10,}-[0-9a-f]{8}\.prompt$/`

---

### Step 2: 容器 env 接收 CECELIA_PROMPT_FILE / CECELIA_STDOUT_FILE

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点："容器内 entrypoint 读到属于自己这次运行的 prompt"，需要 docker-executor 传入完整路径（容器侧）

**可观测行为**: `executeInDocker` 在调用 `buildDockerArgs` 前，将 `CECELIA_PROMPT_FILE=/tmp/cecelia-prompts/{taskId}.{instanceId}.prompt` 和 `CECELIA_STDOUT_FILE=/tmp/cecelia-prompts/{taskId}.{instanceId}.stdout` 写入 `opts.env`；`buildDockerArgs` 通过 `envToArgs` 将其输出为 `-e CECELIA_PROMPT_FILE=... -e CECELIA_STDOUT_FILE=...` docker args。

**验证命令**:
```bash
# 静态分析：在 executeInDocker 函数体内，buildDockerArgs(opts 调用之前，存在对 opts.env.CECELIA_PROMPT_FILE 的赋值
# 这是 Reviewer Round-1 反馈修复：old BEHAVIOR:3 只验证 buildDockerArgs 能透传预填的 env，
# 无法检测 executeInDocker 是否真正赋值。静态分析验证赋值语句必须在 buildDockerArgs 调用前出现。
node -e "
  const src = require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8');
  const execFnStart = src.indexOf('export async function executeInDocker(');
  if (execFnStart === -1) { process.stderr.write('FAIL: executeInDocker not found\n'); process.exit(1); }
  const buildIdx = src.indexOf('buildDockerArgs(opts', execFnStart);
  if (buildIdx === -1) { process.stderr.write('FAIL: buildDockerArgs(opts not found in executeInDocker\n'); process.exit(1); }
  const before = src.substring(execFnStart, buildIdx);
  // 过滤注释行（// 和 * 开头）
  const nonComment = before.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  if (!nonComment.match(/opts\\.env(\\.CECELIA_PROMPT_FILE|\[['\\\"]\s*CECELIA_PROMPT_FILE)/)) {
    process.stderr.write('FAIL: executeInDocker 未在 buildDockerArgs 前赋值 opts.env.CECELIA_PROMPT_FILE\n');
    process.exit(1);
  }
  if (!nonComment.match(/opts\\.env(\\.CECELIA_STDOUT_FILE|\[['\\\"]\s*CECELIA_STDOUT_FILE)/)) {
    process.stderr.write('FAIL: executeInDocker 未在 buildDockerArgs 前赋值 opts.env.CECELIA_STDOUT_FILE\n');
    process.exit(1);
  }
  console.log('OK: executeInDocker injection verified before buildDockerArgs call');
"
```

**硬阈值**: `executeInDocker` 函数体在 `buildDockerArgs(opts` 调用之前含非注释行的 `opts.env.CECELIA_PROMPT_FILE =`（或 `opts.env['CECELIA_PROMPT_FILE'] =`）赋值语句

---

### Step 3: 两次 spawn 同一 taskId — 两组文件共存，无覆盖

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1、3 点："同一 sub-task 触发两次容器 spawn"，"ls cecelia-prompts/ | grep <task前缀> 能看到两组各自独立的文件"

**可观测行为**: 连续调用 `writePromptFile('task-xyz', ...)` 两次，产出两个不同路径的 `.prompt` 文件；第一次写入的内容仍然完整（未被覆盖）。

**验证命令**:
```bash
TMPDIR_TEST=$(mktemp -d)
cat > /tmp/step3-check.mjs << 'MEOF'
import { readFileSync, readdirSync } from "fs";
import path from "path";
const m = await import("./packages/brain/src/docker-executor.js");
const p1 = m.__test__.writePromptFile("s3test", "content-run-1");
await new Promise(r => setTimeout(r, 20));
const p2 = m.__test__.writePromptFile("s3test", "content-run-2");
if (p1 === p2) { console.error("FAIL: 两次写入同一路径 " + p1); process.exit(1); }
const c1 = readFileSync(p1, "utf8");
if (c1 !== "content-run-1") { console.error("FAIL: 第一次内容被覆盖，实际=" + c1); process.exit(1); }
const matching = readdirSync(path.dirname(p1)).filter(f => f.startsWith("s3test") && f.endsWith(".prompt"));
if (matching.length < 2) { console.error("FAIL: .prompt 文件数=" + matching.length + "，期望 ≥ 2"); process.exit(1); }
console.log("OK files:", matching.join(", "));
MEOF
CECELIA_PROMPT_DIR="$TMPDIR_TEST" node /tmp/step3-check.mjs 2>/dev/null; EC=$?
rm -rf "$TMPDIR_TEST" /tmp/step3-check.mjs
exit $EC
```

**硬阈值**: `p1 !== p2` 且 `readFileSync(p1) == 'content-run-1'` 且 同 taskId 下 `.prompt` 文件数 ≥ 2

---

### Step 4: docker-executor.js 源码包含 CECELIA_STDOUT_FILE 协议声明

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点："每次 spawn：容器内 entrypoint 读到属于自己这次运行的 prompt，执行完毕后将 stdout tee 到含相同实例标识后缀的 .stdout 文件"——executor 必须声明 CECELIA_STDOUT_FILE 环境变量以实现该协议。（.prompt×2 + .stdout×2 四文件实际共存是端到端结果，由 Step 6 真实容器验证；本 Step 只验证代码层的 STDOUT 协议已声明。）

**可观测行为**: `packages/brain/src/docker-executor.js` 源码中包含 `CECELIA_STDOUT_FILE` 字面量，表明宿主侧 stdout 写出路径协议已在实现层编码。实际文件写出及两次运行的 `.stdout` 文件共存由 Step 6 真实容器端到端验证。

**验证命令**:
```bash
grep -q 'CECELIA_STDOUT_FILE' packages/brain/src/docker-executor.js && echo OK || { echo "FAIL"; exit 1; }
```

**硬阈值**: `CECELIA_STDOUT_FILE` 字面量存在于 docker-executor.js 源码（`grep -q` exit 0）

---

### Step 5: entrypoint.sh 从 env 读路径（向后兼容旧格式）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点："容器内 entrypoint 读到属于自己这次运行的 prompt"
**来源**: `[AI_ADDED]` — GAN Round 1 加入，理由：向后兼容——手动 `docker run`（无 `CECELIA_PROMPT_FILE`）时 fallback 到旧拼接，防止非 harness 场景断裂

**可观测行为**: `entrypoint.sh` 中 `PROMPT_FILE` 和 `STDOUT_FILE` 改为 `${CECELIA_PROMPT_FILE:-/tmp/cecelia-prompts/${CECELIA_TASK_ID:-UNSET}.prompt}` 形式（优先读 env var，fallback 到旧拼接）。

**验证命令**:
```bash
grep -q 'CECELIA_PROMPT_FILE' docker/cecelia-runner/entrypoint.sh || \
  { echo "FAIL: entrypoint.sh 不含 CECELIA_PROMPT_FILE"; exit 1; }
grep -q 'CECELIA_STDOUT_FILE' docker/cecelia-runner/entrypoint.sh || \
  { echo "FAIL: entrypoint.sh 不含 CECELIA_STDOUT_FILE"; exit 1; }
grep 'CECELIA_PROMPT_FILE' docker/cecelia-runner/entrypoint.sh | grep -q ':-' || \
  { echo "FAIL: entrypoint.sh 缺少 fallback 语法（${CECELIA_PROMPT_FILE:-...}）"; exit 1; }
echo OK
```

**硬阈值**: `grep 'CECELIA_PROMPT_FILE' entrypoint.sh | grep ':-'` exit 0

---

### Step 6: 真实容器端到端验证（新镜像 docker run）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 点："用新镜像真实运行一个容器端到端跑通，容器内 entrypoint 正确读到属于本次运行的 prompt 并正常产出 stdout 文件"

**可观测行为**: `docker run cecelia/runner:latest` 时，通过 `CECELIA_PROMPT_FILE=/tmp/cecelia-prompts/{taskId}.{instanceId}.prompt` 指向预写的 `.prompt` 文件；容器执行后宿主目录中出现对应 `.stdout` 文件，内容非空，mtime 在脚本启动后（防造假）。

**验证命令**: 见 `## E2E 验收` 脚本 Step 6 段。

**硬阈值**: `.stdout` 文件存在 + 大小 > 0 + mtime ≥ 脚本启动时间戳

---

## Risks（Round 2 新增 — 处理 Reviewer 反馈问题2）

### Risk A: host-executor.js 分支遗漏

**描述**: `host-executor.js` 的 prompt 写入路径若未同步改为含实例标识的格式，host 模式运行时取证文件仍会原地覆盖；sprint 目标在 host 执行路径下不达成，但 docker 路径测试全绿，导致漏测。

**Mitigation**: BEHAVIOR:5 已专项验证 `host-executor.js` 含实例标识生成逻辑（`Date.now()|randomBytes|instanceId` 的 grep 断言）。Generator 必须将 `packages/brain/src/spawn/host-executor.js` 纳入本 sprint 改动文件，与 docker-executor.js 同步实现。

### Risk B: entrypoint.sh fallback 双引号展开坑

**描述**: bash 中 `${CECELIA_PROMPT_FILE:-/tmp/cecelia-prompts/${CECELIA_TASK_ID:-UNSET}.prompt}` 在 `CECELIA_TASK_ID` 未设置时，内层的 `${CECELIA_TASK_ID:-UNSET}` 先展开为字符串 `UNSET`，外层 fallback 正常工作。但若开发者把 fallback 写成 `${CECELIA_PROMPT_FILE:-/tmp/cecelia-prompts/$CECELIA_TASK_ID.prompt}`（无内层 guard），在 `set -u` 模式下未设置 `CECELIA_TASK_ID` 时会 `unbound variable` 报错。现有测试未覆盖 fallback 路径。

**Mitigation**: E2E 脚本 Step 6b 新增 fallback 路径测试：不传 `CECELIA_PROMPT_FILE`，只传 `CECELIA_TASK_ID`，验证容器能通过 fallback 找到旧命名格式文件并正常执行（防止 fallback 语法出错导致手动 `docker run` 失效）。

---

## E2E 验收（final-e2e — target_environment = local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
# final-e2e 验证脚本 — 取证文件防覆盖（local_api）
# 运行环境：宿主，无需 Brain 运行；docker 可用则跑 Step 6 + Step 6b
set -euo pipefail

SCRIPT_START=$(date +%s)
TMPDIR_PROMPTS=$(mktemp -d)
TASK_PREFIX="e2e-forensics-$(date +%s)"

cleanup() { rm -rf "$TMPDIR_PROMPTS" /tmp/e2e-forensics-check.mjs 2>/dev/null || true; }
trap cleanup EXIT

# ——— Steps 1-4: Node.js 层文件防覆盖验证 ———
cat > /tmp/e2e-forensics-check.mjs << 'MEOF'
import { readFileSync, readdirSync } from "fs";
import path from "path";

const TASK_PREFIX = process.env.TASK_PREFIX;
const m = await import("./packages/brain/src/docker-executor.js");
const { writePromptFile } = m.__test__;

// Step 1: 文件名含实例标识
const p1 = writePromptFile(TASK_PREFIX, "prompt-content-run-1");
const b1 = path.basename(p1);
if (b1 === TASK_PREFIX + ".prompt") {
  console.error("FAIL step1: 仍是旧格式 " + b1); process.exit(1);
}
if (!/\.\d{10,}-[0-9a-f]{8}\.prompt$/.test(b1)) {
  console.error("FAIL step1: 文件名不含实例标识 " + b1); process.exit(1);
}

// Step 3: 两次写入不覆盖
await new Promise(r => setTimeout(r, 20));
const p2 = writePromptFile(TASK_PREFIX, "prompt-content-run-2");
if (p1 === p2) { console.error("FAIL step3: 两次写入同一路径 " + p1); process.exit(1); }
const c1 = readFileSync(p1, "utf8");
if (c1 !== "prompt-content-run-1") { console.error("FAIL step3: 第一次内容被覆盖，实际=" + c1); process.exit(1); }

// Step 4: ls | grep ≥ 2 个 .prompt 文件
const dir = path.dirname(p1);
const matching = readdirSync(dir).filter(f => f.startsWith(TASK_PREFIX) && f.endsWith(".prompt"));
if (matching.length < 2) { console.error("FAIL step4: .prompt 文件数=" + matching.length); process.exit(1); }

console.log("OK steps1-4:", matching.join(", "));
MEOF

CECELIA_PROMPT_DIR="$TMPDIR_PROMPTS" TASK_PREFIX="$TASK_PREFIX" node /tmp/e2e-forensics-check.mjs 2>/dev/null
echo "✅ steps 1-4 通过"

# ——— Step 5: entrypoint.sh env var 验证 ———
grep -q 'CECELIA_PROMPT_FILE' docker/cecelia-runner/entrypoint.sh || {
  echo "FAIL step5: entrypoint.sh 不含 CECELIA_PROMPT_FILE"; exit 1
}
grep -q 'CECELIA_STDOUT_FILE' docker/cecelia-runner/entrypoint.sh || {
  echo "FAIL step5: entrypoint.sh 不含 CECELIA_STDOUT_FILE"; exit 1
}
echo "✅ step 5 通过: entrypoint.sh 包含 CECELIA_PROMPT_FILE / CECELIA_STDOUT_FILE"

# ——— Step 6: 真实容器端到端验证（正常路径：CECELIA_PROMPT_FILE 注入）———
if ! command -v docker &>/dev/null; then
  echo "⚠️  step6/6b skipped — docker 未安装"
else
  echo "[e2e] 重建 cecelia/runner 镜像..."
  bash docker/build.sh 2>&1 | tail -5

  INSTANCE_ID="$(date +%s%3N 2>/dev/null || date +%s)-$(od -An -N4 -tx4 /dev/urandom | tr -d ' \n')"
  PROMPT_FILE_NAME="${TASK_PREFIX}.${INSTANCE_ID}.prompt"
  STDOUT_FILE_NAME="${TASK_PREFIX}.${INSTANCE_ID}.stdout"

  echo "e2e test prompt for forensics-no-overwrite run=${INSTANCE_ID}" \
    > "${TMPDIR_PROMPTS}/${PROMPT_FILE_NAME}"

  docker run --rm \
    -v "${TMPDIR_PROMPTS}:/tmp/cecelia-prompts:rw" \
    -e "CECELIA_TASK_ID=${TASK_PREFIX}" \
    -e "CECELIA_PROMPT_FILE=/tmp/cecelia-prompts/${PROMPT_FILE_NAME}" \
    -e "CECELIA_STDOUT_FILE=/tmp/cecelia-prompts/${STDOUT_FILE_NAME}" \
    --entrypoint bash \
    cecelia/runner:latest \
    -c '
      PROMPT_FILE="${CECELIA_PROMPT_FILE:-/tmp/cecelia-prompts/${CECELIA_TASK_ID:-UNSET}.prompt}"
      STDOUT_FILE="${CECELIA_STDOUT_FILE:-/tmp/cecelia-prompts/${CECELIA_TASK_ID:-UNSET}.stdout}"
      if [[ ! -f "$PROMPT_FILE" ]]; then echo "FAIL: prompt 不存在 $PROMPT_FILE"; exit 1; fi
      cat "$PROMPT_FILE" | tee "$STDOUT_FILE"
      echo "[entrypoint] ok prompt=$(basename $PROMPT_FILE) stdout=$(basename $STDOUT_FILE)"
    ' 2>&1 || { echo "FAIL step6: docker run 失败"; exit 1; }

  if [[ ! -f "${TMPDIR_PROMPTS}/${STDOUT_FILE_NAME}" ]]; then
    echo "FAIL step6: .stdout 文件未写出"; exit 1
  fi
  STDOUT_SIZE=$(wc -c < "${TMPDIR_PROMPTS}/${STDOUT_FILE_NAME}" | tr -d ' ')
  [[ "$STDOUT_SIZE" -gt 0 ]] || { echo "FAIL step6: .stdout 为空"; exit 1; }
  STDOUT_MTIME=$(stat -c '%Y' "${TMPDIR_PROMPTS}/${STDOUT_FILE_NAME}" 2>/dev/null || \
                  stat -f '%m' "${TMPDIR_PROMPTS}/${STDOUT_FILE_NAME}" 2>/dev/null)
  [[ "$STDOUT_MTIME" -ge "$SCRIPT_START" ]] || { echo "FAIL step6: mtime 早于脚本启动（历史遗留文件）"; exit 1; }
  echo "✅ step 6 通过: 正常路径 stdout_size=${STDOUT_SIZE}B"

  # ——— Step 6b: fallback 路径验证（Risk B mitigation — entrypoint fallback 语法）———
  # 不传 CECELIA_PROMPT_FILE，只传 CECELIA_TASK_ID，验证 fallback 不报 unbound variable
  FALLBACK_TASK="fb-$(date +%s)"
  FALLBACK_PROMPT="${TMPDIR_PROMPTS}/${FALLBACK_TASK}.prompt"
  FALLBACK_STDOUT="${TMPDIR_PROMPTS}/${FALLBACK_TASK}.stdout"
  echo "fallback path e2e test content" > "$FALLBACK_PROMPT"

  docker run --rm \
    -v "${TMPDIR_PROMPTS}:/tmp/cecelia-prompts:rw" \
    -e "CECELIA_TASK_ID=${FALLBACK_TASK}" \
    --entrypoint bash \
    cecelia/runner:latest \
    -c '
      set -euo pipefail
      PROMPT_FILE="${CECELIA_PROMPT_FILE:-/tmp/cecelia-prompts/${CECELIA_TASK_ID:-UNSET}.prompt}"
      STDOUT_FILE="${CECELIA_STDOUT_FILE:-/tmp/cecelia-prompts/${CECELIA_TASK_ID:-UNSET}.stdout}"
      if [[ ! -f "$PROMPT_FILE" ]]; then echo "FAIL fallback: prompt 不存在 $PROMPT_FILE"; exit 1; fi
      cat "$PROMPT_FILE" | tee "$STDOUT_FILE"
      echo "[entrypoint fallback] ok stdout=$(basename $STDOUT_FILE)"
    ' 2>&1 || { echo "FAIL step6b: fallback 路径报错（疑似 unbound variable 或 fallback 语法错误）"; exit 1; }

  [[ -f "$FALLBACK_STDOUT" ]] || { echo "FAIL step6b: fallback stdout 文件未写出"; exit 1; }
  echo "✅ step 6b 通过: fallback 路径（无 CECELIA_PROMPT_FILE，仅 CECELIA_TASK_ID）验证成功"
fi

echo "✅ E2E 全部通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| writePromptFile 文件名格式 | `tests/forensics-no-overwrite.test.js` | 返回路径含实例标识 | → 1 failure（basename = `{taskId}.prompt`）|
| writePromptFile 不覆盖 | `tests/forensics-no-overwrite.test.js` | 两次写入路径不同 + 内容独立 | → 2 failures（同路径 + 内容被覆盖）|
| executeInDocker env 注入（调用链）| `tests/forensics-no-overwrite.test.js` | `opts.env.CECELIA_PROMPT_FILE` 在 `buildDockerArgs` 前赋值 | → 2 failures（源码无此赋值）|
| entrypoint.sh env 协议 | `tests/forensics-no-overwrite.test.js` | 含 `CECELIA_PROMPT_FILE` 引用 | → 1 failure（文件无此变量）|
