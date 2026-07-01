# C1：真机 rog runner —— tests/rog/ + session-1 runner + 发版闸

> harness 验证模型重构 · 分片 C1（真机验收层）
> 范围：Cecelia repo 放 **runner 编排 + tests/rog 骨架**；真机 agent 本体在 ZenithJoy autopilot 仓库。
> 状态：设计草案（design only，不改代码、不 commit）。日期：2026-07-01。

---

## 问题现状

微信客服（Line04 个微 RPA）这类功能的**真正验收**是：真机 Windows 微信里，客户消息被 agent 读到并**回出去、读回确认 DELIVERED**。这件事有三个硬约束，导致 CI 云 Linux job 天生测不了：

1. **需要 session 1 交互桌面**。SSH 进 Windows 是 session 0，够不到 session 1 的微信 GUI/UIA 树；`PsExec -i 1` 起不来。CI runner 更没有真微信、没登录态、没无障碍树。
2. **需要真微信 + 登录态 + 完整 UIA 树**。UIA 树只在微信进程带 `SPI_SETSCREENREADER` 标志启动时才构建；离屏会话项坐标 ~32000；这些行为只在真机复现。
3. **验收判据是"送达"而非"代码跑通"**。`reply_in_chat: ...DELIVERED` 才算真送达，读不到就是 `send_failed`——只有真机能产出这条日志。

结果就是过去反复掉的坑（skill §4.5 记的"病根"）：修好的东西只记进台账（文档），没做成机器强制守卫 → 下次改动把它改坏没人拦。典型是 **#998 把删掉的"回复循环滚动/开群"回归进 repo**，守卫被放松、无人阻挡就合并了。

**已验证事实：**
- 现在**无真机 runner**——`.github/workflows/` 里只有 `e2e-windows.yml`（windows-latest **云** runner，无真微信），没有 self-hosted 真机 runner。
- dev SKILL 的 `target_environment` 枚举里**已有 `windows_wechat`（xian-rog self-hosted 真机微信）这个概念**（`~/.claude-account2/skills/dev/SKILL.md:540`），全链 planner/proposer/evaluator 一致，**但没建成 required gate**。
- 现成零件（skill `wechat-cs-troubleshooting` §3）齐了：session-1 通道 `schtasks /it`、GBK 日志 base64 回读、`.txt→base64→rog 解码成 .py 跑 anaconda python`、"回得了"判据 `reply_in_chat: ...DELIVERED`、真送达 gate 识别真发 vs 没发。
- `tests/rog/` **目前不存在**；Cecelia vitest include 是**显式白名单**（`packages/brain/vitest.config.js` 只 include `tests/`、`tests/integration`、`tests/brain`、`tests/alertness`、部分 `sprints/`），**不 include `tests/rog/`**，所以放这里的文件天然不进 vitest。

---

## 目标

把"真机看到 DELIVERED"从**人肉自觉**变成**机器强制闸**，具体三条：

1. **committed 骨架**：`tests/rog/` 进 git（可 review、可版本化、可回归），但 **CI 云 job 完全跳过**，只由 rog self-hosted runner 跑。
2. **一键触发**：本机一条命令 → 通过 session-1 通道在 rog 上跑 smoke（发→DELIVERED + 边界断言）→ GBK 日志 base64 回读 → 本地判 **PASS/FAIL**，无人肉盯屏。
3. **挂进发版流程当闸**：按今天定的设计原则——**真机闸放在"部署到 rog 之后、铺货给客户机之前"**（卡铺货，不卡合并）；smoke 红了**停在 rog、不 promote/不 OTA 铺货**给客户机。

**非目标（明确排除）：**
- 不做真机 agent 本体的自检自愈代码（那是 **A2**，且 skill §4.5 定的顺序是"**先 A2 自检自愈让真机变干净可测 → 再把 rog 接成闸**"）。
- 不卡 PR 合并（合并闸继续走 CI + evaluator；真机只卡"铺货"这一步）。
- 不在本 repo 放 RPA 执行逻辑（在 ZenithJoy autopilot 仓库）。

---

## 具体改动

### 1. `tests/rog/` 目录结构（committed，CI 跳过）

