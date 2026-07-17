# PRD：承诺地图体系 v1.0 落地首刀——MJ5 贯穿（thin）

> 状态：待新 session 认领执行｜优先级 P0｜家④工厂 · MJ5 承诺地图闭环 · 动作=贯穿
> 方法论 SSOT：总纲 https://claude.ai/code/artifact/cc5a970a-7671-4095-9bb2-66ab72e2dc74 ＋ memory `gp-doctrine-20260717`
> 配套图：V4骨干规格 artifact/c9754f42… ｜ 全景四个家 artifact/4e744c89… ｜ GP-B总表 artifact/93a47469…
> 铁律引用：写在文档=祈祷，站在必经之路带闸才算数（07-17 review纸门审计）；账本写入必须是流水线自动副作用。

## 一、背景与目标

方法论（承诺地图体系 v1.0：1图·4档·7动作·2例外·2铁律）已定型，工具链已上主干（gear 三档 #4027、mapper 三件套 skills#151/#152、dispatch-worker #4017）。**缺的是账本和闸**：地图还画在 artifact 页面上，机器看不见；任务点火不要求锚点；改底座不强制引用重跑。

目标 = MJ5 四步承诺全部 thin 兑现：**账本与现实一致，无锚点的任务点不着火。**

## 二、MJ5 骨干（冻结，四句承诺）

| 步 | 承诺 | 首刀 thin 兑现方式 |
|----|------|------------------|
| S1 切路入账 | 主理人拍板的地图，当天进 Brain 账本 | schema 补齐 + 两个打样域落库 |
| S2 锚点执法 | 不带"哪路·哪步·哪格"的任务点不着火 | 点火校验（照 invalid_gear 模式） |
| S3 联动执法 | 改底座必带全部引用步骤的断言清单 | evaluator 自动生成联动清单（thin=清单+报告，不强制全跑，见判定点①） |
| S4 保鲜对账 | 账本烂了 24h 内有人知道 | nightly 账实对账（复用 G3 deploy-daily-drill 模式）+ Bark |

**验火（标 done 前必做）**：三道闸各故意违规一次，亲眼看报红/拒点火——没见过报红的守卫不算守卫。

## 三、S1 详设：schema 与打样

### 数据模型（判定点③已给建议：复用扩展，禁建平行表）
现有骨架：`journeys / golden_path / journey_steps / journey_features / journey_step_links`。需补：
1. **journeys**：`home` 枚举（biz/pre/xcut/factory 四个家）、`trigger`（触发器文本）、`endpoint`（可感知终点）
2. **journey_steps**：`promise`（承诺原文，冻结）、`backbone_version`（动骨干时 bump）
3. **journey_features**（件登记卡，一份实体）：`softness`（硬格/软格）、既有 kind/thickness 沿用
4. **journey_step_links**（格子=件×步的锚）：`cell_kind`（能力/要素-11选1/场景-8选1/底座引用）、`cell_status`（gray/red/pending/green）、`assertion_ref`（断言锚点：测试路径或 manual: 命令）、`na_reason`（场景格 N/A 理由）
5. 反向查询 API：`GET /api/brain/features/:id/blast-radius`（塌了哪些承诺红 = 引用本件的全部步骤+承诺）

### 打样域（只做两个，其余用到再切）
- **Line04 智能客服**：按 V4 提案页落 5 条 GP（B/C/D/E/F）+ 家②绑定安装 + 家③七个底座件（含引用关系）+ GP-B 四步的完整格子（照"GP-B一张总表"页逐格入库，含软格标注）
- **首次成功路径**（公司级 GP，journey 已存在）：五步承诺（开通→装好连上→绑资产→第一次价值[按线参数化]→会看dashboard）+ 与家②件的引用关系

### 落库通道
mapper Mode1/Mode2 产物 → 经 db-update skill 规范写入（db-update skill 需同步补这些新字段的写法一节）。**拍板前不写库**纪律不变。

## 四、S2 详设：锚点执法闸

- `tasks.payload.anchor = {journey_id, gp_id, step_id, cell_ref?}` 必填；
- **豁免白名单**（判定点②）：`task_type ∈ {arch_review, ci_patrol, daily备份等系统例行}` 免锚；`payload.action ∈ {spike(探索), hotfix_emergency(止血,24h内必须补锚归位), displacement(置换,锚=底座件id)}` 走各自豁免语义；
- 校验位置：executor 点火处（与 orchestrator/gear 校验同排，reason=`missing_anchor` terminal failed）；
- 有头 /dev 同样受闸：PrepPRD 模板增"锚点"必填节（无锚不进 decision 写库步）。

## 五、S3 详设：联动执法（thin）

- evaluator 验收启动时：读本次 PR 改动文件 → 反查 journey_features（哪些件被改）→ 经 journey_step_links 拉全部引用步骤的 assertion_ref 清单；
- **thin 档**：清单进 evaluator 报告（"本次改动波及 N 个步骤断言，跑了 M 个"），不强制全跑——强制档为 v2（判定点①）；
- 断言可跑的（tests/ 路径、manual: 白名单命令）顺手跑；跑不了的（真机 L3）列为"待 nightly 覆盖"。

## 六、S4 详设：保鲜对账（nightly）

对账断言（每晚，红→Bark）：
1. 昨日 merged 的带锚 PR，其锚点格子状态已被回写（铁律一执法）；
2. 无锚 merged PR 数量 = 0（S2 闸的旁路检测）；
3. 账本引用完整性：底座件的 blast-radius 非空、步骤 promise 非空；
4. 三闸心跳：闸代码路径存在且最近 7 天内有拦截/放行日志（防纸门复发）。

## 七、与存量能力/skill 的联动接线图（本 PRD 的第二使命）

