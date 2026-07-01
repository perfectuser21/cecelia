# A2：Generator 开发时连真机 rog 自验

> harness 验证模型重构 · 子方案 A2
> 只做设计，不改代码。目标读者：后续执行本方案的 /dev。

---

## 问题现状（引用事实 + 文件位置）

### 1. Generator 的 Step 6.5 自验在容器里跑，摸不到真机真相

`packages/workflows/skills/harness-generator/SKILL.md` **Step 6.5「Contract Self-Verification」**（L437–524）强制 generator 在 `git push` 前自跑 contract-dod.md 里所有 `[BEHAVIOR] manual:bash` 命令，任一 FAIL 不准 push、必须自修。这一步是对的方向（W19/W20/W21/W22 教训：generator 频繁推漂移实现给 evaluator 兜底）。

**但它在 Docker 容器（Linux）里跑**：
- L454–458：容器内 `localhost:5221 → host.docker.internal` 替换，说明执行环境是容器。
- L490–493「windows_cloud target 例外说明」：`[BEHAVIOR]` 必须是 **bash-executable**（curl/psql/jq，API-level）；一旦发现 PowerShell / Windows 专属命令 → generator **无法本地验证**，只能标 `[CI_GAP]` 并 push，把 GUI/RPA 层真相**整个甩给 evaluator**。

### 2. 真相第一次出现在 evaluator = "炸"

`packages/workflows/skills/harness-evaluator/SKILL.md`：
- L82–85：`TARGET_ENV = windows_wechat` = **xian-rog self-hosted runner**（微信已登录），触发 `e2e-wechat-rpa.yml`（`WECHAT_RPA_WORKFLOW`，由 `evaluateContractNode` 注入）。
- 也就是说：Line04 微信客服这类 RPA，**验收动作（真机看到 DELIVERED）第一次发生在 evaluator**。generator 全程在容器里，从没碰过真机。环境错位 → evaluator 每次第一个撞真相 → 炸。

### 3. 通道其实现成，只是没接进 generator 循环

台账 skill `~/.claude-account2/skills/wechat-cs-troubleshooting/SKILL.md` **§3「诊断复用法」** 已经把 rog 的 session-1 通道趟通并实测可用：
- **session-1 执行通道**（§3 L122–127）：SSH 连 rog = session 0，够不到 session 1 的微信 GUI/UIA。用
  `schtasks /create /tn <name> /tr "C:\path\run.bat" /sc once /st 00:00 /ru asus /it /f` + `schtasks /run /tn <name>`，`/it`（interactive token）能在 session 1 交互桌面跑代码操作微信（`PsExec -i 1` 起不来）。
- **读中文日志**（§3 L129–130）：日志 GBK，`Get-Content -Encoding Default` → UTF8 字节 → `[Convert]::ToBase64String` → SSH 回传 → 本地 `base64 -d`，避免多字节截断。
- **诊断脚本写法**（§3 L132–133）：scratchpad 用 `.txt` 扩展（`.py` 被 bash-guard 拦）→ base64 → 目标机解码成 `.py` → 跑 `C:\Users\asus\anaconda3\python.exe`（含 pywinauto）。
- **真送达 gate**（§3 L150–151）：`reply_in_chat: ...DELIVERED` = 真送达；读不到 = `send_failed`，绝不假装。**回复改动真机看到 DELIVERED 才算 done。**
- **健康信号**（§3 L135–139）：listener 日志 `C:\Users\Public\zj-listener.log`（心跳每 60s：found_window/login/locked/sessions/unread/replied），健康 `C:\Users\Public\zj-listener-health.json`；判"读得到会话" = `sessions>0` 且出现过 `unread>=1`。

这些管子全是现成的，缺的只是**把它接进 generator 的 Step 6.5 循环**，让 generator 开发时每轮就在 rog 上摸真相。

### 4. rog 是共享飘机

`~/.claude-account2/.../memory/infrastructure.md` + wechat-cs-troubleshooting §1：rog = xian-rog（西安 Windows 机），同时是 Lead 自检机、evaluator 的 self-hosted runner，**共享**；真机状态会飘（会话树塌缩 / 离屏 / 微信自升 OTA）。任何"每轮连 rog"方案必须先解决并发与飘机假失败。

---

## 目标

