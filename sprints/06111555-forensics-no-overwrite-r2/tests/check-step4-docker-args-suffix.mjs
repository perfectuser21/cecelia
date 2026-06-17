// Golden Path Step 4 oracle — buildDockerArgs 构造的 docker run 参数里
// prompt/stdout/cid 三类路径均含同一 runInstance 后缀，且跨 spawn 唯一。
// 直接 import 真实 docker-executor（无 mock、无 docker）。未实现时 FAIL（真红）。
import path from "node:path";

const mod = await import("../../../packages/brain/src/docker-executor.js");
const buildDockerArgs = mod.__test__ && mod.__test__.buildDockerArgs;
if (typeof buildDockerArgs !== "function") {
  console.error("FAIL: buildDockerArgs 未从 __test__ 导出");
  process.exit(1);
}

const opts = { task: { id: "cf9ce514-task-step4", task_type: "dev" }, prompt: "p" };
const r1 = buildDockerArgs(opts);
const r2 = buildDockerArgs(opts);
const a1 = (r1.args || []).join(" ");

// 1) --cidfile 必须带实例后缀（不能再是裸 <taskId>.cid）
const cid1 = r1.cidfile || "";
if (/[\/]cf9ce514-task-step4\.cid$/.test(cid1)) {
  console.error("FAIL: cidfile 仍是裸 <taskId>.cid 无实例后缀: " + cid1);
  process.exit(1);
}
if (!cid1.includes("cf9ce514-task-step4")) {
  console.error("FAIL: cidfile 丢失 taskId 前缀: " + cid1);
  process.exit(1);
}

// 2) env 注入容器内完整 prompt/stdout 文件名
const env = r1.envFinal || {};
const pf = env.CECELIA_PROMPT_FILE || "";
const sf = env.CECELIA_STDOUT_FILE || "";
if (!pf || !sf) {
  console.error("FAIL: 未注入 CECELIA_PROMPT_FILE / CECELIA_STDOUT_FILE env（entrypoint 无从按 env 读唯一文件）");
  process.exit(1);
}
if (!a1.includes("CECELIA_PROMPT_FILE=") || !a1.includes("CECELIA_STDOUT_FILE=")) {
  console.error("FAIL: docker args 未含 -e CECELIA_PROMPT_FILE / -e CECELIA_STDOUT_FILE");
  process.exit(1);
}

// 3) 三类路径共享同一 runInstance 后缀
const m = pf.match(/cf9ce514-task-step4\.([0-9a-f]{6,})\.prompt$/);
if (!m) {
  console.error("FAIL: CECELIA_PROMPT_FILE 文件名不含 <taskId>.<hex>.prompt 实例后缀: " + pf);
  process.exit(1);
}
const inst = m[1];
if (!sf.includes("." + inst + ".stdout")) {
  console.error("FAIL: stdout 与 prompt 实例后缀不一致: " + sf + " (inst=" + inst + ")");
  process.exit(1);
}
if (!cid1.includes("." + inst + ".cid")) {
  console.error("FAIL: cid 与 prompt 实例后缀不一致: " + cid1 + " (inst=" + inst + ")");
  process.exit(1);
}

// 4) 宿主写入路径 basename 必须与容器 env basename 一致（否则容器读空）
const fp = (r1.forensics && r1.forensics.promptFile) || "";
if (!fp) {
  console.error("FAIL: buildDockerArgs 未返回 forensics.promptFile（executeInDocker 需据此把 prompt 写到与 env 同名文件）");
  process.exit(1);
}
if (path.basename(fp) !== path.basename(pf)) {
  console.error("FAIL: 宿主写入 basename 与容器 env basename 不一致 → 容器会读不到: " + path.basename(fp) + " vs " + path.basename(pf));
  process.exit(1);
}

// 5) 两次 spawn 实例后缀必须不同（防覆盖核心；不依赖纯秒级时间戳）
const inst2 = ((r2.envFinal && r2.envFinal.CECELIA_PROMPT_FILE) || "").match(/\.([0-9a-f]{6,})\.prompt$/);
if (!inst2 || inst2[1] === inst) {
  console.error("FAIL: 两次 spawn 实例后缀相同/缺失，仍会覆盖: " + inst + " vs " + (inst2 ? inst2[1] : "<none>"));
  process.exit(1);
}

console.log("OK step4: prompt/stdout/cid 共享唯一实例后缀 " + inst + "；跨 spawn 唯一（" + inst + " != " + inst2[1] + "）");
