# Handoff：产能判定合并（slot-allocator 收权）— 任务 beeba317【v2 修订版】

- 日期：2026-07-17 17:30 CST 初版；2026-07-17 18:10 CST v2 修订（管家会话设计评审 + Alex 拍板两刀切）
- 决策依据：Alex 07-17 口头拍板方向（机器空转实测洞察）+ 07-17 晚拍板"cap 必须是函数不是常数、选择系另立刀2" + 145014a4（无等级不成验口径沿用）
- **接手须知：Brain 任务 `beeba317-20b9-42bf-aa29-730956b1341f` 已在队列（P1）。有头接手第一步必须 `PATCH /api/brain/tasks/beeba317… {"status":"in_progress"}` 正式认领防 harness 抢跑（铁律，案底见 memory headed-dev-parallel-dispatch-incident）。**

## 〇、v2 相对初版改了什么（先读这段）

1. **cap 从常数改成函数**（核心变更）：初版 CONTAINER_CAP=4 固定值是旧病（MAX_CONCURRENT_HARNESS_INITIATIVES=2 猜数字）的复刻——4 个容器各只用 300MB、VM 剩 8G 时第 5 条照样被拒。v2 改为动态 admission，见「三、改法」第 1 条。
2. **Claude 额度不新增第五套**：考古漏了 `quota-guard.js`（dispatcher.js:260-284 已接线：最优账号 5h >98% 停派、>90% 仅 P0/P1）。v2 改为收编复用，不重写。
3. **补三个口子**：派发→容器出现的超发窗口、缓存过期语义、resume 豁免的前置依赖。
4. **两刀切**：beeba317 只做单机收权+动态化（本文件）；三轴选择系（多账号 Claude/Codex/Grok × 多机 us-m4/xian-m4/xian-m1 × 执行体）另立 /architect 任务，本文件「七、刀2」只留接口约定。

## 一、为什么干（一句话）

任务等 CI 时容器已退、内存归零，但派发闸数的是 in_progress 任务数 → "4/4 纸面满"而机器空转；且 cap 是猜出来的常数而非从资源算出的函数；同时产能领域已攒了多套平行系统，本战 = 合并收权 + cap 函数化，不是加第五套。

## 二、考古结论（已做完，勿重复）

| 系统 | 文件 | 现状 |
|---|---|---|
| **slot-allocator（收权主体）** | `packages/brain/src/slot-allocator.js`（608 行） | 原始智能判定：evaluateMemoryHealth（区分 Brain RSS 泄漏 vs 系统水位）、背压、用户会话检测、codex 池、队列深度；dispatcher.js:288 已在调 `calculateSlotBudget()` |
| harness 任务数 cap（拆除对象） | `dispatcher.js:55-102`（MAX_CONCURRENT_HARNESS_INITIATIVES=2，shouldApplyHarnessCap，判定现场 dispatcher.js:555） | 后加的粗 OOM 防线，纸面满元凶；降级为 TASK_CAP=12 纯兜底 |
| **quota-guard（初版漏查，额度收编对象）** | `packages/brain/src/quota-guard.js`（dispatcher.js:260-284 已接线） | 已实现：最优账号 5h 已用 >98% → 停全部派发；>90% → 仅派 P0/P1；1min 缓存 fail-open。**禁止在 slot-allocator 里重写一份** |
| tokenExhausted（额度第三处） | `slot-allocator.js:475-486`（getTokenPressure） | 全账号耗尽才挡。与 quota-guard 口径不同，刀1 保留现状不动，刀2 统一归账号池 |
| capacity-budget API | `routes/capacity-budget.js` | PR 吞吐自校准（planner 侧），保留；本战给它加 machine_vitals 段 |
| fleet-cache effectiveSlots | `fleet-resource-cache.js` | 跨机器维度，本战不动（刀2 的机器轴骨架） |

实测数据（07-17）：relay 容器平时 300-400MB、峰值顶各自硬限（当前档 1G，两个在跑的都顶过）；OrbStack 固定 5.4G；前台 6 slot 共 1.7G；CPU 87% 空闲。

## 三、改法（判定唯一入口 = slot-allocator，cap = 函数）

1. slot-allocator 新增 `harnessSlotCheck(machine='local')`（签名带 machine 参数按机器分桶，刀1 只实现 local）。**放行条件 = 拟占用数 < 动态 cap**：

   ```
   动态 cap = min(
     内存余量 ÷ 新容器资源档位,   # 档位取 spawn/middleware/resource-tier.js 的档（当前 relay 档 1G）；内存余量 = OrbStack VM 可用内存（docker 侧采样，非宿主 os.freemem）
     账号派生天花板,               # Claude 可用账号数 × 每账号安全并发 2（当前 2 账号 → 4；将来加账号自动涨）
     HARD_CAP                     # 失控兜底，默认 8，env 可调
   )
   拟占用数 = 活 relay 容器数（docker ps 前缀 cecelia-relay- 计数）
            + 宽限期内已派发但尚无对应容器的 harness in_progress 数（防超发窗口，宽限期默认 5min）
   ```

   查询失败保守按满拒发。