1. **把 generator 的 GUI/RPA 层自验从"甩给 evaluator"改成"generator 开发时自己在 rog 上跑"**：Step 6.5 对 RPA/GUI 类功能不再只标 `[CI_GAP]` 走人，而是经 session-1 通道在真机上真跑，看到 `DELIVERED` 才算过。
2. **让 evaluator 不再第一个碰真相**：generator 每轮（或每次实现有改动）就摸到真机真相，漂移在 generator 侧被打回自修，evaluator 回归"判官/复核"而非"第一现场救火"。
3. **只对真正需要真机的功能连 rog**：纯逻辑 / API-level / mac_web bash 类**保持容器自验不变**，不引入无谓的真机开销与飘机风险。
4. **共享飘机安全**：单飞（防并发）、飘机健康预检（防假失败）、env-fault 与 code-fault 分流（飘机不冤枉代码）。

---

## 具体改动

### 改哪里

`packages/workflows/skills/harness-generator/SKILL.md` **Step 6.5**（L437–524）。新增一个**分层自验**结构，把现有单层（容器 bash）扩成两层：

- **Tier-1 容器自验（保持现状）**：所有 `[BEHAVIOR] manual:bash`（API-level：curl/psql/jq）继续在容器里每轮跑，L441–481 一字不改。
- **Tier-2 真机自验（新增）**：当 `target_environment ∈ {windows_wechat, 以及后续任何 RPA/GUI 类}` 时，追加一段经 session-1 通道在 rog 上跑 contract 的 GUI/RPA 验收断言。

### Step 6.5 决策门（放在 Tier-1 之后、push 之前）

```
读 PRD/合同的 target_environment：
  ├─ 命中"需连 rog"集合（见「哪些功能类型才连 rog」）
  │     → 跑 Tier-2 真机自验（下述通道），看到 DELIVERED/真机断言过才放行
  └─ 否则（mac_web bash / linux_server / local_api / 纯逻辑）
        → 跳过 Tier-2，维持容器自验结论，不碰 rog
```

判定用 PRD 的 `target_environment` 字段（与 evaluator L82 同源），**不靠路径猜**（apps/dashboard 在两 repo 都有，见全局 E2E 路由死规则）。

### 接 session-1 通道（Tier-2 的具体机制）

**不在 SKILL.md 里内联一大坨 schtasks/base64**——那会复制 wechat-cs-troubleshooting §3 的逻辑、日后两处漂移。改为**抽一个可复用包装脚本**，generator 与 evaluator（C1）共用：

- 新增 `scripts/harness/rog-session1-exec.sh`（宿主 Mac 侧）。入参：本地 `.py`/`.txt` 脚本 + 期望断言。内部封装 §3 三步：
  1. **投递**：本地脚本 base64 → `ssh xian-rog` 写到 rog scratchpad `.txt` → 目标机 `certutil -decode` 还原成 `.py`；生成 `run.bat`（调 `C:\Users\asus\anaconda3\python.exe <script>.py`，stdout/stderr 重定向到固定 log）。
  2. **进 session 1 执行**：`schtasks /create ... /ru asus /it /f` + `schtasks /run`，轮询任务结束（查 `schtasks /query` 状态或 sentinel 文件）。
  3. **回读结果**：`Get-Content -Encoding Default` 目标 log → UTF8→base64 → SSH 回传 → 本地 `base64 -d`，解析 `DELIVERED` / `send_failed` / 真机断言。
- generator 的 Tier-2 = 生成"跑 contract 验收动作 + 读 listener 日志判 `sessions>0`/`DELIVERED`"的 pywinauto 脚本，交给 `rog-session1-exec.sh`，退出码/断言决定 PASS/FAIL。
- **容器内逃逸**：generator 常在 Docker 里跑，容器内没有 rog 的 ssh key/别名 → 复用 `harness-host-executor-ssh-escape` 已有模式（检测 `/.dockerenv` 后 ssh 逃逸到宿主 Mac 再由宿主 `ssh xian-rog`）。SKILL.md 里只写"调 `rog-session1-exec.sh`（容器内自动经 host-executor 逃逸到宿主）"，不重复实现逃逸。

### 每轮跑 vs 只收尾跑

**分层节流，不是二选一：**

