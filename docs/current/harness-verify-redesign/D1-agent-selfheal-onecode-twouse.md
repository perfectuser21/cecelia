# D1：Agent 运行时状态自检 + 自愈（一份代码，两处用）

> 范围声明：本文只做**设计**，不改任何代码，尤其不碰 ZenithJoy autopilot 仓库（line04 agent 目标代码在跨仓库）。
> 目标代码位置：ZenithJoy autopilot repo `services/agent/wechat-rpa/**`（listen_chat / preflight / start.bat / module-manager 等）。
> 配套件：C1 = rog 真机 runner 发版前的自检闸（复用本文这份检测代码）；本文是 C1 的上游依赖。
> 台账来源：skill `wechat-cs-troubleshooting`（活台账，随本设计落地后回写）。

---

## 问题现状

line04 微信客服 agent 跑在**无穷台客户机**（同事的 Windows）上，按"失控程度→守卫重量"原则，这是失控程度最高的一层 → 需要最重的守卫 = **运行时自检 + 上报 + 自愈**。当前反复坏的状态都有明确根因和修法记录，但都是**零散手工修 / 单点修 / rog 热修撑着**，没统一成一份"运行时自检 + 自愈框架"。重启 / OTA / 部署会把 rog 手撑的修复打回原形。

各状态根因（引用台账）：

- **§1.1 UIA 树塌缩（sessions=0 永不回复）**：微信 mmui 无障碍树仅在进程启动时 `SPI_SETSCREENREADER` 标志已置位才构建；外部/autologon 启动的微信标志没设 → 整树塌缩到 `descendants=1`，会话列表完全不暴露，事后任何激活都救不了已运行进程。现有修法：检测"窗口找到但整树塌缩 `descendants≤2` 持续 90s" → 重启微信（标志已置位态下重建完整树），冷却 600s、单进程上限 5 次（PR #950，1.0.71）。

- **§1.2 / §2「状态判定不可靠」送达假阴性**：`_uia_send` 成功后 `_read_session_preview` 只读一次，微信预览异步更新 + 刚切完会话偶发读空 → 一次没命中就判 send_failed → 冷却重发 → 可能给同一人发两遍。现有修法：`_confirm_delivery` 轮询读回（最多 5 轮 × 0.6s），命中即 DELIVERED，全空才失败（PR #951，1.0.72）。登录判定也不可靠（明明登录却 `login=False`；没登录被当"隐私锁屏"）。

- **§1.4 微信自升回 4.1.10 → 树又塌**：`wechat_update_lock` 原先只在装机 preflight 路径调，微信已是 4.1.8 时不触发 → 腾讯静默自升回 4.1.10 → §1.1 复发。现有修法：放进 **listen_chat 主循环每 5 分钟 `run_update_lock(dry_run=False)` 持续压**（常驻比开机一次更稳），`interpret_lock_verify` 诚实判 locked（PR #984，1.0.81）。

- **§2「多微信实例 / agent 自拉没登录的微信」**：agent 会自己 launch 一个微信；同账号两开时读错那个"没登录"的（`login=False sessions=0`）。正确骨架 = 单个登录微信 + agent 先起置无障碍标志、微信后登 → 树完整。

- **§2.B 新装 agent 不杀旧 listener → 假"未安装" + 抢窗口**：① `start.bat` 单实例守卫只杀 `zenithjoy-agent.exe`（core），没杀旧 `listen_chat.py`（python）→ 旧 listener 变孤儿再跑满 24h；② OTA `module-manager.ts` `oldChild.kill()` 杀的是 node fork，它 spawn 的 python listen_chat 是孙进程杀不到 → 两个 listener 同时抢微信 + 都跑 preflight → `preflight_already_running`。现有计划：按命令行匹配杀掉所有 `*listen_chat*` 的 python/python-embedded。

- **§2.A 离屏 `_open_chat` 切不到会话**：微信虚拟列表把没渲染/滚出视野的会话项 rectangle 返回离屏占位坐标（~32000）→ PostMessage 点击打空 → 切不过去；同时 `unread=0` 检测不到。现有计划：离屏坐标 >20000 → 重扫 ListItem 找 sender 新 item 引用 + 把窗口拉回可见前台（跑通版 git 74654efd §5，1.0.72 没带全）。

