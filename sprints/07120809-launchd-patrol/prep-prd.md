# 小改动 PrepPRD：launchd 服务巡检哨兵（launchd-patrol）+ 已禁用服务修复

## 改什么
1. **新增 Brain scheduler job `launchd-patrol`**（`packages/brain/src/launchd-patrol.js` + 注册进 `scheduler-jobs.js`）：
   - 自带 15min 间隔 gate（沿用模块自 gate 模式）
   - 容器内检测 `/.dockerenv` → SSH 逃逸宿主机执行（复用 `CECELIA_HOST_EXEC_SSH || administrator@host.docker.internal` 先例）
   - 核对内置预期服务清单（manifest）：
     - 系统域 LaunchDaemon 必须 enabled 且 loaded：com.cecelia.bridge（须有 pid）、com.cecelia.bridge-keepalive、com.cecelia.token-refresh、com.cecelia.pf-firewall
     - 端口存活：3457（bridge）、5200（zenithjoy-api，不管进程由谁管）
     - 显式废弃名单（expect disabled，不告警）：com.cecelia.frontend、com.n8n
   - 异常 → raise() P1 + sendBark（Bark=需用户立即处理，符合 feedback_bark 规则）；同异常 6h 内存去重
   - 每轮写 sentinel（scheduler-jobs 既有死人开关观测通道）
2. **运维修复（非代码，本次一并执行）**：zenithjoy-api 从 nohup 孤儿迁移为系统域 LaunchDaemon（gui 域在本机不存在，LaunchAgents 永不加载=结构性根因），关闭"重启即宕"P1 遗留

## 为什么改
launchd 服务被静默禁用/不加载已两次独立引发多天无告警生产故障（07-08~07-11 zenithjoy-api 502 三天；07-10 thalamus bridge 禁用）。缺一个"预期 vs 实际"的核对哨兵。

## 关联上下文
- 相关 Issue：Notion cf4ad211（P1，LaunchAgents 全域未加载）
- 相关历史：PR #3768/#3769（T17）、PR #3037（bridge-keepalive）、memory zenithjoy-api-launchd-outage.md
- decisions/match：无冲突决策

## 判定点登记表
| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 服务健康判定 | 仅 launchctl 状态 / 仅端口探测 / 双信号 | 双信号：launchctl print-disabled+loaded pid 核对 + 关键端口监听 | 单看 launchd 会漏 nohup 孤儿宕机，单看端口会漏"disabled 但暂时还活着" | 误报=告警骚扰；漏报=静默宕机复发 |
| com.cecelia.frontend 判废弃 | 恢复启用 / 判废弃 | 判废弃（进 manifest 废弃名单） | 5211 已由 docker Dashboard 服务，启用会端口冲突；plist 指向旧单体路径 | 若误判，服务保持 disabled 现状，无新增损害 |

## 影响范围
- Brain scheduler 加一个 job，错误隔离由注册表保证，不影响其他 job
- 宿主机：zenithjoy-api 迁移瞬时重启（秒级 502 窗口）

## 验收标准
- [ ] launchd-patrol 单测：manifest 核对逻辑（disabled 检出/未加载检出/端口失败检出/废弃名单不告警）proven-to-fire
- [ ] 生产部署后 sentinel `scheduler_job_last_run:launchd-patrol` 有记录
- [ ] zenithjoy-api 由 LaunchDaemon 管理，`curl localhost:5200/health` 200，孤儿进程已清
- [ ] CI 全绿