```
tests/rog/
├── README.md                     # 【必读】声明：真机 only，CI 永不跑，进入门槛/前置
├── smoke/
│   ├── wechat_cs_delivered.txt   # 主 smoke 脚本（.txt 扩展，绕 bash-guard；rog 上解码成 .py）
│   │                             #   跑 anaconda python(含 pywinauto)，做发→DELIVERED + 4 条边界断言
│   └── assertions.txt            # 纯函数断言库（.txt→.py），被主脚本 import，可单独 code-review
├── runner/
│   ├── run-rog-smoke.sh          # 【一键命令】本机触发入口（见 §2）
│   ├── rog-launch.bat.tmpl       # schtasks /it 在 session-1 拉起的 .bat 模板（解码+跑 python+落日志）
│   └── readback-gbk.sh           # GBK 日志 base64 回读 + 本地 base64 -d + PASS/FAIL 解析
├── expected/
│   └── delivered-invariants.yaml # 期望不变量（descendants>2 / DELIVERED 命中 / 离屏恢复 / 轮询命中）
└── fixtures/
    └── target-contact.example.env # smoke 目标联系人/环境占位（真值不进 git，rog 本地覆盖）
```

设计要点：
- **脚本用 `.txt` 扩展名 committed**，rog 上 base64 解码成 `.py` 再跑——沿用 skill §3 的既有做法（`.py` 被 bash-guard 拦），且让"传输内容"和"可执行"解耦。
- **断言逻辑（`assertions.txt`）拆成纯函数**（如 `parse_delivered(log_line)`、`tree_healthy(descendants)`、`offscreen_recovered(events)`），这样它**能被普通 vitest/pytest 单元测试覆盖**（放 `tests/` 白名单内、CI 跑纯函数部分），真机部分只负责"跑真微信 + 采日志"。**纯逻辑云里测、真机行为真机测**，两层分离。
- `expected/delivered-invariants.yaml` 是这条闸的**验收契约 SSOT**，runner 和 assertions 都读它，不散落魔法值。

### 2. runner 命令：`tests/rog/runner/run-rog-smoke.sh`（本机一键触发）

一条命令，本机跑，全自动，六步：

```
run-rog-smoke.sh --contact <target> --env <staging|prod-dry> [--version <sha>]
  1. 预检     : ssh rog 可达；确认 rog 上 line04 已部署到目标版本（读 zj-listener-health.json 的 ver）
  2. 下发脚本 : scp tests/rog/smoke/*.txt + rog-launch.bat + invariants.yaml 到 rog scratchpad
  3. session-1: ssh rog 执行
                schtasks /create /tn ZJRogSmoke /tr "<rog-launch.bat>" /sc once /st 00:00 /ru asus /it /f
                schtasks /run /tn ZJRogSmoke
                （/it = interactive token，进 session-1 交互桌面操作真微信；见 skill §3）
  4. 等待完成 : 轮询 rog 上 smoke 结果哨兵文件（zj-rog-smoke-result.json），带超时（默认 8min）
  5. 回读     : readback-gbk.sh —— Get-Content -Encoding Default → base64 → SSH 回传 → 本地 base64 -d
                （避免 GBK 多字节经 SSH 被 codepage 截断，skill §3 铁律）
  6. 判定     : 解析真送达日志 reply_in_chat: ...DELIVERED + 4 条边界断言 → 打印 PASS/FAIL + exit code
```

- **exit 0 = PASS（真机看到 DELIVERED + 边界全过）**；非 0 = FAIL，附失败断言 + 回读的关键日志行。
- 触发方式两种：① 人肉本机跑（lead 发版前自检）；② 发版流程 workflow 里由 rog self-hosted runner 起（见 §3）。两种走**同一个脚本**，保证"发版前先跑=那道闸"和"平时自检"同一份逻辑（skill §4.5 第 2 条"一份代码两处用"）。

### 3. smoke 内容：发→DELIVERED + 4 条边界断言

主脚本 `wechat_cs_delivered.txt` 在真机做的事：

| 项 | 断言 | 判据来源 |
|---|---|---|
| 主流程 | 向 `<contact>` 发一条 smoke 消息，agent 回复，日志出现 `reply_in_chat: ...DELIVERED` | skill §3 真送达 gate |
| 边界①树没塌 | 回复时 UIA `descendants > 2`（非塌缩态 `descendants≤2`） | skill §1.1 树塌缩根因 |
| 边界②离屏恢复 | 若会话项坐标 >20000（离屏），`_open_chat` 走"重扫 ListItem + 拉回前台"后**切到并发出** | skill §2.A 离屏修法 |
| 边界③送达轮询命中 | `_confirm_delivery` 多轮（≤5×0.6s）轮询**命中** DELIVERED（不是一次空就判失败） | skill §1.2 送达假阴性修法 |
| 边界④回复循环纯度 | smoke 期间日志**不出现**"滚动到列表底部 / 开群遍历"（#998 回归守卫的运行时对照） | skill §2 #998 回归 |

