// Golden Path Step 1 oracle — 同一 taskId 写两次 prompt 取证，互不覆盖。
// 直接 import 真实 docker-executor 模块（无 mock）。未实现唯一化时此脚本 FAIL（真红）。
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "forensics-s1-"));
process.env.CECELIA_PROMPT_DIR = dir;
process.env.HOST_PROMPT_DIR = dir;

const mod = await import("../../../packages/brain/src/docker-executor.js");
const writePromptFile = mod.__test__ && mod.__test__.writePromptFile;
if (typeof writePromptFile !== "function") {
  console.error("FAIL: writePromptFile 未从 __test__ 导出");
  process.exit(1);
}

const taskId = "cf9ce514-task-step1";
const p1 = writePromptFile(taskId, "RUN-A-CONTENT");
const p2 = writePromptFile(taskId, "RUN-B-CONTENT");

if (p1 === p2) {
  console.error("FAIL: 同 taskId 两次返回同一路径，第二次仍覆盖第一次: " + p1);
  process.exit(1);
}
if (!existsSync(p1) || !existsSync(p2)) {
  console.error("FAIL: 两个取证文件未同时存在: " + p1 + " / " + p2);
  process.exit(1);
}
const c1 = readFileSync(p1, "utf8");
const c2 = readFileSync(p2, "utf8");
if (c1 !== "RUN-A-CONTENT") {
  console.error("FAIL: 第一次写入内容被覆盖/损坏: [" + c1 + "]");
  process.exit(1);
}
if (c2 !== "RUN-B-CONTENT") {
  console.error("FAIL: 第二次写入内容错误: [" + c2 + "]");
  process.exit(1);
}
if (!path.basename(p1).startsWith(taskId) || !path.basename(p2).startsWith(taskId)) {
  console.error("FAIL: 文件名未保留 taskId 前缀（批量 ls|grep 会失效）: " + p1 + " / " + p2);
  process.exit(1);
}
if (!p1.endsWith(".prompt") || !p2.endsWith(".prompt")) {
  console.error("FAIL: .prompt 扩展名丢失: " + p1 + " / " + p2);
  process.exit(1);
}
console.log("OK step1: two distinct prompt files, first preserved (" + path.basename(p1) + ", " + path.basename(p2) + ")");
