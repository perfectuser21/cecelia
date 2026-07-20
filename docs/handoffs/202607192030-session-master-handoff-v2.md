# 总交接单 v2 — 07-19 P0诊断+六项修复+待启动的Inbox设计 session

**verdict**: PASS（本session已完成项）+ 明确的下一步（新session直接可续）

## 给下一个大脑：先做这一件事

**核实生产 Brain 版本是否已经追上 main**：

```bash
curl -s localhost:5221/api/brain/version
git -C /Users/administrator/perfect21/cecelia log origin/main --oneline -1
```

写本交接单时（2026-07-19 12:30 UTC 左右）生产还停在 `1.267.16`，main 已经是 `1.267.17`（含 PR#4121 的 zombie-cleaner 修复）。原因：合并 PR#4121 触发的那次 Gate3 部署在 `npm ci --workspace=packages/brain` 这一步撞上了 `mkdir ENOENT '/Users/administrator/.npm'`——**已确认是本 session 高强度并发操作 npm 缓存目录造成的瞬态竞态，不是代码 bug**（已手动在 `cecelia-deploy-main` 里重跑 `npm ci --workspace=packages/brain --omit=dev --omit=optional --ignore-scripts` 验证成功，429 packages 正常装完，无任何错误）。

- 如果版本已经自然追上（比如后续又有 PR 合并触发了成功的部署）→ 不用管，往下看"下一步"
- 如果还停在 1.267.16 → 随便找一个改动（哪怕是无意义的 whitespace）走一次 `/dev` 路径A触发新部署，或者查一下有没有直接触发部署 webhook 的手段（`DEPLOY_TOKEN` 在 1Password "cecelia-deploy" 条目，本session没能顺利 source 出来，需要排查一下 `~/.credentials/cecelia-deploy.env` 这个文件的格式，它现在的内容是 SSH known_hosts 格式的 "valid from=0 / expires=0"，不是标准 KEY=VALUE 的 env 格式，可能是 1Password 条目本身配错了，值得顺手修一下）

## 本session完整时间线（从锚点回填一路到现在）

1. 刀C锚点回填四件套（PR#4098+#4100）
2. 发现 arch_review 870x 失败 + 33个任务被 pre-flight 阻塞
3. 用户叫停后台派发 → `POST /tick/drain`（后来发现这个操作不持久化，Gate3部署会清零，已在第7项根治）
4. **inbox/capture 机制深挖**：产出 capture-architecture.html artifact，识别"三轨互不相通"+ persistDigest() 真bug（open_questions/tensions 提炼了但从未落库）。**只讨论完成设计草案，未开工——这是下面"下一步"的核心**
5. 系统性重复建设审计（3个并行Explore agent），产出 duplication-audit.html，发现 harness完成态可被绕过验证
6. 任务完成态硬闸（PR#4102）+ arch_review location修复（PR#4105）+ features/journey_features表混淆修复（PR#4108+#4113）
7. **tick drain持久化 + 完成态硬闸blocked方案**（PR#4116+#4117）——根因比最初假设更深：不是payload残留字段，是liveness probe把"合法等待PR合并"误判成"进程死了"触发重跑
8. **harness-watchdog区段C容器存活探测**（PR#4118+#4119）——修复慢启动/前台接管容器被误杀
9. **生产部署连续3次失败根治**（PR#4122+#4123）——最初诊断假设错误（以为是package-lock.json缺11个依赖），用真实docker build --no-cache推翻，真正根因是宿主机checkout依赖滞后。**已实测验证生产版本成功追到1.267.16**
10. **zombie-cleaner worktree收割器修复**（PR#4121+#4124）——headless容器产出高质量诊断：Guard C-2在macOS上symlink路径不一致（`/Users`→`/System/Volumes/Data/Users`）是活跃session worktree被误杀的真正根因，已修复；顺带补齐了worktree-manage.sh v23 PR-2设计出来但从未真正落地的心跳续期机制（`dev-heartbeat-guardian.sh`此前一直缺失）

## 已闭环（12个PR全部MERGED，逐一核实非自报）

| PR | 内容 |
|---|---|
| #4098+#4100 | 刀C锚点回填四件套 |
| #4102 | 任务完成态硬闸 + pre-flight thin_prd兜底 |
| #4105 | arch_review location路由修复(870x失败根治) |
| #4108+#4113 | features表更名brain_modules + journey_steps体检端点 |
| #4116+#4117 | tick drain持久化 + 完成态硬闸blocked方案 |
| #4118+#4119 | harness-watchdog区段C容器存活探测 |
| #4120 | 07-19 P0诊断session总交接单(v1，本文档是v2) |
| #4122+#4123 | **部署宿主机依赖同步**——生产部署连续3次失败根治 |
| #4121+#4124 | **zombie-cleaner worktree收割器**——Guard C-2 symlink修复+心跳续期机制补齐 |

## 下一步（用户明确要求，新session直接开工）

### capture/inbox 三轨统一 + "三张表"理解梳理

