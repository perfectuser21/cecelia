# 设计：死人开关加固（日志时间戳 + docker 引擎看门狗）

## 背景
07-07 凌晨 OrbStack 引擎卡死 5.5h（GUI 显示引擎"活"但实际死），brain-keepalive 只管容器管不了引擎；
事故复盘时日志无时间戳，定位靠猜。来源：docs/handoffs/202607070628-relay-baton3.md item3。

## 改动范围
`scripts/sentinel/dead-man-switch.sh` + `packages/brain/scripts/smoke/p1pr2-deadman-trigger-backup-smoke.sh`（纯 bash 脚本，无 Brain 核心代码改动）。

## 设计

### 1. 日志时间戳
新增 `log()` 函数：`log() { echo "$(date '+%m-%d %H:%M:%S') $*"; }`，替换脚本内所有面向人类的 `echo` 输出（bark 内部提示、alert_dedup 提示、结果行）。写入 STATE_FILE 的数据行不受影响。

### 2. docker 引擎自愈检查
新增 `docker_engine_check()`：
- `timeout 10 docker ps` 通 → 清对应 dedup 状态文件，返回
- 不通 → log 提示 → `orbctl start`（忽略退出码）→ `sleep "$DOCKER_ENGINE_RETRY_SECONDS"`（默认 60，可覆盖）→ 再测一次
- 仍不通 → 走独立 dedup 状态文件（`/tmp/dead-man-switch.docker-last-alert`，复用 REALERT_MINUTES 冷却）→ Bark「docker 引擎死亡且自愈失败」
- 该检查与既有 DB 哨兵检查相互独立，互不阻断（docker 挂但 DB 恰好还连得上/相反 都各自告警）

放在既有 EXPECT_KEYS 查询之前执行一次，不影响脚本原有 exit code 语义（docker 检查失败不 exit，继续走后面的 DB 检查）。

### 3. smoke 断言（新增两条）
- 时间戳格式存在：grep 脚本含 `date '+%m-%d %H:%M:%S'`
- orbctl 自愈分支存在：grep 脚本含 `orbctl start`

### 4. proven-to-fire（两次实测，非自动化测试，人工执行记录在 handoff 里）
- 交互 shell：`STALE_MINUTES=0 bash dead-man-switch.sh` → 必报（沿用既有验证方式）+ 手动断网/停 docker daemon 验证 docker 分支报警一次
- cron 版：临时 `* * * * * STALE_MINUTES=0 bash <repo>/scripts/sentinel/dead-man-switch.sh` 条目，等一分钟确认真收到 Bark，测完撤

## 不改动
- 不改 launchd plist（沿用现有）
- 不改 EXPECT_KEYS/哨兵键机制本身

## 测试策略
Trivial 档：bash 脚本，用 smoke.sh 断言（grep 静态检查 + bash -n 语法检查）作为红绿判据；无需 vitest。TDD 顺序：先在 smoke.sh 加两条新断言（红：当前脚本不含时间戳/orbctl）→ 再改 dead-man-switch.sh 让其变绿。
