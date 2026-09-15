# Handoff：机器路由 ssh 直派上产（PR #5340/#5342）

**verdict: PASS**（1.294.1 上产，直驾全链 E2E 绿：排单→xian-m4 真跑→收割 Done）

## 完成
- **排单自动填机器直接下派**（主理人 09-15 拍板）：dispatch.channel=ssh + machine + command 全落数据行；Brain 经 machine-registry.sshTargetFor 路由目标机 nohup 起批（execFile 参数数组，本地零 shell 解释）；收割器轮询读目标机 ~/brain-runs/<run_id>.exit 收账（目标机零反向依赖）
- 当场修两个 bug：①CodeQL command-line-injection（execSync 字符串→execFileSync 数组）②收割超时时区误判（created_at 被 UTC 容器错解差 7h，刚派发即误收 failed——判据入 SQL INTERVAL）
- 种子 workflow：DirectRunSelfTest（xian-m4 回声自检）；E2E 两轮，第二轮全链绿
- 部署事故与教训：us-vps 盘满两连爆 + MMV arm64 镜像误传（exec format error）致 Brain 宕机 ~10 分钟；已恢复并立新 SOP（memory: usvps-image-build-via-mmv——MMV --platform linux/amd64 交叉构建 save/load，先验后删回滚梯）

## 没完成
- 真业务直驾行未种（采收/触达的 command 参数需主理人给常用值，或由 Manager 归一时接管）
- 排班员互斥粒度=wf_id，machine 维度互斥未做（两条不同 workflow 同抢一台手机时账面无感知，靠 adb lock-acquire 物理兜底）
- push legacy notion_id 400 刷屏未修；AdbIME 输入法故障未查；openclaw-gateway 迁 MMV 待窗口

## 下一步
- 主理人给采收/触达 command 常用参数 → 种真直驾行，排单即真干活
- machine 维度资源锁（排班员 v1.5）；gateway 迁 MMV（窗口待拍）

## 数据源
- packages/brain/src/machine-registry.js（sshTargetFor）、notion-push-sync.js（ssh 分支/reapSshWorkflowRuns）
- ops_workflows.dispatch（channel/machine/command）；~/brain-runs/（目标机 run 现场）
- memory: usvps-image-build-via-mmv.md

## 产物
- PR #5340（ssh 直派）/ #5342（时区修复）+ bumps；生产 1.294.1
