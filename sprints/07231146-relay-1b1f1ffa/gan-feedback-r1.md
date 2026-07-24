# GAN Round 1 Reviewer Feedback — preview-capacity-gate-and-destroyer

## RUBRIC SCORES

```json
{
  "dod_machineability": 9,
  "scope_match_prd": 4,
  "test_is_red": 9,
  "internal_consistency": 5,
  "risk_registered": 4,
  "verification_oracle_completeness": 6,
  "ci_workflow_alignment": 10
}
```

- **DoD 机检性 = 9**：ARTIFACT/BEHAVIOR 全部是 `node -e`/`manual:bash node ...mjs`/`jq -e` 类硬断言，无 echo/自然语言级弱检查。实测跑了 3 个 vitest 文件，Red 证据与合同声明的"3 failed (3), 3 failed (17)"完全一致（已用 Bash 工具真实执行验证，非轻信合同文字）。
- **Scope 匹配 PRD = 4**：两处明显欠覆盖 PRD 明确要求：① PRD 模块4「用新销毁器对所有 **PR 已关闭/超 24h** 的 preview 逐个执行」——E2E Step3 实际对 `status != 'inactive'` 的**全部**行无差别调用 destroyPreview，完全丢弃了"已关闭/超24h"这个过滤条件；② PRD 模块2「allocatePreview() 改造：整个『admitPreview 判定 + 端口扫描 + INSERT』包在 pg_advisory_xact_lock 内串行化」——合同只把 admitPreview() 定义为纯判定函数（返回 `{admitted:true}`，无 port/db_name），未说明它和现有无锁的 `allocatePreview()`（真正做端口扫描+INSERT）如何共享同一把锁，PRD 这条核心要求实质未被兑现。
- **Test 真红 = 9**：已用 Bash 工具跑 `npx vitest run` 三个 test 文件，输出与合同声明的 Red 证据逐字匹配，且确认 `scripts/host-disk-sampler.sh`/`capacity-gate.js`/`preview-destroyer.js` 当前均不存在。
- **内部一致 = 5**：「未覆盖真实链路清单」段声称"判断已关闭 PR 依赖 `gh pr view --json state`，真调不 mock"，但 `## E2E 验收` 脚本 Step3 从未调用 `gh`，也没有任何 24h 时间窗判断——文字承诺与实际脚本代码矛盾。同时 admitPreview() 的返回值 schema（仅 `{admitted:true}`）与 Golden Path Step6/PRD 描述的"端口扫描+INSERT 全程在同一把锁内"存在语义空隙，两处均是合同自身前后不一致。
- **风险登记 = 4**：全篇搜索不到任何 `## Risks`/`风险登记` 独立段落。上面两条真实生产风险（破坏性批量清扫误杀活跃 PR；准入判定与端口预留之间的 TOCTOU 竞态）完全没有被登记，也没有 mitigation。失败语义声明表覆盖了 dropdb 失败/路径逃逸/DB名不匹配等场景，但没有覆盖这两条本 sprint 最核心的风险。
- **Verification Oracle 完整性 = 6**：Response Schema 段的字段级 jq -e 覆盖到位（503 拒绝体四字段、stop 响应 status 枚举）。但两个关键组合路径缺 oracle：① concurrency-lock 测试只验证 `admitted===true` 的计数，从未验证是否真的产生了一行新的 DB 预留记录，无法抓出"admitPreview 判 true 后再调旧的无锁 allocatePreview 做端口扫描+INSERT"这种典型 TOCTOU 实现；② Final E2E Step3 没有任何断言证明"活跃且 <24h 的 PR 不会被误杀"。
- **CI Workflow 内容对齐 = 10**：target_environment=local_api，非 windows_cloud/windows_wechat/linux_server，按规则填 N/A。（已额外用 Bash 读取 `.github/workflows/preview-deploy.yml`/`preview-cleanup.yml` 核实"真实调用方请求 shape"段落的 Authorization header + body 字段描述准确，非规则强制项，但顺手验证过。）

## VERDICT: REVISION

Round 1，阈值 7/10。`scope_match_prd`(4)、`internal_consistency`(5)、`risk_registered`(4)、`verification_oracle_completeness`(6) 四维 < 7 → REVISION。

## 收敛状态（Round 1）

- 上轮我提的阻塞问题：N/A（首轮）
- 本轮已解决：N/A
- 仍阻塞：0
- 本轮新增阻塞问题：3 个 —— 全部是"PRD 明确要求但未覆盖 / 合同自相矛盾 / 真实生产风险未登记"，非"可以更严谨"类锦上添花
- 合同行数：423 行（首轮，暂无对比基线）

## 需要 Proposer 修的（按优先级）

### 问题 1（维度：scope_match_prd / internal_consistency，破坏性风险，最高优先级）

