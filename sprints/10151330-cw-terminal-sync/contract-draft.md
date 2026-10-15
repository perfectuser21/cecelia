# Contract Draft — Coding workflow 终态可靠收尾

任务：427d7e49-27c5-4612-b115-9214f03d47f9。GP-Anchor: none(infra)。
被测入口：packages/brain/scripts/coding-workflow/runner/run-once.mjs。
真实范围：runner 终态回执、状态镜像和新生成的 QA 交接表述；不改变自动合并权限、任务状态机或历史失败报告。

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖项（真实 it 名称） |
|---|---|---|
| terminal-01 | `packages/brain/scripts/coding-workflow/runner/__tests__/state-store-retry.test.mjs` | 分支已删时通过 refs/pull 关联任务，写回 merged |
| terminal-02 | `packages/brain/scripts/coding-workflow/runner/__tests__/state-store-retry.test.mjs` | 保留远端扩展历史，并移除本地已删除的镜像字段 |
| terminal-03 | `packages/brain/scripts/coding-workflow/runner/__tests__/state-store-retry.test.mjs` | GET 失败不拿空 prior 覆盖，不记录镜像成功 |
| terminal-04 | `packages/brain/scripts/coding-workflow/runner/__tests__/state-store-retry.test.mjs` | 错 task_id 或非 CW branch 不可回写 |
| terminal-05 | `packages/brain/scripts/coding-workflow/runner/__tests__/state-store-retry.test.mjs` | PATCH 失败后仍 dirty；成功幂等，读写间的新字段保留且下轮补发 |
| terminal-06 | `packages/brain/scripts/coding-workflow/runner/__tests__/state-store-retry.test.mjs` | 恢复状态也拒绝错误body.id，不把别的任务批准落到本地 |
| terminal-07 | `packages/brain/scripts/coding-workflow/runner/__tests__/pr-sync.test.mjs` | 重开以实际 GitHub OPEN 为准；unknown 不返回陈旧 CLOSED |
| terminal-08 | `packages/brain/scripts/coding-workflow/runner/__tests__/pr-sync.test.mjs` | 窗口外待办最多核30项并轮转，不截掉第31项 |
| terminal-09 | `packages/brain/scripts/coding-workflow/runner/__tests__/pr-sync.test.mjs` | 同PR号按repo namespace隔离；错仓账fail-closed |
| terminal-10 | `packages/brain/scripts/coding-workflow/runner/__tests__/pr-sync.test.mjs` | 数量、唯一ID与真实原文都确认后才清pending；重复tick不POST |
| terminal-11 | `packages/brain/scripts/coding-workflow/runner/__tests__/pr-sync.test.mjs` | 读回失败或内容不符保留pending；下轮只读确认 |
| terminal-12 | `packages/brain/scripts/coding-workflow/runner/__tests__/pr-sync.test.mjs` | 发送后崩溃留下unknown，恢复不重POST |
| terminal-13 | `packages/brain/scripts/coding-workflow/runner/__tests__/run-once-terminal-sync.test.mjs` | 同 tick 合并删 branch 后同步；下 tick 停预览再次同步，历史失败不改成全 PASS |
| terminal-14 | `packages/brain/scripts/coding-workflow/runner/__tests__/run-once-terminal-sync.test.mjs` | GitHub合并成功但本地mark前进程死亡：精确merge intent重启只收账，不二次合并 |
| terminal-15 | `packages/brain/scripts/coding-workflow/runner/__tests__/run-once-terminal-sync.test.mjs` | 关闭回执PATCH失败且已退出closed100窗口：下tick仍收尾并同步 |
| terminal-16 | `packages/brain/scripts/coding-workflow/runner/__tests__/run-once-terminal-sync.test.mjs` | 旧closed待办实际已重开：不再停预览，并从远端删除已撤销镜像字段 |
| terminal-17 | `packages/brain/scripts/coding-workflow/runner/__tests__/run-once-terminal-sync.test.mjs` | terminal本机QA文件丢失：从已核身份的Brain恢复再停预览，保留原FAIL轮 |
| terminal-18 | `packages/brain/scripts/coding-workflow/runner/__tests__/run-once-terminal-sync.test.mjs` | 回执已入库但响应失败：重启不追加handoff，不猜Learning已写或重发 |
| terminal-19 | `packages/brain/scripts/coding-workflow/runner/__tests__/run-once-terminal-sync.test.mjs` | merge intent与实际MERGED head不同：不恢复虚假的批准或收账 |
| terminal-20 | `packages/brain/scripts/coding-workflow/runner/__tests__/run-once-terminal-sync.test.mjs` | 恢复在本地merged落盘后中断、pending仍仅有intent：仍补回执待办 |
| terminal-21 | `packages/brain/scripts/coding-workflow/runner/__tests__/run-once-multirepo.test.mjs` | 人工合并删branch且回执失败：窗口外重试不获得自动合并权限 |
| terminal-22 | `packages/brain/scripts/coding-workflow/runner/__tests__/run-once-multirepo.test.mjs` | 人合并的head不同于原批准：仅记真实合并，不声称AI QA通过 |
| terminal-23 | `packages/brain/scripts/coding-workflow/runner/__tests__/run-once-retention.test.mjs` | qa-<pr>.json / cifix-<pr>.json 是状态台账：超期也不删；同目录的执行记录照常按期清 |

