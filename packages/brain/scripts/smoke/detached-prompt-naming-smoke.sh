#!/usr/bin/env bash
# detached-prompt-naming-smoke.sh — post-deploy 集成 smoke（宿主有 docker 时执行）
#
# 验证 PR #3345 协议断裂修复：spawnDockerDetached 真实 spawn 一个容器，断言
#   容器 entrypoint 报告的 PROMPT_FILE（按注入的 CECELIA_PROMPT_FILE env 解析）
#   与 spawnDockerDetached 在宿主磁盘真实写入的 prompt 文件**逐字一致**且内容正确。
#
# 与单测区别：单测 mock docker spawn；本脚本走真实 `docker run -d` + 真实镜像 entrypoint，
# 端到端证明"detached 路径落盘文件 == 容器要读的文件"。CECELIA_ENTRYPOINT_TEST=1 让容器
# 打印 PROMPT_FILE/STDOUT_FILE 后立即 exit 0（不真跑 claude）。
#
# 使用方式（宿主，需已 bash docker/build.sh 重建镜像）：
#   bash packages/brain/scripts/smoke/detached-prompt-naming-smoke.sh
#
# 依赖：docker daemon 可用 + cecelia/runner:latest 已构建
set -euo pipefail

IMAGE="${CECELIA_RUNNER_IMAGE:-cecelia/runner:latest}"

# === 跳过条件（CI / 无 docker 环境）===
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "[smoke] detached-prompt-naming: SKIP — docker 不可用（CI/无 docker 环境）"
  exit 0
fi
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "[smoke] detached-prompt-naming: SKIP — 镜像 $IMAGE 未构建（需先 bash docker/build.sh）"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# 取证目录隔离到临时目录（HOST_PROMPT_DIR == 容器内 /tmp/cecelia-prompts mount 源）
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT
export HOST_PROMPT_DIR="$DIR"
export CECELIA_PROMPT_DIR="$DIR"
export CECELIA_RUNNER_IMAGE="$IMAGE"

echo "[smoke] detached-prompt-naming: image=$IMAGE dir=$DIR"

# Node 驱动：调真实 spawnDockerDetached spawn 容器（ENTRYPOINT_TEST=1），等容器退出后
# docker logs 取容器报告的 PROMPT_FILE，比对宿主磁盘真实写入的文件。
node --input-type=module -e '
import { spawnDockerDetached } from "'"$BRAIN_DIR"'/src/spawn/detached.js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const HOST_PROMPT_DIR = process.env.HOST_PROMPT_DIR;
const taskId = "00000000-1111-2222-3333-444444444444";
const containerId = "cecelia-smoke-detached-" + process.pid;
const prompt = "DETACHED-SMOKE-PROMPT-" + process.pid;

function fail(msg) { console.error("FAIL:", msg); process.exit(1); }

const { dockerStdout } = await spawnDockerDetached({
  task: { id: taskId, task_type: "harness_planner" },
  prompt,
  containerId,
  env: { CECELIA_ENTRYPOINT_TEST: "1", HARNESS_NODE: "planner" },
});

// 等容器退出（ENTRYPOINT_TEST=1 立即 echo + exit 0）
try { execFileSync("docker", ["wait", containerId], { timeout: 30000 }); } catch (e) {}
let logs = "";
try { logs = execFileSync("docker", ["logs", containerId], { encoding: "utf8" }); } catch (e) { fail("docker logs 失败: " + e.message); }
try { execFileSync("docker", ["rm", "-f", containerId], { stdio: "ignore" }); } catch (e) {}

// 解析容器报告的 PROMPT_FILE（容器内路径）
const m = logs.match(/^PROMPT_FILE=(.+)$/m);
if (!m) fail("容器 stdout 未含 PROMPT_FILE 行；logs=" + JSON.stringify(logs.slice(0, 500)));
const containerPromptFile = m[1].trim();
const basename = path.basename(containerPromptFile);

// 断言 1：basename 含 runInstance 后缀（新协议），不是旧的 ${taskId}.prompt
if (!new RegExp("^" + taskId + "\\.[0-9a-f]{6,}\\.prompt$").test(basename)) {
  fail("容器 PROMPT_FILE basename 不含 runInstance 后缀（疑似旧命名）: " + basename);
}

// 断言 2：宿主磁盘在与容器 env basename 完全一致的路径写出文件，内容正确
const hostFile = path.join(HOST_PROMPT_DIR, basename);
if (!existsSync(hostFile)) fail("宿主缺少与容器 env 一致的 prompt 文件: " + hostFile);
const got = readFileSync(hostFile, "utf8");
if (got !== prompt) fail("宿主 prompt 文件内容不符: 期望[" + prompt + "] 实际[" + got + "]");

// 断言 3：旧命名文件不应是容器要读的那个
if (basename === taskId + ".prompt") fail("命中旧命名 ${taskId}.prompt，协议断裂未修");

console.log("  ✓ 容器报告 PROMPT_FILE=" + containerPromptFile);
console.log("  ✓ 宿主磁盘 " + hostFile + " 存在且内容一致");
console.log("  ✓ basename 含 runInstance 后缀（新协议生效，detached 路径与容器同源）");
'

echo "[smoke] detached-prompt-naming: PASS"
exit 0