2. 复用 `evaluateMemoryHealth`（已有）：memory_pressure（=Brain RSS halt，2026-04-18 pivot 语义**不许改回"系统低内存就挡"**）→ 拒；**新增数据盘 >85% → 拒**（宿主盘 + OrbStack data 盘两个都采——07-15 事故是宿主盘）。注意：内存/盘是护栏不是主力，relay 容器 OOM 发生在自身 cgroup 硬限内，宿主内存健康与否防不了它，真正治病的是容器计数。
3. 额度两维：codex 闸（已有，保留）；**Claude 侧收编 quota-guard**——`harnessSlotCheck()` 调 `checkQuotaGuard()` 复用其结果（>98% 拒 / >90% 降级仅 P0P1），**禁止新写第二份 5h 阈值判定**；tokenExhausted 保留现状不动。
4. `shouldApplyHarnessCap` 改为调上述，旧任务数判定降级 TASK_CAP=12 兜底；**判定唯一入口收归 slot-allocator，dispatcher 不留第二套**；cap 覆盖范围保持现状：`harness_initiative` + `golden_path_proposal`（dispatcher.js:98-99）；**resume（resume_from_checkpoint=true）豁免保留**，但前置依赖 = relay-watchdog 已清旧容器（否则同 initiative 双容器），必须有回归测试盯这条。
5. 体征采样（df / docker 计数 / VM 内存）挂 scheduler-jobs（`scheduler-jobs.js` JOBS 数组，60s 循环）定期写缓存，判定读缓存（不在派发热路径现场跑命令）。**缓存过期语义**：缓存年龄 > 2×采样周期 → 保守拒 + 日志 verdict 标 `stale`；stale 持续 >15min → 升 P1 告警（防"采样 job 死了 → harness 永久静默停摆"的新静默失败形态）。与磁盘哨兵 ba6fe51c 共用同一缓存，勿重复实现 df 采样。
6. capacity-budget API 加 `machine_vitals` 段暴露同一缓存（指挥舱 80a5be84 首页可视化直接吃）。
7. 日志每轮：`slot_check containers=X inflight=Y cap=Z(mem=A acct=B hard=C) vitals=ok|<超阈项>|stale quota=ok|low verdict=`（静默失败绝版；cap 三个分量都打出来，事后可判是哪个分量卡的）。

## 四、测试铁律（血泪口径，全部有案底）

- **先写 failing test**（两条主线）：
  - 收权线：8 个 in_progress + 活容器 2 + 体征好 + 额度足 → 现版本（任务数闸）拒发（failing）→ 合并后放行；
  - 函数化线：活容器 4 但各只占 300MB、VM 余量充足 → 固定 cap=4 拒发（failing）→ 动态 cap 放行（这就是 Alex "明明有内存却被 cap 卡死"的直接复现）；
- 回归：动态 cap 算到 4 且活容器 4 → 拒；内存余量只够 1 档 → cap 压到 1；memory_pressure → 拒；盘 >85% → 拒；docker 查询抛错 → 保守拒；缓存 stale → 保守拒 + 日志标记；**超发窗口**：派发 1 条后容器未起，同 tick 窗口内再来候选 → inflight 计数挡住；**resume 豁免**：cap 满时 resume 放行 + 旧容器已清前提的双容器防护；
- **禁 mock 判定函数与数据源之间的边**（A4/A5/A6/金丝雀四连案底：mock 真实命令行为=必出哑火）；**容器内交付必须容器内实弹一发**（宿主验证≠容器可用已四例）；
- slot-allocator 既有测试全过；brain 版本 bump。

## 五、验收

- 生产日志出现 slot_check 全维原文（含 cap 三分量）；
- 复现今天场景：多任务等 CI 时新任务仍被派发（活容器+inflight < 动态 cap）；
- 复现"有内存被 cap 卡"场景：4 活容器低占用 + VM 大余量 → 第 5 条放行（HARD_CAP 内）；
- `curl /api/brain/capacity-budget` 返回 machine_vitals 段。

## 六、数据源

- 任务：beeba317-20b9-42bf-aa29-730956b1341f（thin_prd 已同步 v2 口径）；memory：harness-lifecycle-gates-shipped（07-17 段）、dynamic-capacity-model、feedback_reuse_integrated_notion_db（禁平行轮子）
- 相关在飞：磁盘哨兵 ba6fe51c（资源守卫近亲，共用 scheduler 缓存）

## 七、刀2（选择系，本任务不做，另立 /architect）

将来形态 = 三轴分配器：**机器轴**（us-m4/xian-m4/xian-m1，fleet-resource-cache 是骨架）× **账号轴**（provider 无关账号池：Claude/Codex/Grok 同构，quota 采集+auth 熔断+按余量选号；现状 Claude 三套碎片 quota-guard/account-usage/tokenPressure 届时统一收编）× **执行体轴**（每机活容器/进程 admission，即刀1 建的 harnessSlotCheck）。任务带需求（provider 约束/机器约束/资源档位）→ 三轴匹配输出 (machine, account, admit)。刀1 给刀2 留的接口：`harnessSlotCheck(machine)` 分桶签名 + "账号派生天花板"从账号数计算（加账号=池里加一行，cap 自动涨）。刀2 牵动 task-router/account-usage/fleet-cache 三域，独立 PRD 走 /architect，禁塞进 beeba317。