**描述**：`## E2E 验收` 脚本 `[3/3]` 段用 `SELECT pr_number FROM preview_environments WHERE status != 'inactive'` 拉取全部现存 preview，然后无差别对每一个调用 `POST /preview/stop/:pr`。PRD 模块4原文是「用新销毁器对所有 **PR 已关闭/超 24h** 的 preview 逐个执行，实测宿主空闲回升」——过滤条件被完全丢弃。这段脚本的 `BRAIN_URL` 默认就是 `localhost:5221`（本机即生产 Brain 宿主），意味着这条 E2E 一旦真的被执行，会把当前所有正在开发、PR 仍然开着、远未超过 24h 的合法 active preview 全部销毁，属实打实的生产事故风险，而不是"可以更严谨"级别的建议。

合同「未覆盖真实链路清单」段还专门写了"判断已关闭 PR 依赖 `gh pr view --json state`，真调不 mock"——但这句承诺完全没有落到 E2E 脚本里，脚本里根本没出现 `gh` 这个词。合同自己内部就打架。

**修复**：E2E Step3 改成先用 `gh pr view --json state,closedAt -R perfectuser21/cecelia <pr>`（或等价的 `gh pr list --state closed`）判断 PR 是否已关闭，或用 `preview_environments.created_at`/`updated_at` 判断是否超 24h，只有满足其一才调用 destroyPreview；并补一条负向断言（seed 一个"刚创建、PR 语义上仍活跃"的 fixture 行，验证 sweep 不会碰它）。

### 问题 2（维度：scope_match_prd / internal_consistency / verification_oracle_completeness）

**描述**：PRD 模块2原文明确要求"整个「admitPreview 判定 + 端口扫描 + INSERT」包在 pg_advisory_xact_lock(固定 key) 内串行化"，这是本 sprint 立项的根本原因（"并发双通过竞态"导致磁盘打满）。但合同定义的 `admitPreview()` 返回值 schema 只有 `{admitted:true}`（成功分支不含 port/db_name），说明它本身不做端口扫描+INSERT；而现有 `allocatePreview()`（真正做端口扫描+INSERT）目前完全没有任何锁（已读 `packages/brain/src/preview-manager.js` 源码确认：只是两条独立 query，无 transaction、无 advisory lock）。合同没有说明这两者最终如何被同一把锁包住——是 admitPreview() 自己吸收端口扫描+INSERT 逻辑（那它的返回值 schema 就该补 port/db_name），还是调用方（routes/preview.js）需要开一个事务、拿锁后依次调用 admitPreview() 和 allocatePreview()？两种设计都行，但合同必须选一个并写清楚。

现有的 Step6 concurrency-lock 测试（`t3-admit-preview.mjs concurrency-lock`）只是并发调用 3 次 `admitPreview()`，断言 `admitted===true` 的数量恰好为 1——但整个测试期间从未插入任何新的 DB 行，也没有校验被 admitted 的那个 PR 是否真的产生了预留记录。如果 generator 老老实实按现有（无锁的）`allocatePreview()` 在 admitPreview() 判定通过之后单独再调一次，这个测试依然会绿，但实际线上会退回到 TOCTOU 竞态——这正是 PRD 要修的那个根因 bug，完全没被测出来。

**修复**：二选一并在合同里写清楚：
- 方案A：admitPreview() 内部直接吸收端口扫描 + INSERT（同一个 advisory lock 事务内完成判定和预留），成功时返回值升级为 `{admitted:true, port, db_name}`；routes/preview.js 直接消费这个返回值，不再单独调用旧的 `allocatePreview()`。
- 方案B：明确定义一个新的编排层（例如在 routes/preview.js 或一个新导出函数）显式开启一个事务、拿同一把 advisory lock，在锁内依次调用 admitPreview() 判定 + 改造后带 lock 参数的 allocatePreview()。

无论哪种，都要补一条 BEHAVIOR：剩余 1 个名额时并发发起 N 个真实的"判定+预留"请求（走完整路径，不能只调 admitPreview），断言 `preview_environments` 里最终**恰好新增 1 行**，而不是只数 `admitted===true` 的返回值个数。

### 问题 3（维度：risk_registered）

**描述**：合同全篇没有独立的 `## Risks`/`风险登记` 段落。上述问题1、问题2都是本 sprint 特有、真实存在的高风险点，理应被显式登记（哪怕当前"失败语义声明"表覆盖了一部分技术性失败场景，但完全没提到这两条）。

**修复**：新增一个 `## Risks` 段，至少登记：
1. Final E2E 批量清扫误杀活跃/未过期 preview 的风险 + mitigation（问题1的修复方案）
2. admitPreview 判定与端口预留之间的竞态风险 + mitigation（问题2的修复方案）
