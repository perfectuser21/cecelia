## Brain 意识层守护 SSOT 化（CONSCIOUSNESS_ENABLED）（2026-04-20）

PR: #2447
分支: cp-0419235150-consciousness-guard

### 根本原因

1. **代码层**：`BRAIN_QUIET_MODE` 守护块**只覆盖一部分**意识模块（thalamus / self-drive / dept-heartbeat / 部分 LLM 调用），`proactive-mouth` / `diary-scheduler` / `evolution-scanner(tick)` / `evolution-synthesizer` / `suggestion-cycle` / `conversation-consolidator` / server.js `initNarrativeTimer` / Evolution Scanner setInterval 这些**完全没守护**。注释里承诺"全部跳过"但实现没兑现。
2. **部署层**：`plist` 里声明了 `BRAIN_QUIET_MODE=true`，但 `~/bin/cecelia-watchdog.sh` 脚本重启 Brain 时**不传递任何 BRAIN_* 环境变量**。Brain 崩溃后 watchdog 抢在 launchctl 前用 `nohup node server.js &` 拉起，运行时根本没这个 env → 开关**实质上从未生效过**。
3. **没有 SSOT 判断函数**：`process.env.BRAIN_QUIET_MODE` 裸读散落在 tick.js / server.js 多处，修改要多点联动，容易遗漏。
4. **watchdog 脚本不在 repo**：只存在于主机 `~/bin/`，没有 SSOT，改动无 review、无 CI。

结果：xuxiao 两个 Codex Team 账号 7d 用量被 Brain 后台的 `rumination` + `proactive-mouth` + `evolution-scanner` 持续烧到 100%，而"关闭意识"的开关一直形同虚设。

### 下次预防

- [ ] **新增影响运行时行为的 env 开关时**：强制 SSOT 化（新建 `*-guard.js` 模块 + 导出统一判断函数 + 启动日志声明），禁止任何地方裸读环境变量
- [ ] **CI 加反向 grep**：每个 env 开关必须配套一个 `scripts/check-<feature>-guard.sh` 禁止在 SSOT 文件和 `__tests__/` 之外的地方 `process.env.X` 裸读复活；挂到 ci.yml 相关 job
- [ ] **代码层守护清单必须有自动化校验**：禁止仅用注释声明"XX 模块全部跳过"——必须有 `*-guard.test.js` 静态分析所有目标函数调用点前 N 行内是否有 guard，漏一个就失败
- [ ] **环境变量必须同步三处**：plist / watchdog / install.sh，任何一处遗漏都会让开关失效。最佳做法：watchdog 脚本本身进 repo（`packages/brain/deploy/`），由 install.sh 拷贝到 `~/bin/`，不允许手动编辑主机脚本
- [ ] **反向断言**：守护扩展时要明确列出"**不**该守护"的函数（纯计算/派发依赖类），写反向断言测试（mock + assert called / assert not wrapped in guard regex）——典型例子 `evaluateEmotion` 是纯函数但 `dispatch_rate_modifier` 依赖它，误守护会破坏派发链
- [ ] **主机层脚本永远进 repo SSOT**：`~/bin/*.sh`、crontab 条目、launchd plist 这类 ops artifacts 都必须有 SSOT 版本在 repo，部署脚本自动分发；手写主机脚本 = 不可审计、不可 review、不可回滚
- [ ] **部署+代码开关必须端到端验证**：加 env 开关后必须写一个 `scripts/verify-*.sh` 脚本，真启动进程 + 跑 N 分钟 + grep 日志断言守护日志出现、守护模块日志零输出 + API 功能未受影响。不能只靠 plist 声明就认为生效
- [ ] **deprecation 策略**：改名 env 开关时保留旧名 N 个月兼容窗口 + 一次性 `console.warn`；不要 hard break

### 关联修复

顺手修了 pre-existing 问题（pre-push precheck 拦出）：
- `packages/brain/src/selfcheck.js` EXPECTED_SCHEMA_VERSION 落后 migrations 5 版（234→239）
- `packages/brain/src/brain-manifest.generated.json` 过期，重新生成
- DEFINITION.md §4.6 任务类型表补 3 个漏项（harness_initiative / harness_task / harness_final_e2e）

这些 pre-existing 问题说明：Brain 代码有改动但没走 `node scripts/facts-check.mjs` + `bash scripts/check-version-sync.sh` 的 PR 会被后续 PR 的 precheck 拦住。建议把这两个检查也加到 PR checks 而非只在 local-precheck（hooks/bash-guard.sh）里。