## 行为合同

| 行为 | 可观察验收 | 永久回归 |
|---|---|---|
| 合并删分支后仍同步 | refs/pull 或已核缓存关联同一任务；Brain qa_state.merged 与实际 head 一致 | state-store-retry.test.mjs；run-once-terminal-sync.test.mjs |
| 终态窗口外重试 | 退出 merged30/closed100 仍保留身份待办；每轮最多核 30 项并轮转；真实 OPEN 不按旧 CLOSED 停预览 | pr-sync.test.mjs；run-once-terminal-sync.test.mjs |
| 下一 tick 停预览 | 官方 stop 成功后本机和 Brain qa_state.preview_stopped 同步；失败保留待办 | run-once-terminal-sync.test.mjs；run-once-closed.test.mjs |
| GET/PATCH 与身份错误 | GET 失败、task/repo/PR 显式矛盾不写；PATCH 失败保持 dirty；保留扩展历史并移除撤销字段 | state-store-retry.test.mjs |
| 外部成功后进程中断 | 合并前持久 exacthead intent；GitHub 确认 MERGED 且 head 相同才恢复收账；已写 local merged 也不漏待办；不再次 merge | run-once-terminal-sync.test.mjs |
| 人工合并边界 | automerge=false 仍不调用 merge；实际 head 不同于批准只如实记录 UNKNOWN，不补造批准 | run-once-multirepo.test.mjs |
| 非幂等 Learning | 发送前留痕；数量、唯一 IDs、分页读回原文哈希均一致才 confirmed；未知、部分成功或已有回执未确认均保留待办，不重 POST | pr-sync.test.mjs；run-once-terminal-sync.test.mjs |
| 交接表述真实 | AI QA 第 approved.round 轮通过、历史记录 N 轮分开；原 FAIL/PASS、原报告及批准不改写 | run-once-terminal-sync.test.mjs；run-once-merge.test.mjs |
| 台账保留 | pr-sync-pending.json 不受日志保留期删除；命名空间隔离 | run-once-retention.test.mjs；pr-sync.test.mjs |

以上测试均位于 packages/brain/scripts/coding-workflow/runner/__tests__/。

## 验收命令与证据

```bash
cd packages/brain
node ../../node_modules/vitest/vitest.mjs run scripts/coding-workflow/runner/__tests__/pr-sync.test.mjs scripts/coding-workflow/runner/__tests__/state-store-retry.test.mjs scripts/coding-workflow/runner/__tests__/run-once-terminal-sync.test.mjs scripts/coding-workflow/runner/__tests__/run-once-multirepo.test.mjs --maxWorkers=1 --minWorkers=1
```

红提交 afa888649 的原 8 例为 7 FAIL / 1 PASS；冻结实现 0a97bd287510209caaf1772160d55d7f2ec84197 关键 55 例与相关回归累计 123 例通过，根会话独立 39 例通过。证据在 cw-reliability-20261015/terminal-sync/。
上述为隔离沙箱回归，不代表正式 CI、部署或新真实任务通过。正式新基线来源、PR 门禁以及两条无人干预真实任务必须分别留证；Learning unresolved 不能计作全闭环成功。

## 来源与禁止事项

正式原生选择器必须先证明已有 F3 消费者真实选中 runner 测试并经 sandbox.runOnceProcess 的 spawn(process.execPath,[RUN_ONCE]) 到达入口。本文档等辅助产物仅挂该真实入口；changes 片段使用 role=release，不创造 F1 业务归属或绕过门禁。
不触常驻服务、凭据与真实任务终态；ZENITHJOY #2132 禁合并；不删除历史现场，不手工修改批准或把 FAIL 改为 PASS。
