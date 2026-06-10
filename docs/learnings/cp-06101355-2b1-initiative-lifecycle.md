# Learning：okr_initiatives 生命周期状态机（PR 2b-1）

## 背景
Phase 2b 第一步：给 `okr_initiatives` 一条干净生命周期 `planned → queued → running → done / failed`，
为 2b-2 harness 认领 `planned` 铺路。本质是**语义保持的字符串重命名**（不改任何调度逻辑）：
`pending/planning→planned`、`active/in_progress→running`、`completed→done`，queued/archived 不变。

## 根本原因
PRD 把这步标为"低-中风险"，但真实改动面是**跨 13 个文件的 24 处** status 读写点。
初次按 `grep -rn "okr_initiatives" | grep status` 的同行枚举**只抓到 14 处，漏了 9 处**，原因有二：

1. **跨行 SQL**：`FROM okr_initiatives` 与 `WHERE status IN (...)` 不在同一行，同行 grep 看不见
   （routes/shared.js、routes/execution.js、planner.js:229/572 等）。
2. **共享 status 词汇**：`'active'/'completed'/'pending'` 被 okr_projects / okr_scopes / tasks / key_results /
   objectives / pr_plans **共用**。裸 `WHERE status IN (...)` 必须逐个回溯 FROM 子句才能判定主语是不是
   initiative——distilled-docs.js 同一函数里 objectives / okr_projects / okr_initiatives 三段查询长得一模一样，
   只有 FROM 不同。

只有改用「遍历所有引用 okr_initiatives 的文件 + `grep -A3` 多行感知 + 按别名 `oi.`/`i.` 二次确认」的
组合 sweep，才把 9 处漏网全部捞回。

## 另一个大坑：worktree 未提交即被清理 → 全部工作丢失
中途 worktree 被后台清理（heartbeat-guardian 缺失 → watchdog prune），整个工作目录连同
**所有未提交改动一起删除**，无法从 git 恢复（Write/Edit 只写工作树文件，未生成 commit 对象）。
教训：**改动一落地就 commit**（commit 进 branch ref，即使 worktree 再被删也能 `git worktree add <path> <branch>` 恢复），
绝不把"全部做完再一次提交"。

## 下次预防
- [ ] 改某张表的 status 词汇时，**不要信单条同行 grep**；按「该表所有引用文件 × 多行上下文」全扫，逐处回溯 FROM 判主语
- [ ] 共享词汇（active/completed/pending）改名前，先列出所有共用该词汇的表，明确"只改 X 表，其余保留"，逐处分类
- [ ] 用别名维度二次校验：`grep -E "\b(oi|i)\.status\b" | grep 旧值` 必须为空才算扫干净
- [ ] 加 CHECK 约束作为兜底——枚举漏一处 writer，迁移后该 writer 会被 CHECK 拒绝而立刻暴露，胜过静默 drift
- [ ] 回归测试直接断言发出的 SQL 含新词汇 + 不含旧词汇（mock pool 捕获 query 字符串），比断言返回值更能锁住重命名
- [ ] worktree 内**写完一组文件立即 commit**，杜绝未提交工作被 watchdog 清理时全损

## 遗留（2b-2 须知）
`vitest.config.js` exclude 列表里的 quarantine 测试（initiative-queue / initiative-closer /
initiative-completion / planner-initiative-plan / okr-closer.test.js）仍 mock 旧词汇
（`SET status='completed'`、`status IN ('in_progress','active')` 等）。它们不在任何 CI job 运行
（brain-unit 排除、brain-integration 只跑 integration/ 子目录，显式指定路径也被 exclude 拦），
本 PR 未改以免改动不可验证的死测试。**解除隔离或 2b-2 再动 initiative-closer 时必须同步刷新这些断言**，
否则一启用即红。

## 验证
- migration 299 应用后分布：running 341 / queued 79 / done 63 / planned 9 / archived 3 = 495，旧 in-flight 值 0
- 新增回归测试 `initiative-lifecycle-2b1.test.js`（3 例）先 RED 后 GREEN
- smoke `initiative-lifecycle-smoke.sh` 3/3 PASS
- integration `okr-task-progress-loop` + `initiatives-dag-endpoint` 对 cecelia_test（含 CHECK）11/11 PASS