| 存量件 | 新角色 | 需要的改动 | 改动位置 |
|--------|--------|-----------|---------|
| golden-path-mapper（Mode1/2） | 地图唯一写入口 | 落账动作对接新 schema | skill 已写"按 db-update 落账"；db-update 补新表规范 |
| golden-path-controller/proposer/reviewer | 单条路深化（GP-proposal 档） | 提案产物字段对齐新 schema；reviewer 已有承诺纯度维 | SSOT skill 小改 |
| harness-planner | 读地图选下一刀（骨架未通→贯穿；已通→加厚） | 启动时读锚点注入上下文——账上 planned 件"Planner 启动前读 7 张表"在此兑现 | planner SKILL + relay 注入 |
| harness-contract-proposer | 合同=把锚点格子的断言写成测试；场景牌组必填 | 读 anchor 注入 + 场景矩阵节（doctrine 已进 mapper，proposer 侧接） | SSOT skill |
| harness-generator | 不变（gear 三档已支持贯穿/分段/修复） | 无 | — |
| harness-evaluator | S3 联动清单生成方 + 格子状态回写方（铁律一） | 联动清单逻辑 + 回写 cell_status（thickness 回写已有，扩展） | brain + SKILL |
| /dev（PrepPRD） | 有头任务的锚点入口 | PrepPRD 模板加"锚点"必填节 | dev skill |
| /plan | 说到任何事的第一路由 | 识别归位类意图 → 转 mapper Mode2 | plan skill 一行 |
| ci-patrol | 巡检口径升级 | 硬伤定义=地图红灯数（棘轮机制已有，换数据源） | ci-patrol skill |
| arch-review（verify） | initiative 验收时校验账实一致 | verify 清单加"锚点格子已回写" | arch-review skill |
| 主理人指挥舱（在建 P0） | 地图渲染层 | 信息架构=总纲三层（Journey总览/GP对账表/步骤四区）；本刀只保证 API 可读，前端归指挥舱任务 | 对齐即可，不在本刀 |
| db-update | 手工写入 SSOT | 补新表/新字段写法一节 | skill |
| Notion 同步 | 自动副作用照旧 | journeys/steps push 已有，新字段跟车 | notion-push-sync 小改 |
| dispatch-worker / segmented 档 | 不变，间接受益（RPA 贯穿的执行层） | 无 | — |

**接线原则**：每个存量件只加"读锚点/写状态"两类动作，不动其内核；所有写入都是流水线副作用（铁律一），没有任何一处要求人记得更新账本。

## 八、判定点登记表

| # | 判定点 | 候选 | 建议 | 误判后果 |
|---|--------|------|------|---------|
| ① | S3 联动强度 | A清单+报告(thin) / B强制全跑 | **A**，v2 再升 B | A漏跑→nightly兜底；B误伤→每PR成本爆炸 |
| ② | 锚点豁免白名单 | 窄（仅系统例行+三豁免动作） / 宽 | **窄**，宽了闸虚设 | 过窄→摩擦，可白名单迭代 |
| ③ | 格子建模 | 扩展 journey_step_links / 新建 cells 表 | **扩展**（禁平行表铁律） | 新表→双写漂移老病 |
| ④ | 存量在途任务 | 立即强制锚 / 存量豁免+新任务强制 | **后者**（存量豁免有截止日） | 立即强制→在途全堵 |

## 九、不包含

- 全部存量域回填（只打样两域；其余域说到时用 mapper Mode2 增量归位）
- 指挥舱前端实现（另有 P0 在建，本刀只出 API）
- W7 合同剧本化（独立任务 38c0c94e）
- S3 强制全跑档（v2）
- ZenithJoy 仓库侧改动

## 十、执行形态与拆刀建议（给认领的新 session）

核心任务（brain schema+核心逻辑）→ **本机 Claude 有头 /dev 主导**（禁外包铁律），建议 4 个串行 PR：
1. **刀1**：S1 schema migration + API + 两域落库（含 blast-radius 端点）——验收：两域账本 API 可查、与三张图一致
2. **刀2**：S2 锚点闸 + /dev PrepPRD 锚点节 + 豁免白名单——验收：无锚任务点火实测被拒（proven-to-fire ①）
3. **刀3**：S3 evaluator 联动清单 + 格子回写扩展——验收：改一个打样底座件，清单自动含引用步骤（proven-to-fire ②）
4. **刀4**：S4 nightly 对账 + Bark + 三闸心跳——验收：首跑绿 + 故意造一条无锚 merge 记录看它报红（proven-to-fire ③）

每刀 = 一个 harness_initiative（gear=default）或有头 /dev，锚点自举：刀1 落库后，刀2-4 自己必须带锚（MJ5·S2/S3/S4）——体系从第二刀起吃自己的狗粮。

新 session 启动动作：`claim 本 PRD 对应的 Brain 任务 → 读本文件 + memory gp-doctrine-20260717 → 从刀1开工`。

## 十一、验收标准（MJ5 首刀 Final）

- [ ] [BEHAVIOR] 两打样域账本 API 可查且与三张图一致：manual: curl localhost:5221/api/brain/journeys 及 blast-radius 端点断言
- [ ] [BEHAVIOR] 无锚任务点火 → terminal failed reason=missing_anchor（实测）
- [ ] [BEHAVIOR] 改打样底座件 → evaluator 报告含全部引用步骤断言清单（实测）
- [ ] [BEHAVIOR] nightly 对账首跑绿；三闸各一次 proven-to-fire 记录在案
- [ ] 现有 relay/harness 全量回归零影响（存量任务走豁免期不受阻）
- [ ] CI 全绿；账本写入全部为流水线副作用，零手工步骤