- **Tier-1 容器自验：每轮跑**（现状，便宜、确定、无飘机风险）。
- **Tier-2 真机自验：不每次都跑全量，但 push 前至少真跑一次，且"实现有改动就作废重跑"**。规则：
  - generator 在 GAN→实现循环里可以先只跑 Tier-1 快速迭代（省 rog）；
  - 但**进 Step 7 push 之前，Tier-2 必须对"当前实现快照"跑过且 PASS**——用实现代码的 git tree hash 做缓存 key，只要相关实现文件变过，上一次 Tier-2 结果作废、必须重跑。杜绝"改完没重验就 push"。
  - Tier-2 内部区分**冒烟档 vs 全量档**：每轮至多跑冒烟（1 条最关键 DELIVERED 断言，60–90s）；push 前收尾跑全量（覆盖 contract 全部 GUI/RPA 断言 + Golden Path）。

这样既让 generator "开发时就摸真相"（每次实现改动都要过冒烟），又不把共享 rog 打爆。

### 防并发 / 防假失败（共享飘机）

1. **单飞（防并发）**：rog 上一把互斥锁（sentinel 文件，如 `C:\Users\Public\harness-rog.lock`，写入 owner=task_id+时间戳+TTL）。`rog-session1-exec.sh` 先抢锁，抢不到就排队/退避；带 TTL 防死锁（崩溃残留锁自动过期）。generator 与 evaluator（C1）**共用同一把锁**，避免"generator 在验、evaluator 同时也在跑"互相踩会话。
2. **飘机健康预检（防假失败）**：每次 Tier-2 真跑前先跑 preflight（读 `zj-listener-health.json` + listener 心跳）：微信登录？在屏？`sessions>0`？会话树没塌（未 OTA 到坏版本）？微信没自升？任一不满足 → **判 `env_blocked`，不是 `BEHAVIOR_FAIL`**。
3. **env-fault 与 code-fault 分流**：
   - `env_blocked`（飘机）→ 退避重试 N 次；仍不行 → 标 `[ENV_BLOCKED]`（**不计入** Step 6.5 的 3 轮 FAIL 计数，不冤枉代码），按现有 `[CI_GAP]` 语义 push 交 evaluator，并触发 rog 自愈（复用 wechat-cs-troubleshooting 的树塌缩/离屏修法，超出本方案范围）。
   - 真跑起来但断言不过（读到 `send_failed`/字段漂移）→ 才是 `BEHAVIOR_FAIL`，走 L495–524 现有"修实现→commit→重跑，连续 3 轮标 `[BEHAVIOR_FAIL]` push 交 evaluator"。
4. **绝不假装**（§3 L150 死规则）：读不到 `DELIVERED` 一律当没送达，禁止把 `env_blocked` 当 PASS 蒙混。

### 哪些功能类型才连 rog

在 Step 6.5 决策门用一张明确的分流表（按 PRD `target_environment`）：

| target_environment | 层 | 连 rog？ | 自验方式 |
|---|---|---|---|
| `windows_wechat`（Line04 微信客服 RPA） | GUI/RPA | **是** | Tier-2 session-1 真机 |
| 其他 GUI/桌面 UIA / 个微 RPA 类 | GUI/RPA | **是** | Tier-2 session-1 真机 |
| `mac_web`（Cecelia dashboard 本机 Playwright） | Web UI | 否（本方案不管） | 本机 Playwright，非 rog |
| `windows_cloud`（ZenithJoy 云端干净 sandbox） | Web/Electron | 否 | GHA windows-latest（evaluator Mode B） |
| `linux_server` / `local_api` / 纯逻辑 | API/逻辑 | **否** | Tier-1 容器 bash 自验（现状不变） |

**判据一句话**：只有"验收必须在真机 session 1 的 GUI 上眼见为实（微信/桌面 UIA）"的功能才连 rog；能用 curl/psql/jq 在 API 层断言的，一律留在容器，纯逻辑更不碰真机。

---

## DoD

