# Bug PrepPRD:孤儿 run 复活 + spawn-guard 死锁解(TOP2 刀1)

> task f4f28298-f74b-4752-98e9-0b136e11fdf5;Alex 拍板选 A;anchor journey=2fa4d085(F2) none-step

## 症状(2026-08-07 晚,三条 harness_initiative 全灭)
W2(0b7df1ca)/W3(6548d9bf):spawn 后容器死 → orphan-guard 收割 requeue → dispatcher 重派被 active_run_guard 拒(initiative_run 活跃行未清,"refusing duplicate spawn")→ relay-watchdog 重点火失败(undefined)→ requeue 3 次超限终态 failed。W1(557c8bf4)容器 cecelia-relay-557c8bf4-d4ce55aa spawn 后消失(docker ps -a 无,已被 rm),task 仍挂 in_progress 假活。

## 根因假设(按优先级,须逐一证伪/证实——先 systematic-debugging)
H1 死锁(证据充分):orphan-guard 收割 task 时不终态化对应 initiative_runs 行 → requeue 后 spawn-guard 按活跃 run 拒重派 → 永死循环。executor.js/orphan-guard/spawn-guard 三方接缝。
H2 容器死因(待确诊,forensic 已灭失——容器被 callback router 主动 rm,logs 没了):候选 a)容器内 claude 进程早退/崩(与 Brain 重启期 API 不可达有关?Brain 19:30 北京重启过) b)callback 报 phase 后容器正常退出但任务语义未完成 c)janitor 误清。日志线索:relay-watchdog "cause=unknown"、callback router 日志、harness-relay-watchdog.js。
H3 memory 钉死的部署屠杀(kernel detached 子进程在 Brain 容器内 spawn 的形态)是否也适用本次 relay 容器形态——relay 是独立 docker 容器,理论上 Brain 重启不带走它,须证实或排除。

## 修法(三件,每件 failing test 先行)
① orphan-guard 收割时同步把对应 initiative_runs 终态化(failure_reason='container_orphaned'),spawn-guard 只认非终态 run——死锁解。
② startup-sync 孤儿复活:Brain 启动时扫 phase 非终态且无活容器的 initiative_runs → 终态化旧 run + 对应 task 安全回 queued(infra 死因例外于"failed 不能回 queued"规则,requeue 计数重置,留痕 detail.revived_from)→ 下一 tick 重新派发干净重跑(tmpfs 无断点,不做续传)。
③ forensic 保全:callback router / 收割器 docker rm 前先 docker logs 落盘(如 /var/log/cecelia-relay/<container>.log 或 host 卷),死因不再灭失。
H2 确诊后若是 Brain 重启期 API 不可达致容器内进程崩:relay 容器内的 Brain API 调用加重试(指数退避 ≥2min 覆盖部署窗口)——按诊断结果决定是否本单修。

## Regression Test 计划
①死锁:集成测试造"活跃 run+无容器"态,断言 orphan 收割后 run 终态化+重派不被拒;②复活:启动扫描单测(mock docker ps)断言孤儿 run 终态化+task 回 queued+requeue 计数重置;③forensic:rm 前 logs 落盘断言。proven-to-fire:每个守卫先看它红。

## 验收标准
- [ ] 三条 failing test 先 commit 后修复变绿,永久进 CI
- [ ] W1(557c8bf4)假活任务被启动扫描复活或本单手工处置留痕
- [ ] DevGate 三件套;版本 bump(1.270.0→1.270.1 patch 或 1.271.0 若含 migration);smoke 登记 allowlist(上两单的教训)
- [ ] H2 死因确诊结论写进 PR body(证据链)
