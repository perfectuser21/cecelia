# launchd-patrol 设计：宿主机 launchd 服务巡检哨兵

日期：2026-07-12 ｜ 任务：a5a6209a（P2，系统性排查 launchd 静默禁用）｜ 路径 B 小改动

## 背景

launchd 服务被静默禁用/不加载已两次独立引发多天无告警的生产故障：

1. 2026-07-08~07-11：zenithjoy-api（本机 5200）宕机近 3 天，公网 `/api/*` 全 502 无告警。根因之一是本机 **gui/501 域不存在**（`launchctl print gui/501` 恒 125，sudo 同样），`~/Library/LaunchAgents` 里所有 plist（api + 两个 keepalive）**在这台机器上永远不会加载**。
2. 2026-07-10（T17，PR #3768）：`com.cecelia.bridge` LaunchDaemon 被 launchd 持久标记 disabled，thalamus LLM 链路全断。

两次事故共同缺口：没有任何机制核对"预期常驻服务清单 vs launchd 实际状态"。

## 本机盘点结论（2026-07-12）

| 服务 | 域 | 实际状态 | 判定 |
|---|---|---|---|
| com.cecelia.bridge | system | loaded, running, enabled | ✅ 应常驻 |
| com.cecelia.bridge-keepalive | system | loaded（周期） | ✅ 应常驻 |
| com.cecelia.token-refresh | system | loaded | ✅ 应常驻 |
| com.cecelia.pf-firewall | system | loaded | ✅ 应常驻 |
| com.cecelia.frontend | system | **disabled** | 判废弃（5211 已由 docker Dashboard 服务，启用会端口冲突；判定点决策 6e9db0a8） |
| com.n8n | system | disabled | 废弃 |
| ~/Library/LaunchAgents/*（约 20 个） | gui/501 | **域不存在，全部永不加载** | 结构性问题；zenithjoy-api 现靠 PPID=1 nohup 孤儿跑 |
| Brain（docker cecelia-node-brain） | — | unless-stopped, running | ✅（launchd 外，由 docker 管） |

T17 三根因复发核对：bridge enabled+loaded ✅ / keepalive 脚本域名修复已在 main ✅ / codex `--skip-git-repo-check` 已在 main ✅ —— 无复发。

## 方案（已比选）

- A. launchd 侧再加一个 watchdog LaunchDaemon —— 否：用 launchd 守 launchd 是循环依赖，服务被禁用时守卫自己也可能被禁用（正是两次事故的形态）。
- B. **Brain scheduler job（选定）** —— Brain 在 docker（unless-stopped），存活性与宿主 launchd 独立；scheduler-jobs 注册表自带错误隔离/timeout/死人哨兵。
- C. 外部拨测（HK/cron）—— 覆盖面只有端口，看不到 disabled 状态，作为后续补充不替代本方案。

## 设计

新文件 `packages/brain/src/launchd-patrol.js`，注册进 `scheduler-jobs.js` JOBS（`needsPool: false`（handler 不直接用 pool；Bark 去重走 notifier 自己的 DB 通道））。

### 巡检逻辑（每 15min，模块自 gate）

1. **Gate**：模块级 `lastRunAt` 内存间隔 gate（照 receipt-collector.js:78-81），env `LAUNCHD_PATROL_INTERVAL_MS` 可覆盖，`__resetLaunchdPatrolForTest()` 供测试复位。
2. **宿主执行**：`/.dockerenv` 存在 → ssh 逃逸（`CECELIA_HOST_EXEC_SSH || administrator@host.docker.internal`，`-i ~/.ssh/id_ed25519`，BatchMode 三件套 + ConnectTimeout=10，照 staging-e2e-runner.js:640-666）；否则本地直跑。execFn 参数注入供单测 mock。已验证：容器带 openssh-client（Dockerfile:24）、`.ssh` 只读挂载（docker-compose.yml:56）、relay 生产同链路反复跑通、非 root 可读系统域（宿主实测 exit 0）。
3. **核对项**（manifest 内置常量；测试通过 exec 注入 fake，不需要 env 覆盖）：
   - `MUST_RUN_DAEMONS = ['com.cecelia.bridge']`：`launchctl print system/<label>` 须 `state = running`；且不在 `launchctl print-disabled system` 的 disabled 集合。
   - `MUST_LOAD_DAEMONS = ['com.cecelia.bridge-keepalive', 'com.cecelia.token-refresh', 'com.cecelia.pf-firewall']`（周期型，无常驻 pid）：`launchctl print system/<label>` exit 0 且不 disabled。
   - `MUST_LISTEN_PORTS = [{port:3457, name:'cecelia-bridge'}, {port:5200, name:'zenithjoy-api'}]`：宿主 `nc -z localhost <port>`（双信号判定点决策 d172e54a：端口探测抓 launchd 管不到的 nohup 孤儿宕机）。
   - `EXPECTED_DISABLED = ['com.cecelia.frontend', 'com.n8n']`：出现在 disabled 集合属预期，不告警；若被人重新 enable 也不告警（只管"该活的活着"）。
4. **告警**：任一异常 → `sendBark('launchd巡检异常', <明细>, { dedupeKey: 'launchd-patrol:' + <异常指纹排序join>, dedupeTtlSec: 6*3600 })`（DB 级跨重启去重）+ `raise('P1', 'launchd_patrol_anomaly', <明细>)`（进小时汇总通道）。ssh 本身失败 → 不告警服务异常，返回 `{ ok:false, reason:'host_unreachable' }`（fail-open，照 harness-skill-relay.js:375 哲学；连续不可达由 scheduler 哨兵/战报兜底观测）。
5. **返回值**：`{ checked, anomalies: [...], skipped? }`，由注册表截 500 字符写 sentinel `scheduler_job_last_run:launchd-patrol`（死人开关观测通道，任务要求的 dead-man 语义由此承接）。

### 测试策略（integration/unit 档）

- unit：`__tests__/launchd-patrol.test.js`，execFn 注入 fake 输出——
  - disabled 检出：fake print-disabled 含 `"com.cecelia.bridge" => disabled` → anomaly；
  - 未运行检出：fake print 无 `state = running` → anomaly；
  - 端口失败检出：fake nc exit 1 → anomaly；
  - 废弃名单：frontend disabled → 无 anomaly；
  - gate：间隔内二次调用 skipped；
  - ssh 不可达：execFn throw → `{ok:false}` 不产生服务 anomaly。
  - proven-to-fire：以上每条都是"坏状态必须报红"的正向断言，注释掉核对逻辑即红。
- 注册表：`scheduler-jobs.test.js` 五处硬编码名单/计数同步 +1，vi.mock 加一条。
- 部署后 smoke：容器内实测一条 ssh launchctl（见 Research 第 5 条命令）+ 查 sentinel。

### 哨兵死规矩对照

- 接缝类型：环境接缝（真宿主 launchd）→ 守卫形态 = 运行中程序的周期自检（本 job 本身就是守卫），CI unit 只守解析/判定逻辑。
- proven-to-fire：部署后在宿主临时 `sudo launchctl disable system/com.cecelia.pf-firewall`（低风险服务）→ 等一轮巡检看 Bark 真响 → 立即恢复 enable。验收必做。

## 运维修复（本次一并执行，非代码）

1. zenithjoy-api 从 nohup 孤儿迁为**系统域 LaunchDaemon**（gui 域不存在 → LaunchAgents 不是可用通道；bridge 已证明 system+UserName=administrator 模式可行）：plist 拷贝到 `/Library/LaunchDaemons/com.zenithjoy.api.plist` 加 `UserName`，root:wheel，kill 孤儿 → `bootstrap system`，`curl localhost:5200/health` 验证。秒级 502 窗口。
2. 巡检 manifest 的 5200 端口项在迁移前后都成立（端口探测与进程管理方式解耦）。

## 不做（YAGNI / 另立）

- 不迁移其余 ~18 个 LaunchAgents（逐个判废弃/迁移是独立盘点任务，manifest 先只守已知生产关键面）；
- 不做外部公网拨测（另立）；
- 不做 manifest 的 DB 化/API 化（两次事故的服务集合稳定，常量够用）。
