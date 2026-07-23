=== Red 证据（vitest JSON reporter, 2026-07-22 23:52:53 PDT）===
总测试数: 17, 3 个测试文件全部 failed

--- 逐文件断言状态 ---
sprints/07231146-relay-1b1f1ffa/tests/capacity-gate.test.js => failed
  - pending  readHostDisk [BEHAVIOR] — 4 种拒绝分支 样本文件缺失 → reason sample_missing
  - pending  readHostDisk [BEHAVIOR] — 4 种拒绝分支 样本 JSON 损坏 → reason sample_corrupt
  - pending  readHostDisk [BEHAVIOR] — 4 种拒绝分支 样本过期（>180s）→ reason sample_stale
  - pending  readHostDisk [BEHAVIOR] — 4 种拒绝分支 样本字段不完整 → reason sample_incomplete
  - pending  admitPreview [BEHAVIOR] — 四层判定 + 并发串行化 active/starting/cleaning 数量 >= 6 → 拒绝 too_many_active
  - pending  admitPreview [BEHAVIOR] — 四层判定 + 并发串行化 effective_free_bytes - 3.5GiB < 35GiB → 拒绝 insufficient_free_space（字节级比较）
  - pending  admitPreview [BEHAVIOR] — 四层判定 + 并发串行化 usage_pct >= 85 → 拒绝 usage_pct_too_high
  - pending  admitPreview [BEHAVIOR] — 四层判定 + 并发串行化 并发准入通过 pg_advisory_xact_lock 串行化，剩余 1 名额时 3 并发请求只 1 个 admitted，且 DB 恰好新增 1 行真实预留记录
  - pending  admitPreview [BEHAVIOR] — 四层判定 + 并发串行化 已存在活跃记录的 PR 重推（幂等复用）跳过准入，即使样本过期也放行
sprints/07231146-relay-1b1f1ffa/tests/host-disk-sampler.test.js => failed
  - failed  host-disk-sampler.sh [BEHAVIOR] 原子写入 host-disk.json 且字段完整（sampled_at_epoch/data_avail_bytes/apfs_unallocated_bytes/effective_free_bytes/usage_pct）
  - failed  host-disk-sampler.sh [BEHAVIOR] cron 等价环境（显式 PATH，仅 /usr/bin:/bin）下仍能成功采样
  - failed  host-disk-sampler.sh [BEHAVIOR] 脚本头部声明 set -euo pipefail
sprints/07231146-relay-1b1f1ffa/tests/preview-destroyer.test.js => failed
  - pending  destroyPreview [BEHAVIOR] — 7 步流程 / 安全防护 / 幂等 / 并发去重 7 步流程完整执行：DB 已删 + worktree 已删 + 进程已杀 + 临时文件已清 + 终态 inactive
  - pending  destroyPreview [BEHAVIOR] — 7 步流程 / 安全防护 / 幂等 / 并发去重 DB 名不匹配 ^cecelia_preview_[0-9]+$ → 拒绝 DROP DATABASE，置 cleanup_failed，不误删邻近库
  - pending  destroyPreview [BEHAVIOR] — 7 步流程 / 安全防护 / 幂等 / 并发去重 worktree 路径通过符号链接逃逸 preview 根目录 → realpath 校验 abort，不执行 rm -rf
  - pending  destroyPreview [BEHAVIOR] — 7 步流程 / 安全防护 / 幂等 / 并发去重 对已 inactive 的 PR 重复调用 → 幂等成功
  - pending  destroyPreview [BEHAVIOR] — 7 步流程 / 安全防护 / 幂等 / 并发去重 同一 PR webhook + reaper 并发触发销毁 → per-PR advisory lock 保证只实际执行一次

说明: capacity-gate.test.js / preview-destroyer.test.js 因 beforeAll import
packages/brain/src/capacity-gate.js / preview-destroyer.js（尚不存在）而 suite load failure，
其内部 it() 均标记为 pending（非 passed），vitest JSON 顶层 numPassedTests 字段对
suite-load-failure 场景统计有误（把 pending 计入 passed），但断言级别（assertionResults[].status）
无一为 passed，与合同 contract-draft.md 记录的预期红证据（Test Files 3 failed(3) / Tests 3 failed(17)）完全一致。
host-disk-sampler.test.js 的 3 个 it() 因 scripts/host-disk-sampler.sh 不存在，真实执行 execSync 抛异常，status=failed。
