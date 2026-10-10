#!/usr/bin/env bash
# Smoke: 秋米中英文 Notion 状态一一对应（任务 125a0cd2）——
#   QIUMI_STATUS_MAP / TASK_STATUS_TO_NOTION 只产出 Notion 合法选项，等待/失败/受阻单独显示。
# 依赖约束：bash+node（蓝绿 pre-swap 在 brain 容器内跑，禁 jq/网络/DB）。
set -euo pipefail
printf '%s\n' "▶️  smoke: qiumi-status-map-smoke.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f /app/src/lib/qiumi-status-map.js ]; then SRC=/app/src; else SRC="$SCRIPT_DIR/../../src"; fi
SRC="$SRC" node --input-type=module -e '
const src = process.env.SRC;
const { QIUMI_STATUS_MAP, enStatusFor } = await import("file://" + src + "/lib/qiumi-status-map.js");
const { TASK_STATUSES } = await import("file://" + src + "/lib/task-status-transitions.js");
const { TASK_STATUS_TO_NOTION } = await import("file://" + src + "/notion-push-sync.js");
const errs = [];
const check = (ok, msg) => { if (!ok) errs.push(msg); };

const ZH_OK = new Set(["排队中","进行中","受阻","失败","已完成","淘汰"]);
const ZH_FORBIDDEN = ["收集","下一个行动","阻塞","委派"];
const EN_OK = new Set(["Planned","Delegated","In Progress","Done","Cancelled","Queued","Blocked","Failed"]);

check(QIUMI_STATUS_MAP && TASK_STATUS_TO_NOTION && typeof enStatusFor === "function", "导出缺失");
check(Array.isArray(TASK_STATUSES) && TASK_STATUSES.length > 0, "TASK_STATUSES 为空");
for (const s of TASK_STATUSES) check(s in QIUMI_STATUS_MAP, `Brain 状态缺表项: ${s}`);
for (const [k, m] of Object.entries(QIUMI_STATUS_MAP)) {
  if (m.zh !== null) check(ZH_OK.has(m.zh), `中文非法: ${k}→${m.zh}`);
  check(!ZH_FORBIDDEN.includes(m.zh), `中文出现人工专属/入口态: ${k}→${m.zh}`);
  if (m.en !== null) check(EN_OK.has(m.en), `英文非法: ${k}→${m.en}`);
}
for (const [k, v] of Object.entries(TASK_STATUS_TO_NOTION)) check(EN_OK.has(v), `推送映射非法: ${k}→${v}`);

const expect = {
  queued: ["排队中", "Queued"], blocked: ["受阻", "Blocked"], failed: ["失败", "Failed"],
  completed_no_pr: ["已完成", "Done"], cancelled: ["淘汰", "Cancelled"], in_progress: ["进行中", "In Progress"],
};
for (const [k, [zh, en]] of Object.entries(expect)) {
  const m = QIUMI_STATUS_MAP[k];
  check(m && m.zh === zh && m.en === en, `对应关系错: ${k}→${m?.zh}/${m?.en}，期望 ${zh}/${en}`);
}
check(QIUMI_STATUS_MAP.failed?.clearTaskNo === true, "failed 未清任务号");
const dev = enStatusFor("blocked", { blockedReason: "delegated_device_job" });
check(dev === "In Progress", `delegated_device_job 应为 In Progress，实为 ${dev}`);

if (errs.length) { for (const e of errs) console.error("❌ " + e); process.exit(1); }
console.log(`✅ PASS qiumi-status-map-smoke（${TASK_STATUSES.length} 个 Brain 状态全覆盖，中英文均为合法选项）`);
'