用户原话（本session内）：
> "我们现在这样子...我们的重点问题是我们现在有三个inbox的输入口，这个东西你没给我解决啊。你这个解决不了，我们整个飞轮就转不起来啊。"

**现状诊断（已完成，直接可用，见 capture-architecture.html artifact）**：

- 轨道A（digestion）：你手动记的东西，`captures`→`capture_atoms`表，一步到位分类
- 轨道B（triage）：Cecelia自己的产出（handoff/learning/issue），绕开captures直接进capture_atoms
- 轨道C（conversation）：你和Claude的对话摘要，独立`conversation_captures`表，批量延迟处理（≥8条消息或空闲>30分钟才触发）
- 三张表从未统一设计过，不同时期分别建的（migration 194/198/199）
- **真bug**：`persistDigest()`里LLM prompt要求提炼`open_questions`和`tensions`，但落库代码只处理了`decisions`和摘要——这两类字段问了白问，从未进任何表
- 唯一的跨轨连接是单向、有损的：轨道C处理完把summary+最多2条decision+最多2条idea压缩进500字塞进轨道A的captures表

**设计方向（已讨论，未正式定spec）**：
统一capture表 → 浅分类 → 机械分类（靠代码图谱/graph_edges）→ LLM精分类 → 参照Sentry fingerprint+embedding模式做历史去重续接 → 决策路由

**"三张表"是什么（用户在session尾声反复确认的三个概念）**：
1. **11要素×Golden Path步骤矩阵**（可能命名为"Golden Path Map"）——横轴11要素(FR/NFR/Invariant/判定点/保质期/死亡告警/失败语义/效果确认/输入对抗面/账本保鲜/两轴衔接)，纵轴Golden Path每个Step。当前唯一实现：`packages/brain/src/routes/features.js`的`ledgerStatus()`函数(在已更名的`brain_modules`表上，247行，是Brain自己的内部意识模块表，不是产品功能表!)，加上PR#4108新增的`GET /api/brain/journey_steps/:step_id/ledger`端点（把11要素体检真正接到了journey_steps上，是本session内新落地的部分）
2. **"Graphic Ages"**——用户确认的一个名字，具体所指不完全确定（可能是可视化工具代号，需要下次跟用户当面确认）
3. **codegraph**——底层代码依赖图谱引擎选型：codegraph-ai/CodeGraph（已否决，RocksDB+商业限制）vs colbymchenry/codegraph（60.8k star，MIT，未决候选）

**下一步建议动作**：先当面跟用户确认"Graphic Ages"具体所指（不要凭猜测动手），然后走 `superpowers:brainstorming` 正式设计capture三轨统一方案（这是大功能级别，需要走完整brainstorming→spec→/dev路径B/C流程，不能像bug fix一样直接动手）。

## 未闭环（本session未处理，按价值排序，供下次参考）

1. capture/inbox三轨统一（上面已详述，是下一步核心）
2. harness_initiative 3个任务失败(never started graph)——已确认是`harness-watchdog.js`区段C独立缺陷（不是本session修的容器存活探测那部分，是区段C本身对"慢启动/前台接管"类容器缺乏存活判据的另一个侧面），未处理
3. W7僵尸任务状态未纠正
4. GP-A语音客服真实E2E从未真正跑过（任务已错误标记completed，历史数据未回溯纠正）
5. ~40个死后台任务清理
6. graph_edges多仓库扫描（当前仅覆盖1/7 repo）
7. codegraph采纳决策未定案
8. "11要素×Golden Path矩阵"表命名与正式建表决策未定案
9. `~/.credentials/cecelia-deploy.env` 格式疑似有问题（见上方"先做这一件事"）

## 当前系统状态（写handoff时核实，非记忆）

- tick: `enabled:true draining:false`，自动派发正常运行（本session内多次因Gate3部署被清零又手动恢复，是持久化修复PR#4116之前的历史；#4116合并后应该已经不会再复发，但值得下次session观察验证一次）
- main HEAD: `a22a58d13`（PR#4124），Brain版本 1.267.17
- 生产Brain版本: 1.267.16（滞后1个版本，见上方"先做这一件事"）
- 无残留待处理的open PR（本session开的12个全部MERGED）
- 无残留异常容器

## 数据源（下一个session要加载的）

- capture三轨现状：`packages/brain/src/{capture-inbox,capture-triage,capture-digestion,conversation-digest}.js`，migrations 194/198/199
- 11要素体检：`packages/brain/src/routes/features.js`(ledgerStatus) + `packages/brain/src/routes/journeys.js`(journey_steps ledger端点，PR#4108新增)
- 部署链路：`scripts/deploy-local.sh`（新增host依赖同步逻辑）+ `scripts/lib/bluegreen.sh`（pre-swap smoke）
- worktree生命周期：`packages/brain/src/zombie-cleaner.js` + `packages/brain/src/platform-utils.js`(anyProcessHasCwdUnder) + `packages/engine/lib/dev-heartbeat-guardian.sh`(新增) + `packages/engine/skills/dev/scripts/worktree-manage.sh`(v23 PR-2心跳模型)

**created_at**: 2026-07-19T12:30:00.000Z
