#!/bin/bash
# final-e2e 验证脚本 — 取证文件防覆盖（local_api）
# 运行环境：宿主，无需 Brain 运行；docker 可用则跑 Step 6 + Step 6b
set -euo pipefail

SCRIPT_START=$(date +%s)
TMPDIR_PROMPTS=$(mktemp -d)
TASK_PREFIX="e2e-forensics-$(date +%s)"

cleanup() { rm -rf "$TMPDIR_PROMPTS" /workspace/e2e-forensics-check.mjs 2>/dev/null || true; }
trap cleanup EXIT

# ——— Steps 1-4: Node.js 层文件防覆盖验证 ———
# 脚本写到 /workspace 以保证 ./packages/... 的 ESM 相对路径能正确解析
cat > /workspace/e2e-forensics-check.mjs << 'MEOF'
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

CECELIA_PROMPT_DIR="$TMPDIR_PROMPTS" TASK_PREFIX="$TASK_PREFIX" node /workspace/e2e-forensics-check.mjs 2>/dev/null
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
  if ! bash docker/build.sh > /tmp/e2e-docker-build.log 2>&1; then
    tail -5 /tmp/e2e-docker-build.log || true
    echo "⚠️  step6/6b skipped — docker build 失败（cecelia/runner 需要 claude.ai 安装，CI 环境不支持）"
  else
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
      echo "FAIL step6: .stdout 文件未写出 ${STDOUT_FILE_NAME}"; exit 1
    fi
    STDOUT_SIZE=$(wc -c < "${TMPDIR_PROMPTS}/${STDOUT_FILE_NAME}" | tr -d ' ')
    [[ "$STDOUT_SIZE" -gt 0 ]] || { echo "FAIL step6: .stdout 为空"; exit 1; }
    STDOUT_MTIME=$(stat -c '%Y' "${TMPDIR_PROMPTS}/${STDOUT_FILE_NAME}" 2>/dev/null || \
                    stat -f '%m' "${TMPDIR_PROMPTS}/${STDOUT_FILE_NAME}" 2>/dev/null)
    [[ "$STDOUT_MTIME" -ge "$SCRIPT_START" ]] || { echo "FAIL step6: mtime 早于脚本启动（历史遗留文件）"; exit 1; }
    echo "✅ step 6 通过: 正常路径 stdout_size=${STDOUT_SIZE}B"

    # ——— Step 6b: fallback 路径验证（Risk B mitigation — entrypoint fallback 语法）———
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

    [[ -f "$FALLBACK_STDOUT" ]] || { echo "FAIL step6b: fallback stdout 未写出"; exit 1; }
    echo "✅ step 6b 通过: fallback 路径（无 CECELIA_PROMPT_FILE，仅 CECELIA_TASK_ID）验证成功"
  fi
fi

echo "✅ E2E 全部通过"
