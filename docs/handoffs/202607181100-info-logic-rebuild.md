# Handoff：底层信息逻辑重构——地图从"手填"改成"代码自动流出"

> 2026-07-18｜主理人全程拍板的方向纠偏｜verdict: 设计方向已定, 待下个 session 执行
> 这不是一个 bug 修复, 是一次**地基级纠偏**。读之前先读 [[gp-doctrine-20260717]] 和 [[mj5-knife1-ledger-shipped]]。

## 一句话核心（主理人原话）

**"前面（大模型读 inbox/分类/归位）逻辑没问题, 后面（写 PR/CI/合并）逻辑没问题, 但底层的信息逻辑不对——要重做。"**

```
现在（错）：人 / mapper skill 手填地图 → 地图和代码是两套账 → 必然漂移 → nightly 对账勉强追
改成（对）：代码自动映射出关系 → 关系自动翻译成图 → 图永远和代码一致（不是同步出来的, 是流出来的）
```

## 想通这个的推理链（防下个 session 觉得"为什么突然要改"）

1. 问"业界怎么算改动波及范围", 查到: Facebook 用 Buck2、Google 用 Bazel、JS 圈用 Nx——**都在做"算改动波及哪些代码、只跑受影响的测试"**。这条路是大厂验证过的高速公路。
2. 但这些工具**只算"代码半径"**（改文件A→牵动哪些文件/包）, **不算"业务半径"**（→哪条业务承诺红）。业务半径没人做, 因为没人有承诺地图。
3. **关键区别（主理人逼问出来的）**：
   - Facebook 的图 = 代码的**影子**（从 import 自动读, 代码变影子当场变, 永不撒谎）。
   - 我们的图 = 代码旁边**另画的一张画**（mapper 手填进 DB, 代码变了画不会自己改 → 漂移）。
   - **这两天所有"账本和现实对不上"（migration 编号/版本号/地图撒谎）的病根, 全是"爱在代码旁边另立一张要手动同步的账"。**
4. **主理人的纠偏（本 handoff 的灵魂）**：
   ```
   ① 代码（唯一真相）
        ↓ 自动映射（读 import/依赖, 不用人填, 给 AI/机器看）
   ② 关系（机器算的, 永远和代码一致）
        ↓ 翻译
   ③ 图（人看的, 承诺/FR/NFR/Golden Path）
   ```
   **图不是拿 skill 去填, 是代码映射出关系、关系自动生成图。** 边界检查（跨线/跨repo）白送——因为②关系从代码自动读, 不用查会过时的地图。
5. **唯一焊不进代码的**："客户回复要**得体**""像人"这种纯人类判断, 代码里没有 import 能表达。**这一成留人工标注, 其余九成从代码自动流出来。**

## 落地方案（主理人拍板：验证 + 接地图, 两步）

### 工具选型（已查证, 全免费开源）
- **dependency-cruiser** ⭐ 主力——读 JS/TS 依赖 + **能写规则强制边界**（"获客不许 import 客服"→CI 当场拦）。是"轻量版 Buck2"。cecelia 是 JS/Node, 直接吃。
- Madge——偏画图, 规则强制弱, 备选。
- **Nx——现在别上**（太重, 要按它规矩改 repo 结构）。将来大了再换, **来得及**——前提是**从现在起代码按清晰的块长**（AI 写也让它按块写）。真正"来不及"的是现在不立规矩任 AI 乱写, 那到时理乱账才是噩梦。
- 参考: dependency-cruiser (github.com/sverweij/dependency-cruiser) / Nx affected (nx.dev/docs/features/ci-features/affected) / Buck2 (engineering.fb.com/2023/04/06)

### 第1步：验证自动映射（几乎零改代码, 零风险）
1. 装 dependency-cruiser（一个 npm devDependency, 不碰业务代码）
2. 跑一条命令读 `packages/brain` 的依赖, 出图 + JSON
3. **和主理人一起看**: 读得准不准? 我们的代码结构它认不认?
4. 好使 → 第2步; 不好使 → 说明代码结构得先理块, 停下来报告

### 第2步：把自动关系接到承诺地图
- dependency-cruiser 出的 JSON（②关系, 机器可读、自动、永远和代码一致）= 喂进地图的原料
- 地图 = 九成从这份 JSON 自动翻译（谁连谁、跨几条线、影响谁）+ 一成人工标注（纯承诺: 得体/像人）
- **淘汰"mapper skill 手填地图"**——那是漂移的病根。mapper 的角色从"填图"变成"只标注代码读不出的那一成承诺"