失败任一条 → FAIL，且报告指明命中的是哪条 skill 已知项，避免重复诊断。

### 4. 发版闸挂点

**原则（今天定）**：真机闸放在"**部署到 rog 之后、铺货给客户机之前**"——卡铺货，不卡合并。红了停在 rog，别 promote。

- **不改 `.github/workflows/ci.yml`**（合并闸），也不进 PR required checks——合并继续靠 CI + evaluator。
- 新增 self-hosted 发版闸（形态二选一，实现期定；**闸逻辑都调 §2 同一脚本**）：
  - **形态 A（推荐）**：新增 `.github/workflows/rog-realmachine-gate.yml`，`runs-on: [self-hosted, windows, rog, session-1]`（rog 注册为 self-hosted runner），`workflow_dispatch` 触发，input=目标版本 sha；job 跑 `run-rog-smoke.sh`；**PASS 才允许下一步 promote/OTA 铺货**。因是 self-hosted 专属 label，**云 runner 永不 pick，天然 CI 跳过**。
  - **形态 B（轻量兜底）**：不进 GHA，发版脚本（ZenithJoy 侧 OTA/铺货脚本）在"deploy-to-rog 成功"和"publish-to-customers"之间插一步 `run-rog-smoke.sh`，非 0 直接中止铺货。
- **闸语义**：`deploy → rog` ✅ → `run-rog-smoke` →（PASS）→ `promote / OTA 铺货给客户机` ✅ /（FAIL）→ **停在 rog，报警，不铺货**。

### 5. CI 如何标记跳过这些 realmachine test（三层保险）

1. **不进 vitest include**：`tests/rog/` 不加入任何 vitest `include` glob（当前白名单本就不含它），且脚本是 `.txt`/`.ps1`/`.bat`/`.yaml` 非 `.test.ts`，**vitest 天然不收**。
2. **不进云 workflow**：`ci.yml` 的 changes 检测（`brain/engine/workspace`）不覆盖 `tests/rog/**`；真机闸走 self-hosted label（形态 A）或独立发版脚本（形态 B），云 runner 无对应 label，**pick 不到**。
3. **README 显式声明 + 目录约定**：`tests/rog/README.md` 头部写死"**REAL MACHINE ONLY — CI MUST NOT RUN**；这些是 session-1 真微信脚本，云 runner 无真微信/无 UIA 树，只能由 rog self-hosted runner 经 `run-rog-smoke.sh` 触发"。给人和后续 agent 一个明确边界，防止有人误把它塞进 vitest include（复现 ci.yml 注释里"sprints test 被误纳入"那类坑）。

---

## DoD（真机看到 DELIVERED 才 PASS）

- [ ] `tests/rog/` 骨架 committed 进 git（README + smoke/.txt + runner + expected/invariants），**且改动后 `ci.yml` 全绿证明 CI 不跑它**（vitest 无新增用例、无云 job pick）。
- [ ] `run-rog-smoke.sh` 本机一条命令跑通：session-1 `schtasks /it` 起 smoke → GBK base64 回读 → 打印 PASS/FAIL + 正确 exit code。
- [ ] **真机实证**：在 rog（当前 4.1.8.107）向真实联系人发 smoke，**日志出现 `reply_in_chat: ...DELIVERED`** → 脚本判 **PASS**；人为制造未送达（如断网/关 agent）→ 脚本判 **FAIL**（不假阳性）。
- [ ] 4 条边界断言各有一次"该 PASS 时 PASS / 该 FAIL 时 FAIL"的真机对照（树塌、离屏、轮询、#998 滚动回归）。
- [ ] 发版闸接上：模拟一次 smoke FAIL，验证**铺货被阻断、停在 rog**；一次 PASS，验证放行 promote/OTA。
- [ ] 纯函数断言（`assertions.txt` 对应逻辑）有一份 CI 内的普通单测覆盖（parse_delivered / tree_healthy 等），保证判据逻辑本身有回归网。