- **§4.5 病根**：修好的东西记进台账（文档）但没做成机器强制守卫 → 下次改把它改坏没人拦（#998 滚动回归就这么进来的）。**根治顺序：先写 agent 自检自愈（让真机自己变干净可测）→ 再把 rog 接成闸。** 本文即"先"的那一步。

---

## 目标

1. 把「登录 / 送达 / 树塌 / 多实例 / 离屏」五类状态的**检测逻辑**统一成 agent 里**一份代码**（一个自检模块），每台客户机常驻自跑。
2. 检测到异常后按状态类型执行对应**自愈动作**，并把结果**上报**中台（可观测）。
3. **同一份检测代码**被 C1 的 rog runner 在发版前当闸复用（一份两用），保证"发版前跑的自检"和"客户机运行时跑的自检"是同一套判定标准，不会两边漂移。
4. 不引入新回归：自检自身不霸屏、不滚动、不误杀（见「风险与注意」）。

---

## 具体改动（设计）

### 1. 自检 + 自愈框架结构

单一模块（建议 `services/agent/wechat-rpa/selfheal/`，Python，与 listen_chat 同语言同进程可 import），三层：

```
selfheal/
  checks.py     # 纯检测：输入=当前 UIA/进程/会话快照，输出=结构化 CheckResult[]（无副作用）
  actions.py    # 自愈动作：根据 CheckResult 执行对应修复（有副作用，带冷却/上限）
  runtime.py    # 常驻编排：每 tick 采样→checks→决策→actions→上报；客户机运行时入口
  gate.py       # 一次性编排：采样→checks→输出 verdict（PASS/FAIL + 明细）；C1 rog 闸入口
  report.py     # 上报中台 + 写本地 health.json（两个入口共用）
```

**关键分层原则（一份两用的技术基础）**：
- `checks.py` 是**纯检测函数**，只读快照、返回结构化结果、**不做任何自愈副作用**。这是"一份代码"里被两处共享的那一份。
- `runtime.py`（客户机常驻）= checks + **actions（自愈）** + 上报。
- `gate.py`（rog 发版前闸）= checks + **verdict 判定（不自愈，只裁决 PASS/FAIL）** + 明细输出给 CI。
- 两个入口调用**同一个 `checks.py`**；差别只在"检测到问题后干什么"（客户机=自愈，闸=判 FAIL）。

**CheckResult 结构（建议）**：
```
CheckResult(
  check_id,            # 'uia_tree' | 'delivery' | 'login' | 'multi_instance' | 'offscreen'
  status,              # OK | DEGRADED | FAILED
  evidence,           # 关键量：descendants / sessions / unread / login / instance_count / offscreen_coord ...
  suggested_action,    # actions.py 里对应动作 id（客户机用；闸忽略）
  ts
)
```

### 2. 纳入的状态（五类检测，各自判据来自台账根因）

| check_id | 检测判据（源自台账） | 数据来源 |
|---|---|---|
| `uia_tree`（树塌 §1.1） | 窗口找到但整树 `descendants≤2` 持续 ≥90s | UIA 快照 descendants/ListItem 计数 |
| `delivery`（送达 §1.2）| 发送后读回 preview 命中判定；轮询 5×0.6s 全空=FAILED，命中=OK；避免一次读空即判死 | `_confirm_delivery` 读回结果 |
| `login`（登录 §2 状态判定）| 可靠区分四态：已登录 / 没登录 / 隐私锁屏 / 找不到窗口（不能把"没登录"当"隐私锁"）| 窗口标题 + UIA 特征 |
| `multi_instance`（多实例 §2 / §2.B）| 同账号微信进程数 >1，或存在 `login=False sessions=0` 的实例；listen_chat python 进程数 >1 | 进程枚举（命令行匹配 `*listen_chat*` / 微信进程）|
| `offscreen`（离屏 §2.A）| 目标会话项 rectangle 坐标 >20000（离屏占位）| `_open_chat` 切换时的 item rect |

（微信版本压制 §1.4 建议作为一个**常驻动作**而非 check——见下，它是持续预防不是异常检测。）

### 3. 自愈动作（actions.py，客户机常驻用；每个带冷却 + 单进程上限）

