---
task_id: c8fab3c8-c85e-4e7e-a610-ce776c4aefe2
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 8
可验证: 6
场景覆盖: 7
回归风险: 8
可执行: 8

### R-1
针对: Q-1, Q-2, Q-3, Q-4, I-1
严重度: 重要
场景: QA 按 Q-1 的前提去找「本 PR 的预览环境 Brain」，发现 Deploy Preview Environment 这个检查是红的（跨 PR 的既有故障），没有可用的预览 URL。这样 Q-1~Q-4 四个接口场景一个都跑不了，I-1 在接口层就没有任何真人验收证据。
依据: 铁律 INV-909ce765 明确写了「Deploy Preview Environment check 跨 PR 失败是 Brain infra 既有故障（非 required check）」；规格 `## 铁律对照` 没有列这条，Q-1~Q-4 也只写了预览环境这一个执行地，没有备选。迁移逻辑本身已核实可行：`migrate.js:67-76` 由外层事务包住执行，545 也是同样写法。
说明: Q-1~Q-4 的前提要写一个本机兜底：从本分支在本机起 Brain，`DB_NAME=cecelia_scratch`，用非 5221 的独立端口，先跑 migrate，再按 smoke guard 的口径授权写入（BRAIN_URL 和 DATABASE_URL 指向同一个 scratch 库，对应 INV-f437b0fd）。命令要具体到能直接粘贴执行。预览环境可用时优先用预览环境。另外在 `## 铁律对照` 补上 INV-909ce765。

### R-2
针对: S-1, Q-5, I-2
严重度: 重要
场景: 迁移 552 部署到生产后，没有任何人核对生产库原有的 made_by 取值是不是都还在。比如生产曾在迁移外把这个约束改过名、或者已经加宽过取值：迁移读到的定义是 NULL，就会按 193 的三值重建出 `decisions_made_by_check`，迁移外加的取值被悄悄收窄；如果另一个名字的旧约束还留着，`made_by=ai` 在生产上照样 500，而 CI 和 scratch 全是绿的。
依据: I-2 要求「迁移外加宽的取值全部保留……（真库验收）」。规格 S-1 第 18 行只按固定名 `decisions_made_by_check` 读取；`## 未覆盖真实链路` 第 1 条只写了「待部署后由 pg_get_constraintdef 自报确认」，没有落到任何一个 Q-n，也没说谁来做、什么时候做、和什么对比。Q-5 是在 scratch 里人为造出的形态，证明不了生产的真实形态。
说明: 增加一条只读的真库验收场景：合并前用一条只读查询（不写库，INV-1129ee0d 管的是写入）列出生产 `decisions` 上所有约束定义里涉及 made_by 的 CHECK（不只看这一个约束名），记为 D0；部署后再查一次得到 D1，断言 D1 的取值 ⊇ D0 ∪ {ai}，并且没有别的约束会拒绝 ai。如果 D0 显示生产约束名不是 `decisions_made_by_check`，S-1 要相应改成按 made_by 列去找 CHECK 约束，而不是按固定名查找。执行地按 INV-96054a8b，只做读，不在 us-vps 上跑任何负载。

### R-3
针对: S-2
严重度: 建议
场景: 开发方照 S-2 第 4 条「全部在同一事务内」逐条实现：先插 `made_by='bogus'` 并等它报 23514，之后第 5 条查列类型和默认值时，会因为「current transaction is aborted」整体报错，导致 S-2 的验证命令跑不过。
依据: 参照的 `migration-542-coding-workflow-activities.pg.integration.test.js:60-65` 在预期报错的语句前后用的是 `SAVEPOINT` / `ROLLBACK TO SAVEPOINT`；S-2 没写这一点。
说明: 在 S-2 第 4 条写明，bogus 插入要包在 SAVEPOINT 里，报错后回滚到这个 SAVEPOINT 再继续往下断言。