### dependency-cruiser 顺带解决的（重要副产品）
- **边界检查白送**: "CRM 表被哪几条线用"不再查会过时的地图, 直接读代码依赖, 一秒算跨几条线。之前担心的"地图没登记就漏检"没了。
- **给 AI 立规矩防乱写**: 边界规则写死进 CI, AI 越写越多也被约束成清晰的块, 而非越长越乱。**这才是 dependency-cruiser 现在的真正价值——不是画图给人看, 是约束 AI。**

## executor PR #4073 的处置（主理人拍板：写进本单一起收）

**背景**: 三轴分配器（选择系刀2, 任务 600295fe）想做"按余额挑执行体(Claude/Codex/Grok)"。我一开始**大改了 executor.js**（9段路由收权进 resolve-execution.js）, 结果碰倒一圈"源码字符串守卫"（单测3个 + smoke脚本3个, 全是 readFileSync('executor.js')+正则断言"源码含某行字"）, 打地鼠打了几小时。

**主理人的更优解（已验证可行, 未动手）**: **完全不碰 executor.js**——
- 递活给 executor 只有一个点: `dispatcher.js:765 triggerCeceliaRun(taskToDispatch)`。
- executor.js **本来就有"听指挥"入口**（main版 3199-3225行, 读 `payload.executor`/`payload.machine`, 有就照办; 还有现成的 `src/routing/resolve-executor.js` 翻译成具体路由）。
- **所以"引导员"加在 765 行前**: 查三家余额 → 给 task 贴 `payload.executor`/`payload.machine` → executor.js 用现成代码认条子。**executor.js 零改动, 6个守卫一个不炸。**
- 小坎: 现成入口认 Codex/Claude 干净, **Grok 还不认**（会被当claude）。第一版先在 Claude/Codex 间按余额挑（覆盖绝大多数）, Grok 留下一小步。

**下个 session 对 #4073 的动作（二选一, 主理人倾向撤回）**:
1. **撤回 executor.js + resolve-execution.js 的改动**（git 层面 revert 那几个 commit 的代码改动, 保留 spec/plan 文档）→ 6守卫全绿、CI 通过或干净关闭。
2. 三轴分配器用"引导员加在 dispatcher:765 前"的干净方式**重开一刀**, 零碰 executor.js。

**当前 #4073 状态**: HEAD 6ef89109。brain-unit 已绿（补提交守卫修复后）。剩 real-env-smoke + Smoke Glob Runner 红——根因已查明: 3个smoke脚本（golden-path-proposal-smoke.sh / routing-phase2-smoke.sh / staging-e2e-smoke.sh）也是 executor.js 源码守卫, 被 refactor 搬走字面量后失败。**如果走撤回方案, 这3个smoke自动恢复绿, 不用改。**

## 立案（进排序官队列, 不在本次做）

1. **源码字符串守卫是脆设计**（P2）: `readFileSync+toContain` 型测试测"代码长啥样"不测"代码干啥", 任何重构误伤。本次一次撞6个。该逐步换成行为断言。这也是"信息逻辑重构"的一部分——守卫也该从"查源码"改成"查行为/查自动关系"。
2. **观测污染**（已知）: `grep`别名成`ug`(ugrep)+`--color`注入ANSI乱码。**没有第二层语义改写层**（对照实验证实纯文本原样返回）。绕法死规矩: **禁用裸`grep`, 用`\grep`/node读文件/关键结果`| base64`; 每条Bash命令带`cd`绝对路径（cwd每次重置）**。本次因此丢过一个commit没察觉。
3. **inbox 分层过滤**（设计方向, 主理人提）: 硬代码分拣→小模型预分类→大模型细做。贵脑子（旗舰）只碰第3层已去重分组的干净输入, 别拿旗舰读20条乱炖。

## 下个 session 的第一步

1. 先按主理人拍板处置 #4073（撤回 executor 大改, 让CI干净）
2. 再开新线: 装 dependency-cruiser, 跑一次读 packages/brain 依赖, 和主理人一起看准不准（第1步验证）
3. 验证好 → 设计"关系JSON→地图"的接法（第2步）

## 数据源 / 锚点
- 本 handoff
- [[gp-doctrine-20260717]]（承诺地图方法论）、[[mj5-knife1-ledger-shipped]]（地图刀1-4落地）
- executor 收权: docs/superpowers/specs/2026-07-18-tri-axis-allocator-design.md（被对抗审查REJECT, 现在方向变了, 参考即可）
- 判官档位决策 51b9b095 / 产能配比 cec579d2 / 工厂域裁决 2d28de45
- dispatcher 注入点: packages/brain/src/dispatcher.js:765
- executor 听指挥入口: packages/brain/src/executor.js（main版 3199-3225）+ src/routing/resolve-executor.js