| 触发 check | 自愈动作 | 冷却 / 上限（源自台账） |
|---|---|---|
| `uia_tree`=FAILED | 重启微信（在 `SPI_SETSCREENREADER` 标志已置位态下让 mmui 重建完整树）| 冷却 600s，单进程上限 5 次（§1.1 现有值）|
| `multi_instance`=FAILED | 收敛到单个登录微信：杀掉 `login=False` 的多余微信实例；按命令行匹配杀掉所有多余 `*listen_chat*` python/python-embedded（只留自己）| 只杀"多余/未登录"实例，不误杀正在服务的登录实例（见风险）|
| `offscreen`=FAILED | 坐标 >20000 → 重扫 ListItem 找 sender 新 item 引用 + 把窗口拉回可见前台（74654efd §5 修法）| 每会话切换重试上限，避免死循环 |
| `delivery`=FAILED | 已经是轮询读回兜底（§1.2）；真失败才 send_failed，绝不假 DELIVERED，也绝不因一次读空就重发（防重复发） | 重发前必须确认真未送达 |
| 常驻预防（§1.4）| listen_chat 主循环每 5 分钟 `run_update_lock(dry_run=False)` 压微信版本 | 每 5 min |

**正确启动骨架**（§2 收敛目标）：agent 先起并置无障碍标志 → 微信后登 → 单个登录微信 + 完整 UIA 树。自愈动作把偏离这个骨架的状态纠正回来。

### 4. 怎么做到"一份代码两处用"

- **共享单元 = `checks.py`（纯检测）+ CheckResult schema + `report.py` 判据阈值常量**（90s / descendants≤2 / >20000 / 5×0.6s 等全部集中为常量，两个入口 import 同一份，改一处两处同步）。
- **客户机运行时**（`runtime.py`，打包进 agent，随 listen_chat 常驻）：循环采样 → `checks.py` → 命中异常 → `actions.py` 自愈 → `report.py` 上报中台 + 写 `zj-listener-health.json`。这是"每台客户机自跑自愈"。
- **C1 rog 发版前闸**（`gate.py`，rog runner 在真机上一次性调）：采样 → **同一个 `checks.py`** → 全 OK 才 verdict=PASS，否则 FAIL + 明细（哪条 check、evidence 是什么）→ CI 据此放行/拦截 PR。闸**只判不愈**（发版前若真机脏，应该 FAIL 让人看到，而不是自愈掩盖）。
- 好处：发版前跑的判定标准 = 客户机运行时的判定标准，**同一份阈值同一份逻辑**，杜绝"闸过了但客户机上标准不同又坏"的漂移。台账 §4.5 要求的顺序（先自检自愈→再接闸）天然满足：`checks.py` 先落地，`gate.py` 只是它的第二个消费者。

### 5. 上报（可观测）

`report.py` 每轮把 CheckResult[] + 采取的自愈动作写入：
- 本地 `C:\Users\Public\zj-listener-health.json`（rog/诊断读）；
- 中台 agent 心跳（`agents` 表，带 machine_id/租户），字段含各 check status + 最近自愈动作 + 计数。便于中台聚合"哪台客户机反复树塌/反复多实例"。

---

## DoD

- [ ] `selfheal/checks.py` 存在且为纯函数（无进程 kill / 无窗口操作 / 无网络副作用），五类 check 全覆盖，判据阈值集中为常量。
  - `manual: node -e "const s=require('fs').readFileSync('services/agent/wechat-rpa/selfheal/checks.py','utf8'); const bad=/subprocess|os\.kill|TerminateProcess|PostMessage|requests\.|urllib/.test(s); if(bad){console.error('checks.py 含副作用');process.exit(1)} ['uia_tree','delivery','login','multi_instance','offscreen'].forEach(id=>{if(!s.includes(id)){console.error('缺 check '+id);process.exit(1)}}); console.log('OK')"`
- [ ] `runtime.py`（客户机入口）和 `gate.py`（rog 闸入口）**都 import 同一个 `checks.py`**（grep 两文件都引用 checks 且无各自重复的检测实现）。
  - `manual: node -e "const fs=require('fs');const r=fs.readFileSync('services/agent/wechat-rpa/selfheal/runtime.py','utf8');const g=fs.readFileSync('services/agent/wechat-rpa/selfheal/gate.py','utf8');if(!/from\s+\.?checks|import\s+checks/.test(r)||!/from\s+\.?checks|import\s+checks/.test(g)){console.error('未共享 checks');process.exit(1)}console.log('OK')"`
