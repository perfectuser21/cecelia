# Handoff：对话型任务回填 tasks 账（方向 B 补账最后一块）

**verdict: 立项交接（未开工）**——主理人 2026-09-16 提出，机制现状已核实，方案已定，待执行。

## 一、现状核实（今日实查，非推断）

**飞书 → 执行的真实路径**（主理人确认这就是他要的形状）：
```
飞书群消息 → us-vps 网关（只接线+查 bindings 路由表，零推理）
           → ssh 管子 → MMV 启动会话壳（读消息/思考/决定）
           → 轻活会话自干 / 重活再下放 / 手机活调西安 node
           → 回复经 us-vps 网关发回群
```
- 通道现状：飞书✅启用、钉钉✅启用、iMessage❌禁用、**微信未接**（配置里 wechat/微信 0 次命中）
- 「秋米」在 agent 名单与配置中不存在（如需新建属另一事项）
- 零执行已彻底：defaults + 6 个 agent 级 sol 覆盖全部拉回跑场池，守卫逐 agent 巡查防回潮（PR #5357）

## 二、缺口（本交接单的正题）

**各种人（飞书群里的主理人/同事）给 agent 布置的任务，不进 Cecelia tasks 账**。

进账的只有两类：① Notion 排单（人先写 Notion）② workflow run（画布派发）。
**对话触发的活全部不留账**——群里说一句话，agent 干完就完了，tasks 表没这一行，Notion 看不到，日报统计不到。

同族缺口（方向 B「机器自主动作必须留账」）还剩：
- 对话型任务（本单正题）
- 触达 tick 的每轮 run
- 判定 agent / 每日轮 cron 的每次执行

## 三、方案（建议实现路径）

**不要让 agent 自己写账**（它会忘、会写错格式）。走「事后归集」而非「事前登记」：

1. **数据源**：OpenClaw 会话库 `/opt/openclaw/state/openclaw.sqlite`（每轮对话有 session/turn 记录）
2. **归集腿**：Brain 加 job（或挂 openclaw-guards 第六腿）每日扫当天会话，按「是否产生实际动作」筛出任务型对话（发消息/改数据/派活 ≠ 闲聊）
3. **入账**：createRoutedTask（source='inbox' 或新增 'conversation'，mutation_intent 按动作定），metadata 带 session_id/agent/channel/群 id，status 直接 completed（事后账）
4. **投影**：既有 pushTasks 自动把它推到 Notion Tasks 库 → 主理人在同一张表看全「人排的 + 机器自己干的」
5. **口径**：跟决策 2dbabb48 一致——人的意图 Notion 先行；机器自主动作事后必须留账

**先做最小版**：只归集「产生了外部动作」的对话（发消息/写库/派活），闲聊不入账，避免账本噪音。

## 四、顺带发现（今日实查，另计）

- **MMV 会话壳不会自动退出**（纠正我此前说法）：codex app-server 进程最老已活 5h40m，49 个进程共 743MB。**每个仅 9-12MB，当前不构成负担**，但无回收机制，长期会堆积 → 建议给跑场机加同款「挂死单杀」（>12h 无活动即回收）
- MMV 16GB，当前 free 13%：claude 会话 1293MB/21 进程 + node 947MB/56 + codex 743MB/49；能撑但需观察，Mac Studio 到货后缓解
- **触达线仍空转**：飞书话术表 A1/A2/B「启用状态」全为停用（09-15 12:02 起），守卫每轮告警中，待主理人在飞书启用

## 五、数据源
- OpenClaw 会话库：`/opt/openclaw/state/openclaw.sqlite`（宿主可读，Brain 容器已挂载 /opt/openclaw/state）
- 路由表：clawdbot.json `bindings`（channel/accountId/peer → agentId）
- 决策：2dbabb48（真相源分层+一切执行进账）、95477a66（零执行物理化）
- 入账口：packages/brain/src/work-routing-store.js createRoutedTask；投影 notion-push-sync.js pushTasks

## 六、下一步
1. 本单正题：对话型任务归集腿（最小版）
2. 触达 tick / 判定 cron 的 run 入账（同族）
3. 跑场机会话回收守卫（>12h 单杀）
