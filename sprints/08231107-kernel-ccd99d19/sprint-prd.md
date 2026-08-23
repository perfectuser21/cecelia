# Sprint PRD — 投影物化两阶段原子化（capability 节点全部写完再翻转 active）[r54]

## OKR 对齐

- **对应 KR**：KR2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环，进度 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 map 投影换代竞态本体，止住 r43/r44 双死根因）

## 背景

map 投影每 ~10 分钟 rescan 换代。当前实现下，新投影 run 行会先被置为可读状态、capability 节点随后才物化，导致换代窗口内 `capabilityNodes(runId)` 返回空集或**部分集**。#5017 已把「空集」判为瞬态兜底（`projection_capabilities_empty` → unknown），但**部分集仍会漏 claim 误判**（读到不完整的能力节点集合，radius 判定据此产出错误 freshness/claim 结果）。本 sprint 做 r43/r44 双死根因的本体修复：把投影物化改为两阶段原子化，让读取侧永远看到「要么整张旧图、要么整张新图」，杜绝半张图。

## Golden Path（核心场景）

系统从 [rescan 触发投影换代] → 经过 [两阶段物化] → 到达 [读取侧只见完整投影]

具体：
1. [触发条件] scheduler rescan 触发某 scope 投影换代，projector 开始生成新 run。
2. [系统处理] 新 run 以中间态（`status='materializing'`）写入 `map_projection_runs`；随后物化**全部** capability 节点与边；节点/边全部落库后，在**单个事务**内翻转 `new.status='active'` + 旧 active 行 `status='superseded'`。
3. [可观测结果] 读取侧（`projectionForRevision` / `projectionForScope` 及 `capabilityNodes` 所依赖的 active run 选择）**只选 `status='active'`**；换代过程中任一读取，得到的要么是旧投影的全量节点集，要么是新投影的全量节点集，绝不出现部分集。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- **物化中途崩溃**：留下 `materializing` 残行，不参与读取（旧 active 继续服务），下一轮 rescan 清理残行。
- **并发读取**：物化进行中的任意时刻读取，只能命中 active（旧或新的完整投影），不得命中 materializing 残行。
- **空集 vs 部分集**：#5017 的空集瞬态兜底保留；本 sprint 额外消除「部分集」这一未被兜底的漏洞。

## 范围限定

**在范围内**：`map/projector.js` 物化流程改两阶段（materializing → 单事务翻转 active/superseded）；读取侧 active-only 选择的语义锁定；RED/GREEN 回归测试冻结登记。
**不在范围内**：radius 判定逻辑重写、rescan 调度周期调整、#5017 空集兜底逻辑改动、map schema 之外的其他 kernel 模块。

## 假设

- [ASSUMPTION: `map_projection_runs` 已有或可扩展中间态取值 `materializing`；旧 `building` 语义若存在由 proposer 在实现阶段对齐，不新增第三种并存中间态。]
- [ASSUMPTION: 换代切换发生在拥有事务的调用路径（projector run 的 `ownsTransaction` 分支），物化与翻转在同一事务边界内。]

## 预期受影响文件

- `packages/brain/src/map/projector.js`：物化写入改为 materializing 中间态 + 单事务原子翻转 active/superseded。
- `packages/brain/src/map/radius.js`：`projectionForRevision`/`projectionForScope`/active run 选择只取 `status='active'`（部分集不可达）。
- `packages/brain/src/map/*.test.js` 及 `__tests__/`：新增 RED（复现物化中途读到部分节点集）→ GREEN（读取全量旧或全量新）回归测试，冻结登记进 Test Contract。

## 合同硬约束（Test Contract 登记纪律，proposer 必须遵守）

- **## Test Contract 表**逐行登记 artifacts 里每个冻结测试的**完整路径**（4 列格式，`testFile` 用 backtick 包裹，checker 从第 3 列解析路径）。
- 每行 **BEHAVIOR 逐词取自对应测试文件真实 `it()` 名子串**（含 repo 路径行，禁止自然语言改写至无法与 `it()` 名匹配）。
- **manual 命令带 `vitest -t` 过滤时**，断言必须用宽松式 `grep -qE "[1-9][0-9]* passed"`，禁止冻结 `"1 passed (1)"` 类精确串（`-t` 过滤会输出 `N passed | M skipped`，精确串必红——r45 家族死因）。
- Red commit 只 `git add` 精确 `*.test.ts`/`*.test.js` 路径，禁止 `git add .`。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 双源均空；下列为 task 描述显式约束 -->
- 超时/延迟: 待定（PrepPRD/decisions 未指定）
- 换代周期: rescan 每 ~10 分钟（既有，不改）
- 可靠性: 物化中途崩溃不得影响读取（旧 active 持续服务），残行由下轮 rescan 清理
- 可观测: 读取侧命中的 run 必须可判定 status（materializing 残行对读者不可见）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 级本任务为空）；仅注入与本 kernel/合同域相关的铁律 -->
- [Test Contract格式] Test Contract 表固定 4 列，testFile 用 backtick 包裹，checker 从第 3 列解析路径（来源: area）
- [Red commit精确] Red commit 必须只 git add 精确测试路径，禁止 git add . / git add .harness（来源: area）
- [vitest exit语义] 合同验证命令必须实跑确认 exit code 语义；vitest 对 include 范围外路径绿态也 exit 0（来源: area）
- [status枚举全查] 涉 status 枚举硬编码断言，GAN 新增状态值时须全仓库检查（本任务新增 materializing/沿用 superseded）（来源: area）
- [manual oracle真跑] 合同批准前记录 manual oracle 真实 exit code，并确认目标解释器确实启动（来源: area）
- [local_api judge闸] local_api/无 UI smoke 任务需在合同内规避 judge 机械闸⑤ meta_verification_gap 死锁（来源: area）
- [系统]真环境验证才算 done（来源: area）
- [系统]测试默认多租户（来源: area）
- [系统]禁止写死环境假设值（来源: area）
- [系统]租户隔离（来源: area）
- [系统]单 slot 串行任务，并行只许跨 slot（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey 内 ability 均为 planned，无 done/working 历史 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（vitest RED→GREEN + 可选 psql 核对 run status）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（vitest -t 过滤 + grep -qE "[1-9][0-9]* passed" 宽松断言）
# 期望验收点（自然语言）：
#   RED — 在两阶段物化落地前，构造换代窗口内读取，断言能读到「部分节点集」（不完整 capability 集合），测试失败即复现根因。
#   GREEN — 两阶段物化落地后，同样的换代窗口读取，断言读到的要么是旧投影全量节点集、要么是新投影全量节点集，永不出现部分集；materializing 残行对读取侧不可见。
```

## journey_type: autonomous
## journey_type_reason: 改动仅落在 packages/brain/src/map/ 纯后端 kernel（投影物化/读取），无 UI、无远端 agent、无 engine hooks。
## target_environment: local_api
## target_environment_reason: payload 显式提供 local_api，且改动仅 packages/brain（纯 API/后台任务），E2E 由本地 evaluator 跑 vitest + curl/psql localhost:5221。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
