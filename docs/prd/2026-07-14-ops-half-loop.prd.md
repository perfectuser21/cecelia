# PRD：补齐 Ops 半环——让"我以为的"永远等于"现实的"

> 日期：2026-07-14（最终版，含刀 0/1/1b/2 收官后状态刷新）
> 发起：Alex（本 PRD 由 2026-07-14 管家会话共识整理）
> 层级：Project（下分 6 把刀，每把刀 = 1 个 Initiative，内部再拆 /dev 任务）
> 关联决策：dc18d43d「无闸不成文」（本 PRD 是该铁律从"交付时"延长到"终身"的落地）
> 状态：刀 0 ✅ (#3867) / 刀 1 ✅ (#3870) / 刀 1b ✅ (skills#145+#3874) / 刀 2 ✅ (skills#145) / 面板 ✅ (#3876+#3879) / 刀 3 ✅ (Initiative 08c27793 六任务) / 刀 4 ✅ (Initiative 6bc7760d：#3914/#3915/#3917)；仅剩刀 5（另立 PRD 走 /architect）

---

## 一、背景（为什么干这件事）

最近 40 个 PR 中约 38 个是在修 harness/Brain 机器本身的 bug，形成打地鼠循环。
2026-07-14 会话逐案验尸后确认根因不是某个模块坏了，而是**结构性缺口**：

**功能的一生 = 合同 → DoD → 交付 → 从此裸奔。**

具体断点（全部已用代码/配置/事故取证）：

1. **测试不自动入册**：07-10 CI 大扫除把 `sprints/**` 从 vitest include 移除，
   留下"手动毕业进 src/"的规矩但无人/无流程执行。此后新 sprint 的测试全部孤儿化
   （截至 07-14：8 个测试文件 + 3 个 e2e-verify.sh 被晾）。
2. **TDD 只产出零件层测试**：generator 写的测试全 mock 掉 DB 和相邻模块，
   接缝层（integration）覆盖率≈0。近期事故（#3830 recovery 钩子剪断、#3848 sprint_dir
   跨节点丢、#3808 状态振荡、#3840 PR 池不幂等）全部长在接缝/状态层，单测结构性抓不到。
3. **Golden path 只验收一次**：evaluator = 模拟 QA 人员，真环境验一次签字走人。
   E2E 脚本归档进 sprints/ 后重跑次数为零。旧路被后续 PR 剪断时无人知晓。
4. **运行时零守卫制度**：现有守卫（facts-check / launchd-patrol / ci-patrol 棘轮 /
   selfcheck）全是"一次生产事故换一只"的散兵，无"功能出生自带守卫"的制度。
   实证："系统健康"注入横幅停更于 2026-05-22（两个月僵尸面板）；Wave2 审计
   ~25 个定时循环全死无人察觉；deploy 报 success 实跑旧代码；strategist 零落库数日。

**"我以为"断链的七环**（任何一环断裂都会造成"以为好了实际死了"）：
写了≠入册了 / 入册了≠在跑 / 在跑≠跑的是新的 / 跑了≠写对了 /
写对了≠有人消费 / 没告警≠健康 / 面板上的≠现实的。

---

## 二、目标链路（应然全图）

```
① PrepPRD（人话）
② Contract：golden path = 可执行断言                       ✅ 已有
③ Generator TDD：unit + integration(禁mock被改的边) + smoke  ⚠️ 只有 unit
④ CI 变更闸：本单新测试 + 历史全部测试全量绿                  ⚠️ 池子漏水
⑤ Evaluator：模拟 QA 真环境验收                             ✅ 已有
⑥ Merge
⑦ 自动入册：三层测试自动毕业进永久回归池                      ❌ 07-10 断
⑧ CD 部署闸：蓝绿 swap 前跑 smoke 池，挂了不切               ⚠️ 半接
⑨ 运行时守卫：FR 活性探针 + dead man's switch                ❌ 无制度
⑩ 巡检对账：定期数实物 vs 声称（七环逐环对账）                ⚠️ 局部散兵
⑪ 反馈闭环：守卫红 → 自动立案/Bark → 修 → 回①               ⚠️ 半通
```

①-⑦ = Dev 半环（CI），⑧-⑪ = Ops 半环（CD + SRE）。
**本 PRD 的范围 = 修 ⑦、补 ③、建 ⑧⑨⑩ 的制度和面板。**

---

## 三、范围：六把刀（按依赖排序；刀 0-3 本节，刀 4/5 见三.5）

### 刀 0：先能看见——测试金字塔守卫 + 状态面板 ✅ 已交付（#3867 守卫 + #3876/#3879 面板）

不先看见就没法施工验收。机械守卫，不依赖任何人的声称。

**交付物**
- `scripts/test-pyramid-guard.mjs`：机械断言
  - 断言1：不存在"已 merge 但测试未入册"的 sprint 孤儿（有 → 列文件名 → 红）
  - 断言2：smoke 池每条脚本都挂在至少一条跑道上（preview 闸/nightly/部署闸）
  - 断言3：永久测试数棘轮只增不减（显式声明退役除外）
- 跑在三处：每 PR CI（拦截）+ 每日巡检（兜底）+ 手动对账
- 面板：金字塔各层数量/最后运行时间/孤儿数，进 Dashboard 一页 +
  写回 `CURRENT_STATE.md`（顺手治好 05-22 僵尸面板）

**用户能看到什么**：打开面板，一眼看到 L1/L2/L3 各有多少条、昨晚跑没跑、
有没有孤儿。守卫红 = CI 拦 + Bark。

### 刀 1：修枢纽——⑦ 测试自动入册（毕业自动化）✅ 已交付（#3870 + 刀 1b skills#145/#3874）

**交付物**
- 毕业步在 merge **前**机械执行（时序勘误：不是"report/merge 后"）——
  harness 路径 = controller 2.7.0 Step6（judge PASS 后、merge 前）跑
  `graduate-sprint-tests.mjs --update-refs`：本 sprint `tests/*.test.*` →
  永久测试目录 `tests/regression/`；`e2e-verify.sh` → `scripts/smoke/` 池。
  只搬 judge PASS 过的单子（天然过滤脚手架垃圾）。
- 补搬 07-10 以来欠账 ✅：42 孤儿全清偿（毕业 9 / 删重 1 / 归档 33），
  orphans 棘轮锁死 0。
- 有头 /dev 路径同规则 ✅（engine-ship 16.4.0 §1.5 同款毕业步）。

**用户能看到什么**：任何一单 merge 后，刀 0 面板上的对应层计数 +1，孤儿数恒为 0。

### 刀 2：补腰——③ TDD 接缝纪律（integration 层出生机制）✅ 已交付（skills#145：proposer 9.12.0 / generator 7.10.0 / evaluator 1.24.0）

**交付物**（zenithjoy-skills repo，走 skill-creator）
- proposer/contract 模板加规则：凡改调度/状态机/跨模块传递/生命周期钩子，
  合同 failing test 必须**不 mock 被改的那条边**（真 Postgres、真相邻模块）。
- generator 加禁 mock 清单段；evaluator 加对应核查项。
- CI 确认 brain-integration job 可起真 PG 跑这类测试。

**用户能看到什么**：刀 0 面板 L2（integration）计数随新任务持续上涨，
不再恒为个位数。

### 刀 3：建 Ops 半环——⑧⑨⑩ 守卫制度 + 七环对账

**交付物**
- ⑧ 部署闸：brain-deploy 蓝绿 swap 前跑 smoke 池核心子集，挂了保留 blue 不切。
  **dashboard 链同等补闸**：brain 链已有 assert-deploy-effect，dashboard 链
  （promote-dashboard + HK 同步）目前零闸——补部署后指纹校验（build hash /
  版本号对比），部署报 success 但实跑旧代码 = 红。
- ⑧b 部署链四伤口根治（07-14 实录，止血已做，本刀内根治）：
  1. cecelia-deploy-main 的 `npm install || true` 静默吞失败 → 改 loud-fail（deploy-local.sh:191）
  2. brain 容器 /tmp=100MB tmpfs 被 npm cache 塞满 → cache 挪盘或 janitor 接管清理
  3. promote-dashboard.sh 只管本机 5211 不同步 HK → 补 HK rsync 步
  4. cecelia-frontend 服务主仓 dist 而非 deploy-main dist（运行时漂移）→ 统一服务根
- ⑨ FR 守卫槽位制度：
  - 合同模板加必填段「运行时守卫」：回答"它死了，谁、多久内会发现"，
    要么给出具体探针，要么显式豁免+理由；答不上 = 合同不完整（无闸不成文终身版）。
  - `journey_features` 加 `guard_ref` 列；live FR 无守卫数 = 面板一级指标，只许降。
  - dead man's switch：告警通道每天必须报一声平安，静默即视为告警系统已死。
- ⑩ 巡检对账扩容：ci-patrol/日巡检逐环核对七环
  （测试入册？循环在跑？部署是新的？账本写对？有人消费？告警活着？面板是新的？）。
- smoke 池接 nightly：每晚对 staging 全量跑历史 E2E，红了晨报 Bark。

**用户能看到什么**：面板新增"裸奔 FR 数""七环对账结果"；每天早上收到
一条平安/异常汇总；任何功能死亡从"生产撞见"变为"分钟-小时级探针发现"。

---

## 三.5、目标态：五级成熟度阶梯与 AI-Native 终点

```
L0 裸奔      手动部署，事故告诉你挂了               ← 3 个月前
L1 自动化    CI/CD 自动部署，有基本面板              ← 现在（Dev 强 Ops 弱）
L2 可观测    每个功能有探针+告警+runbook，
             系统分钟级知道、人小时级知道            ← 刀 0-3 落完到这
L2.5 守卫可信 心跳+棘轮+演习，守卫本身 proven-to-fire ← 刀 4
L3/L4 自愈与 AI-Native：探针红 → Brain 分诊 →
             AI 诊断 → 派 harness 修 → 验尸自动产新守卫 ← 刀 5
```

**L2 及格判据**：任何功能死掉，系统分钟级发现、Alex 小时级收到、修复有 runbook。

**"确保守卫活着"三机制**（刀 4 的内容）：
- **心跳（dead man's switch）**：每个守卫定期报平安，静默即最高告警。
  **静默检测器必须在生产机之外**——手机 Bark 只能收推送、不能检测"没收到"，
  生产机自查静默 = 整机死时守卫陪葬。落法：地盘 A（GitHub scheduled workflow）
  机外反向探测生产 /health + 心跳记录，断了自动开 Issue + Bark 推送。
  不补这笔 dead man's switch 是假的。
- **棘轮（ratchet）**：关键健康数只许单向走（永久测试数只增、裸奔 FR 数只降、
  巡检硬伤只降），倒退 = CI 红。ci-patrol 已有先例。
- **演习（chaos drill / proven-to-fire 定期化）**：每月在 staging 故意弄死一个
  东西，守卫 X 分钟内没叫 = 守卫本身记 P1。从没红过的守卫视为未验证。

**AI-Native 回路**（刀 5，本 PRD 只立方向不展开，届时另开 PRD）：

```
探针红/心跳断 → ①感知(Brain tick,已有) → ②分诊(警觉阶梯,已有)
→ ③诊断(AI巡检员+cecelia-harness-debug 七层filter,已有)
→ ④修复: 见过的病→自愈动作(reaper/回滚,有雏形)
         没见过的病→自动开 harness 任务让 Dev 机器修(缺:唯一断线)
→ ⑤沉淀: 验尸自动写 learnings + 自动产出新守卫(缺制度)
→ ⑥升级: 仅政策级 Bark Alex 拍板(通道已有)
```

**刀 5 护栏（不可豁免）**：探针红→自动开单必须带频控与日预算上限（同一探针
24h 内只开一单、全系统日开单数封顶），且自动生成的修复走完整 GAN+judge 闸，
不因"机器自己开的单"豁免任何闸——否则与「无闸不成文」（dc18d43d）自相矛盾。

关键洞察：AI-Native Ops 的"手术室"就是已建成的 harness——传统公司到不了 L4
是因为 Ops 发现问题后没有自动写代码的机器可调用；本系统两端都有，缺的只是
把 Ops 输出端接到 Dev 输入端这一根线。另一个 AI-Native 独有武器：AI 巡检员
可抓语义级异常（决策 db1b393b），机械探针只能抓数字越线。

## 三.6、守卫拓扑（每个守卫住哪）

```
地盘 A GitHub 云(Actions,事件驱动+scheduled,不与生产同生共死)：
   test-pyramid-guard PR 档、facts-check、DevGate、
   心跳静默检测器(scheduled workflow 机外反向探测生产,刀 4)
地盘 B 美国 Mac mini(生产,24/7)：
   test-pyramid-guard 每日档、面板(5211)、smoke nightly(打staging 5222)、
   部署闸(brain-deploy内)、FR 活性探针(Brain tick)、心跳发射端
地盘 C 研发过程(engine hooks)：Stop Hook、write-guard（现状保留）
地盘 D Alex 手机(Bark)：告警推送接收端（只收推送；静默检测在地盘 A，
   手机检测不了"没收到"）
```

选址规则：CI 守卫守"改动"，运行时守卫守"活着"，心跳静默检测器必须在生产机之外。
不需要任何新机器。

## 四、非目标（本期不做）

- 不重构 harness 编排本身（relay/controller 不动，它们刚修稳）
- 不动 evaluator 的验收职责（它干得不错，只是不能当唯一防线）
- 不追求一步到位给所有存量 FR 配探针——制度先管新增，存量按面板裸奔榜分批还债
- 不做 SLO/错误预算等重型 SRE 实践（等守卫制度跑顺再说）

## 五、成功标准（用户语言）

1. 我打开面板，能看到测试金字塔三层的真实数量和最后运行时间，且这个面板
   本身有守卫保证不是僵尸。
2. 任何一单 merge 后，它的测试**自动**留在每次必跑的池子里，不需要任何人记得任何事。
3. 有人再干"07-10 摘 include"这种事时，CI 当场红，合并被拦。
4. 任何 live 功能死掉，我在分钟-小时级收到通知，而不是撞见生产事故。
5. 连续 30 天观察：「修机器」类 fix PR 占比从当前 ~95% 显著下降。
   **数据源与判据**：机械启发式 = PR title 含 fix/修 且改动路径落在
   packages/brain|packages/engine|.github/workflows 视为「修机器」，
   由 ci-patrol 周报统计口径落地；启发式落地前本条降级为观察指标，
   不作为验收硬闸。

## 六、排期建议（"什么时候干后半截"的回答）

| 刀 | 何时 | 方式 | 状态 |
|---|---|---|---|
| 刀 0 守卫+面板 | 07-14 | 有头 /dev | ✅ #3867 + #3876/#3879 |
| 刀 1 自动入册（含 1b 自动毕业步） | 07-14 | 有头 /dev + skills PR | ✅ #3870 + skills#145/#3874 |
| 刀 2 TDD 纪律 | 07-14 | skills repo PR（skill-creator 流程） | ✅ skills#145 |
| 刀 3 Ops 制度 | **当前工作面**（错峰条件已满足：刀B+C 收账权已上生产 brain 1.260.0） | /decomp 拆成 4-6 个 /dev 任务 | ~1 周 |
| 刀 4 守卫可信（心跳/棘轮/演习） | 刀 3 落地后 | /dev 2-3 个任务 | ~2-3 天 |
| 刀 5 AI-Native 闭环（探针红→harness 派单+验尸产守卫） | 刀 4 后另立 PRD | /architect → /decomp | 另计 |

与在飞工作的关系：刀 0/1 不碰 harness 编排代码，与队列中「刀B+C 收账权收归」
无冲突可先行；刀 3 的巡检扩容部分依赖收账权落地后的账本口径，排在其后。

## 七、开放问题（Contract 阶段需拍板）

1. ~~永久测试目录选址~~ ✅ 已拍板：`tests/regression/`（decision 在库 07-14），
   brain vitest include 已接。
2. smoke 池在 preview 闸跑"核心子集"的时长预算（建议 ≤10min）？
3. FR 守卫豁免的审批口径：谁可以写"豁免"，记录在哪（decisions 表？）
4. 演习（chaos drill）权限边界：只许打 staging（5222）？生产演习是否永久禁止？
5. `guard_ref` 形态：脚本路径 / 探针端点 URL / 豁免 decision id——三种取值如何编码？
