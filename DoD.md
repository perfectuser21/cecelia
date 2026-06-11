contract_branch: cp-harness-propose-r3-d601d256
sprint_dir: sprints/06111350-forensics-no-overwrite

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 取证文件防覆盖（cecelia-prompts 按运行实例命名）

**范围**: docker-executor.js（writePromptFile + executeInDocker env 注入）/ host-executor.js（prompt 文件命名）/ entrypoint.sh（从 env 读路径协议）/ 镜像重建
**大小**: S

---

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/src/docker-executor.js` 中 `writePromptFile` 生成含实例标识后缀的文件名（格式 `{taskId}.{ts13}-{hex8}.prompt`）
  Test: node -e "const src=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8');if(src.includes('\`\${taskId}.prompt\`'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `docker/cecelia-runner/entrypoint.sh` 包含 `CECELIA_PROMPT_FILE` 和 `CECELIA_STDOUT_FILE` 变量引用（含 fallback 语法）
  Test: grep -q 'CECELIA_PROMPT_FILE' docker/cecelia-runner/entrypoint.sh && grep -q 'CECELIA_STDOUT_FILE' docker/cecelia-runner/entrypoint.sh && echo OK

---

## BEHAVIOR 条目

### BEHAVIOR:1 — writePromptFile 生成含实例标识的文件名（非旧格式 {taskId}.prompt）

**Golden Path 溯源**: Step 1「宿主侧写出含实例标识的 .prompt 文件」

- [x] [BEHAVIOR] `writePromptFile` 返回路径 basename 匹配 `{taskId}.{ts10+}-{hex8}.prompt`，不再是旧格式 `{taskId}.prompt`
  Test: manual:bash -c '
    T=$(mktemp -d)
    cat > /workspace/bv1.mjs << '"'"'EOF'"'"'
import path from "path";
const m = await import("./packages/brain/src/docker-executor.js");
const p = m.__test__.writePromptFile("bv1-check", "x");
const b = path.basename(p);
if (b === "bv1-check.prompt") { console.error("FAIL old format:", b); process.exit(1); }
if (!/^bv1-check\.\d{10,}-[0-9a-f]{8}\.prompt$/.test(b)) { console.error("FAIL bad format:", b); process.exit(1); }
console.log("OK:", b);
EOF
    CECELIA_PROMPT_DIR="$T" node /workspace/bv1.mjs 2>/dev/null; EC=$?
    rm -rf "$T" /workspace/bv1.mjs; exit $EC
  '
  期望: OK: bv1-check.{ts}-{hex8}.prompt

---

### BEHAVIOR:2 — 两次写入同一 taskId，两文件独立共存（第一次内容未被覆盖）

**Golden Path 溯源**: Step 3「两次 spawn 同一 taskId — 两组文件共存，无覆盖」

- [x] [BEHAVIOR] 连续调用 `writePromptFile('task-x', 'run1')` 和 `writePromptFile('task-x', 'run2')` 后，两个返回路径不同，且第一次文件内容仍为 'run1'
  Test: manual:bash -c '
    T=$(mktemp -d)
    cat > /workspace/bv2.mjs << '"'"'EOF'"'"'
import { readFileSync } from "fs";
const m = await import("./packages/brain/src/docker-executor.js");
const p1 = m.__test__.writePromptFile("bv2task", "run1");
await new Promise(r => setTimeout(r, 20));
const p2 = m.__test__.writePromptFile("bv2task", "run2");
if (p1 === p2) { console.error("FAIL: same path", p1); process.exit(1); }
const c1 = readFileSync(p1, "utf8");
if (c1 !== "run1") { console.error("FAIL: p1 content overwritten:", c1); process.exit(1); }
console.log("OK: p1 != p2 and p1 content preserved");
EOF
    CECELIA_PROMPT_DIR="$T" node /workspace/bv2.mjs 2>/dev/null; EC=$?
    rm -rf "$T" /workspace/bv2.mjs; exit $EC
  '
  期望: OK: p1 != p2 and p1 content preserved

---

### BEHAVIOR:3 — executeInDocker 在调用 buildDockerArgs 前向 opts.env 注入 CECELIA_PROMPT_FILE / CECELIA_STDOUT_FILE

**Golden Path 溯源**: Step 2「容器 env 接收 CECELIA_PROMPT_FILE / CECELIA_STDOUT_FILE」

**Round-2 修复说明**: 上轮 BEHAVIOR:3 只验证 `buildDockerArgs` 能透传预填的 env var（由测试手动构造 opts.env），无法检测 `executeInDocker` 是否真正在自身函数体内赋值 `opts.env.CECELIA_PROMPT_FILE`。Generator 可以通过实现 `buildDockerArgs` 的 env 透传，但忘记在 `executeInDocker` 中赋值，让 BEHAVIOR:3 假绿。本轮改为静态分析 `executeInDocker` 函数体，验证赋值语句出现在 `buildDockerArgs(opts` 调用之前。

- [x] [BEHAVIOR] `executeInDocker` 函数体在调用 `buildDockerArgs(opts` 之前的非注释代码中，存在 `opts.env.CECELIA_PROMPT_FILE` 赋值语句
  Test: manual:bash -c '
    node -e "
      const src = require(\"fs\").readFileSync(\"packages/brain/src/docker-executor.js\",\"utf8\");
      const execFnStart = src.indexOf(\"export async function executeInDocker(\");
      if (execFnStart === -1) { process.stderr.write(\"FAIL: executeInDocker not found\\n\"); process.exit(1); }
      const buildIdx = src.indexOf(\"buildDockerArgs(opts\", execFnStart);
      if (buildIdx === -1) { process.stderr.write(\"FAIL: buildDockerArgs(opts not found in executeInDocker\\n\"); process.exit(1); }
      const before = src.substring(execFnStart, buildIdx);
      const nonComment = before.split(\"\\n\").filter(l => !l.trim().startsWith(\"//\") && !l.trim().startsWith(\"*\")).join(\"\\n\");
      if (!nonComment.match(/opts\\.env(\\.CECELIA_PROMPT_FILE|\\[.CECELIA_PROMPT_FILE.\\])/)) {
        process.stderr.write(\"FAIL: executeInDocker 未在 buildDockerArgs 前赋值 opts.env.CECELIA_PROMPT_FILE\\n\");
        process.exit(1);
      }
      if (!nonComment.match(/opts\\.env(\\.CECELIA_STDOUT_FILE|\\[.CECELIA_STDOUT_FILE.\\])/)) {
        process.stderr.write(\"FAIL: executeInDocker 未在 buildDockerArgs 前赋值 opts.env.CECELIA_STDOUT_FILE\\n\");
        process.exit(1);
      }
      console.log(\"OK: executeInDocker injection verified before buildDockerArgs\");
    "
  '
  期望: OK: executeInDocker injection verified before buildDockerArgs

---

### BEHAVIOR:4 — entrypoint.sh 从 CECELIA_PROMPT_FILE / CECELIA_STDOUT_FILE env 读路径

**Golden Path 溯源**: Step 5「entrypoint.sh 从 env 读路径（向后兼容旧格式）」

- [x] [BEHAVIOR] `docker/cecelia-runner/entrypoint.sh` 中 `PROMPT_FILE` 和 `STDOUT_FILE` 的赋值包含 `CECELIA_PROMPT_FILE` / `CECELIA_STDOUT_FILE` 变量引用，且含 fallback 语法（`${VAR:-...}`）
  Test: manual:bash -c '
    grep -q "CECELIA_PROMPT_FILE" docker/cecelia-runner/entrypoint.sh || { echo "FAIL: no CECELIA_PROMPT_FILE in entrypoint.sh"; exit 1; }
    grep -q "CECELIA_STDOUT_FILE" docker/cecelia-runner/entrypoint.sh || { echo "FAIL: no CECELIA_STDOUT_FILE in entrypoint.sh"; exit 1; }
    grep "CECELIA_PROMPT_FILE" docker/cecelia-runner/entrypoint.sh | grep -q ":-" || { echo "FAIL: no fallback syntax"; exit 1; }
    echo OK
  '
  期望: OK

---

### BEHAVIOR:5 — host-executor.js 写入含实例标识的审计文件名

**Golden Path 溯源**: Step 1「宿主侧写出含实例标识的 .prompt 文件」（host-executor 路径）

- [x] [BEHAVIOR] `packages/brain/src/spawn/host-executor.js` 中 prompt 文件写入路径包含实例标识（不再是固定 `${taskId}-host.prompt`）
  Test: manual:bash -c '
    src=$(cat packages/brain/src/spawn/host-executor.js)
    echo "$src" | grep -q '"'"'\`\${taskId}-host\.prompt\`'"'"' && { echo "FAIL: 仍用旧固定格式 taskId-host.prompt"; exit 1; } || true
    echo "$src" | grep -qE "Date\.now\(\)|randomBytes|instanceId" || { echo "FAIL: host-executor.js 不含实例标识生成逻辑"; exit 1; }
    echo OK
  '
  期望: OK

---

## BEHAVIOR:E2E 条目

（autonomous journey_type — 无 Playwright 截图 DoD）

- [x] [BEHAVIOR:E2E] 两次 spawn 同一 taskId 后，宿主 cecelia-prompts 目录中两组文件共存；真实容器读到正确 prompt，stdout 文件写出；fallback 路径（仅 CECELIA_TASK_ID）不报 unbound variable
  Test: manual:bash -c 'bash sprints/06111350-forensics-no-overwrite/e2e-verify.sh'
  期望: exit 0 且输出含 "✅ E2E 全部通过"
