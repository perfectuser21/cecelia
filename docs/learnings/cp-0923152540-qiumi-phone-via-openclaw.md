# 秋米手机活改走 OpenClaw agent：device_job 派生封存为开关（2026-09-23）

## 根本原因

- 「链路通了」和「手机活能跑」是两回事：Notion → Brain → OpenClaw agent 对非手机活已跑通，但 Brain 对手机活有一条改道——Jev 判 `is_device` 就派生 `device_job` 给西安领单器。领单器不是 AI，只认 `harvest_keyword / outreach_round / dm_one` 三种结构化单，Brain 又不填 `params`，自由文本手机活（「在 X 手机上截个屏」）到那里必回「不认识的活」。9/21 两条 EXEC_RC 失败同源。
- 这条改道是 PR3 按「手机活由旧脚本跑」的假设设计的（补充五），主理人 0923 拍板改成一条链。OpenClaw 侧其实早就具备条件：XIAN-M4-PHONE / XIAN-M1-PHONE 节点已配对且 `system.run` 可用、两台节点 exec 白名单已放行 `douyin-phone-adb`、media 部门 agent 已加载 `douyin-phone-runtime` skill——缺的只是 Brain 别截走。
- CI 闸 `lint-feature-has-smoke` 看的是 **commit subject** 的 `feat:` 前缀（不是 PR 标题），触及 brain/src 就要新增真环境 smoke。改前缀躲闸不诚实，正确做法是补 `qiumi-phone-agent-smoke.{sh,mjs}`。
- 开关默认关会把既有 `qiumi-routing-smoke.sh`（验 device 派生层）打成 12 项假红——smoke 实现者跑真库时抓到的，固定单测命令看不见。
- 终审抓到：Jev 含糊（ambiguous）时 `is_device=false`，prompt 一个字设备信息都没有，而这正是旧 fail-closed 挡的那类活；补了「可能要碰真机，先自查」提示段。

## 下次预防

- [ ] 「已打通」必须按任务类别逐条验：非手机活跑成 ≠ 手机活跑成。写清哪类活走哪条执行体，谁是 AI 谁是死脚本
- [ ] 封存旧路用开关而不是删代码：`QIUMI_DEVICE_DELEGATION_ENABLED` 只认字面 `'true'`，回滚只需写 env 重建容器（runbook 已记）
- [ ] 判定层换默认值时，同层的真库 smoke 要显式固定它验的那条路（`export` 开关），否则默认值一变全红
- [ ] 带 `feat:` 前缀的 brain/src 改动，PR 内必须新增 smoke；smoke 要 proven-to-fire（改期望值看它红）
- [ ] fail-closed 改 fail-open 时，把原来「挡住」的那类输入转成对下游的显式提示（device_hint / ambiguous 段），不能静默吞掉
- [ ] 上机后运维：上机前已路由的在途手机活拿不到 `device_hint`；已 `blocked/delegated_device_job` 或 `failed: device_uncertain` 的行不自动回流，按需手工放回 queued
- [ ] 生产复验前确认 `QIUMI_SYNC_ENABLED/QIUMI_DISPATCH_ENABLED` 都开（两者关时入账即 `headed_manual=true`，探针永不派发会被误读成链路不通）