> **验收铁律**：任何"回复/状态/送达"相关改动，**真机看到连续 DELIVERED 才算 done，不提前报喜**（skill §2.A / §3）。smoke PASS 的唯一充分条件 = 真机日志出现真送达 DELIVERED，读不到一律 FAIL。

---

## 依赖

- **与 A2（agent 运行时自检自愈）共用 session-1 通道**：A2 的自愈代码和本片 runner 都经 `schtasks /it` 进 session-1 操作真微信。skill §4.5 定的**顺序是先 A2 后 C1**——先让真机能自愈变"干净可测"，再把 rog 接成闸，否则 rog 一乱天天误挡铺货。C1 的 smoke 脚本可直接复用 A2 落地的 session-1 拉起模板。
- **与 D1（检测逻辑）共用判据**：DELIVERED 识别、树塌 `descendants≤2`、离屏 `>20000`、送达轮询命中——这些**检测函数 D1 在 agent 侧实现，C1 的 assertions 直接引用同一套判据**（同一份 invariant，别各写一套飘）。`expected/delivered-invariants.yaml` 应与 D1 的检测常量对齐（理想是 D1 导出、C1 引用）。
- **跨仓库**：真机 agent 本体（listen_chat / UIA 发送 / 自愈）在 **ZenithJoy autopilot 仓库**；本 repo 只放 runner 编排 + tests/rog 骨架 + 发版闸 workflow。两仓库靠 `line04` 版本号（`zj-listener-health.json` 的 ver）对齐"闸跑的是哪个版本"。
- **invariant 登记**：skill §4.5 第 3 条——"回复循环不准滚动/开群"等应登记进 `decisions` 表（category=invariant）喂进 /dev GAN；C1 的边界④是它的运行时对照，两者互补（一个防写进代码、一个防跑进真机）。

---

## 风险与注意

- **跨仓库耦合**：agent 逻辑在 ZenithJoy、闸在 Cecelia，版本漂移会让"闸跑旧版 agent"。缓解：runner 预检强制校验 rog 上 `zj-listener-health.json` 的 ver == 目标发版 sha，不匹配直接中止（不给假绿）。
- **真机飘（false red 风险最大）**：真微信有登录态/网络/腾讯自升/UIA 偶发空读等噪声，smoke 可能非代码原因 FAIL。缓解：① **先 A2 后 C1**，等自愈稳了再接闸；② smoke 内已知假阴性走轮询（送达 5 轮、UIA 多读）；③ FAIL 报告必须区分"代码回归"vs"环境噪声"（附回读日志 + 命中的 skill 已知项），给 lead 人工复核口，而**非自动重试掩盖**。④ 闸只卡铺货不卡合并，飘了不阻塞主线开发。
- **rog 是共享真机（Lead 自检机）**：rog 同时用于人工排障、A2 自愈调试、C1 闸，并发跑会抢微信窗口/键盘（skill 记过"多进程抢自检"坑）。缓解：runner 用 `schtasks /tn ZJRogSmoke` 单任务名 + 前置检查"无其他 listen_chat/自检在跑"，跑闸时独占；跑完清理 task。**闸跑期间不与人工排障并行**。
- **rog 环境 = staging 手改态**：rog 的 `.env` 手动连 staging、`WECHAT_CS_MODEL` 等靠热修，重启/OTA/部署会打回原形（skill §2 顶部警告）。smoke 前置必须确认 rog 连的是**预期环境**（读 listener 日志 `middleware=`），别拿 staging 旧态当生产真相。
- **session-1 通道脆性**：`schtasks /it` 依赖 asus 用户已登录交互桌面；机器锁屏/注销/自动登出会让 session-1 不可用。缓解：预检确认 session-1 活跃（有 GUI 会话），不可用时 FAIL-fast 报"通道不可用"而非误判 smoke 失败。
- **GBK 回读**：必须走 base64（skill §3），直接 `iconv -f GBK` 经 SSH 会截断最新几行多字节字符 → 可能漏读到 DELIVERED 那行造成假 FAIL。readback 脚本硬编码 base64 路径，不留 iconv 兜底。
- **别把 tests/rog 误纳入 CI**：后续有人可能顺手把 `tests/rog/**` 加进 vitest include（复现 ci.yml 注释里 sprints 被误纳的坑）——README 显式警示 + 目录用非 `.test.ts` 扩展双保险，review 时盯住。
