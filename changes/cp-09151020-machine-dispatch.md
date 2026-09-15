## Brain {VERSION} — 机器路由 ssh 直派：排单自动填机器直接下派

- dispatch 新通道 channel=ssh：machine+command 落数据行，Brain 经 machine-registry sshTargetFor 路由到目标机 nohup 起批（直驾线接进 Notion 排单）
- 收割器 reapSshWorkflowRuns：轮询读目标机 ~/brain-runs/<run_id>.exit 收账（0→Done/非零→Cancelled/超 6h timeout），目标机零反向依赖
- machine-registry 补 us-mac-m4 sshUser；workflow_run 账带 channel/machine 维度