- [ ] `gate.py` 只判不愈：不 import `actions`（发版前不自愈）。
  - `manual: node -e "const g=require('fs').readFileSync('services/agent/wechat-rpa/selfheal/gate.py','utf8');if(/actions/.test(g)){console.error('gate 不应引 actions');process.exit(1)}console.log('OK')"`
- [ ] 自愈动作阈值与台账一致（树塌冷却 600s、上限 5 次；送达轮询 5×0.6s；离屏 >20000）—— 有单元测试断言常量值。
- [ ] 纯函数 checks 有 TDD 单测（喂造快照 → 断言 status/evidence），至少覆盖五类各一个 OK + 一个 FAILED case。
- [ ] 真机验收（rog）：`gate.py` 在 rog 真机跑出 verdict，且客户机常驻版看到 `reply_in_chat: ...DELIVERED` + 自愈动作被触发并上报。**看到连续 DELIVERED 才算 done，不提前报喜。**
- [ ] 台账 skill `wechat-cs-troubleshooting` §4.5 第 2 条从"计划"更新为"已落地 + 版本号"。

---

## 依赖

- **被 C1 复用**：C1（rog runner 发版前自检闸）直接调用本文 `gate.py`。C1 不重新实现检测逻辑，只负责"在 rog 真机把 gate.py 跑起来 + 把 verdict 接进 dev skill `target_environment=windows_wechat` 的 required gate"。因此**本 D1 必须先落地 `checks.py` + `gate.py`，C1 才能接**（台账 §4.5 规定的顺序）。
- 依赖 rog 真机的 session-1 执行通道（schtasks `/it` interactive token；`PsExec -i 1` 起不来 —— 台账 §3）。
- 依赖中台 `agents` 表心跳注册通道（§2 NO_TENANT_CONTEXT 若没修，上报会 400；上报需带 machine_id + 租户）。
- 依赖跑通版参考实现：memory `line04_wechat_cs_working_impl_0621`（git 74654efd 完整实现，离屏修法在 §5）、`line04_wechat_uia_tree_collapse_rootcause_0629`。

---

## 风险与注意

- **跨仓库**：目标代码在 ZenithJoy autopilot repo，不在本 cecelia 仓库。本设计落地时走 ZenithJoy 的 /dev 流程，E2E 走 `windows_cloud` runner（ZenithJoy UI 死规则），真机验证走 rog。本文档只在 cecelia 侧留设计，**不在 ZenithJoy 仓库 commit 任何东西**。
- **别误杀（最高风险）**：`multi_instance` 自愈杀进程时，必须精确区分"多余/未登录实例"和"正在服务的登录实例"——只杀 `login=False` 的微信、只杀多余 `*listen_chat*` python，**绝不杀掉唯一在服务的登录微信 / 当前自己这个 listener**。杀之前用 check 的 evidence 二次确认。误杀会让客户机彻底停服。
- **别霸屏 / 别重犯 #998 滚动回归**：自检自身不准往 scan_unread 加滚动、不准"拉到会话列表底部 + 开群"（#998 就是这么回归的，台账 🔴🔴）。`offscreen` 自愈只"拉回前台 + 重扫 item 引用"，不做 CRM 式滚动遍历。自检节流不霸占键盘/前台（memory `line04_selfcheck_thrash_rootcause_0627` 多进程抢键盘教训）。
- **别自愈掩盖真问题**：`gate.py`（闸）绝不自愈——发版前真机脏就该 FAIL 让人看到；只有客户机运行时才自愈。否则闸永远绿、问题被藏。
- **真机为准**：微信 UIA 行为在 4.1.8 vs 4.1.10 可能不同（§2.H 未验证），阈值/离屏行为必须在真机反复调，看到连续 DELIVERED 才算好。别拿 staging 旧副本当生产真相（先确认环境，§4 起手式）。
- **状态判定假阴性**：`delivery`/`login` 检测本身要鲁棒（空预览多轮询/换读法/兜底），检测器自己误判会触发错误自愈（如误判未送达 → 重发 → 给同一人发两遍）。
- **顺序**：先 D1（自检自愈让真机自己变干净可测）→ 再 C1 接闸。反过来会让 rog 闸天天误挡合并（§4.5）。