- [ ] Step 6.5 新增决策门：读 `target_environment`，命中"需连 rog"集合才走 Tier-2；其余维持容器自验。
- [ ] `scripts/harness/rog-session1-exec.sh` 存在，封装 §3 三步（base64 投递 / `schtasks /it` session-1 执行 / GBK→base64 回读），**不在 SKILL.md 内联复制** schtasks/base64 逻辑。
- [ ] Tier-2 容器内经 host-executor 逃逸到宿主再 `ssh xian-rog`（复用 `harness-host-executor-ssh-escape`，不新写逃逸）。
- [ ] 节流：Tier-1 每轮；Tier-2 push 前至少对当前实现快照跑过一次全量且 PASS，实现文件变更即作废重跑（tree-hash 缓存 key）。
- [ ] 并发锁：rog 上带 TTL 的 sentinel 互斥锁，generator/evaluator 共用；抢不到排队退避。
- [ ] 飘机预检：Tier-2 真跑前 preflight（登录/在屏/`sessions>0`/未坏版 OTA），不满足判 `env_blocked`。
- [ ] 分流：`env_blocked` 不计入 3 轮 `BEHAVIOR_FAIL`，退避重试后标 `[ENV_BLOCKED]` push；真跑不过才 `BEHAVIOR_FAIL`。
- [ ] 断言死规则：只认 `reply_in_chat ...DELIVERED`，读不到即失败，`env_blocked` 禁当 PASS。
- [ ] [BEHAVIOR] 回归：造一个 `target_environment=windows_wechat` 的最小 sprint，跑通"generator 侧 rog 自验读到 DELIVERED → PASS"，并造一个"飘机 → env_blocked 不冤枉代码"的用例。
- [ ] SKILL 版本 bump + changelog（harness-generator 走 skill-creator→PR，不走 /dev、不 `[CONFIG]`、不 bump engine 版本；见 skills-architecture SSOT 规则）。

---

## 依赖（和 C1 rog runner 共用通道）

- **C1（rog runner 通道基建）是本方案的底座**：session-1 通道、并发锁、飘机 preflight、rog 自愈应由 **C1 统一实现一套**，A2 与 evaluator 共用。分工：
  - **C1 提供**：`scripts/harness/rog-session1-exec.sh`（含 schtasks/it + GBK base64 回读）、rog 互斥锁协议（sentinel + TTL）、preflight 健康检查脚本、rog 自愈钩子。
  - **A2 消费**：generator Step 6.5 在 push 前调这套通道做 Tier-2 自验。
- **共用同一把锁是硬约束**：generator（开发自验）与 evaluator（验收）都跑在同一台共享 rog，必须共享互斥锁，否则两边同时操作微信会话互相踩、都拿到假结果。
- 若执行顺序上 C1 先落地，A2 直接调用；若 A2 先动，需在 A2 内先落一个 C1 会继承的最小通道实现，并在 C1 收口时替换为共用版本（避免两处漂移）。
- 依赖 `harness-host-executor-ssh-escape`（容器→宿主逃逸）现有能力，不重写。
- 依赖 wechat-cs-troubleshooting §3 作为通道事实来源；本方案与 C1 落地后应回头在该 §3 加一句"此通道已被 harness generator/evaluator 复用"（活台账维护）。

---

## 风险与注意（共享真机、飘）

1. **共享 rog 争用**：rog 同时是 Lead 自检机 + evaluator runner + 现在还要给 generator 自验。锁不做好会三方互踩。必须单飞 + 排队 + TTL，且给锁加"谁持有/持有多久"可观测，避免死锁把整条 pipeline 堵死。
2. **飘机假失败冤枉代码（最大坑）**：树塌缩 / 离屏 / 微信 OTA 自升会让真跑失败，但根因是环境不是代码。若不做 env-fault/code-fault 分流，generator 会陷入"改对的实现被飘机打回→反复自修→3 轮 FAIL"的假死循环。`env_blocked` 必须独立于 `BEHAVIOR_FAIL`。
3. **绝不假装 PASS**：§3 死规则——读不到 `DELIVERED` 就是没送达。分层节流/缓存不能变成"上次过了这次跳过"，实现改动必须作废缓存重跑，否则 evaluator 又变第一现场。
4. **rog 开销放大**：每个 windows_wechat sprint 的每轮冒烟都占 rog。要靠"纯逻辑/API 层不连 rog"的分流表严格收敛连 rog 的范围，且冒烟档控制在 60–90s。分流表判错（把 API 类误标成 GUI 类）会平白打爆 rog。
5. **中文日志编码**：必须走 §3 的 GBK→base64 回读，直接 `iconv -f GBK` 经 SSH 会截断最新几行造成假象误判。
6. **bash-guard**：投递脚本用 `.txt` 扩展再目标机解码成 `.py`（`.py` 被 bash-guard 拦），否则投递这一步就挂。
7. **通道逻辑单一来源**：schtasks/base64/preflight 只在 C1 的 `rog-session1-exec.sh` 一处实现，SKILL.md 只引用不复制，否则日后 rog 环境变化两处各改一半 → 又一个漂移源。
