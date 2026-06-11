# Sprint PRD — 取证文件防覆盖（cecelia-prompts 按运行实例命名）

## OKR 对齐

- **对应 KR**：Deterministic Gate — harness 可复现性 / 排障能力
- **当前进度**：Initiative 第 2/7 条 Run
- **本次推进预期**：同任务重跑取证文件共存，不再互相覆盖

## 背景

harness agent 容器的 prompt 与 stdout 取证文件以 CECELIA_TASK_ID 命名（如 `ws1.prompt` / `ws1.stdout`），同一任务重跑原地覆盖上一次文件。2026-06-11 实证取证丢失：skill-drift evaluator 第一次完整输出被恢复期重跑清零，排障只能靠人工手拷。

## Golden Path（核心场景）

用户/运维从 [连续 spawn 同一任务两次] → 经过 [取证文件按运行实例写入各自独立路径] → 到达 [cecelia-prompts 目录内两组文件共存，任意历史运行均可查阅]

具体：
1. 同一 sub-task 触发两次容器 spawn（重跑场景：fix round / Brain 重启恢复）
2. 每次 spawn：宿主侧写出含运行实例标识后缀的 `.prompt` 文件；容器内 entrypoint 读到属于自己这次运行的 prompt，执行完毕后将 stdout tee 到含相同实例标识后缀的 `.stdout` 文件
3. 两次 spawn 结束后：`ls cecelia-prompts/ | grep <task前缀>` 能看到两组各自独立的 `{taskId}.{实例标识}.prompt` + `{taskId}.{实例标识}.stdout`（或等效命名，任意后缀方案均可，只要能区分轮次）
4. 最新一次运行有稳定入口（固定名 symlink 指向最新，或 `ls -t` 排序即可）
5. 用新镜像真实运行一个容器端到端跑通，容器内 entrypoint 正确读到属于本次运行的 prompt 并正常产出 stdout 文件

## 边界情况

- 第一次运行（无历史）：应正常产生一组文件，命名规则与有历史时一致
- 实例标识冲突（同秒并发 spawn）：命名方案须保证两次并发 spawn 不写同一文件名
- 按 task id 前缀 grep/ls 仍能命中所有历史运行（不能因引入后缀而破坏现有排障习惯）
- host-executor.js 中同名写入机制需一并覆盖

## 范围限定

**在范围内**：
- docker-executor.js 宿主侧 prompt 文件写入路径（含实例标识后缀）
- docker-executor.js → entrypoint.sh 协议：完整文件名经 env 传入容器，entrypoint 不再自行拼名
- host-executor.js 同步改写
- docker/cecelia-runner/entrypoint.sh 适配新协议
- runner 镜像重建 + 新镜像容器实测（E2E 验证步骤含此项）

**不在范围内**：
- 自动磁盘清理（janitor 已有巡检，不在本 sprint）
- 其他 executor（codex / decision 等）的取证机制
- 文件压缩或归档策略

## 假设

- [ASSUMPTION: 实例标识后缀优先使用时间戳（精度到秒或毫秒）或容器 ID 前缀；具体格式由 proposer 决定，Planner 不约束]
- [ASSUMPTION: Brain API 在本 sprint 运行时处于 local_api 模式（localhost:5221），镜像重建在同一宿主完成]
- [ASSUMPTION: HOST_PROMPT_DIR 环境变量在宿主侧已正确配置，entrypoint mount 路径 /tmp/cecelia-prompts 不变]

## 预期受影响文件

- `packages/brain/src/docker-executor.js`: writePromptFile + cidFilePath + env 传参逻辑
- `packages/brain/src/spawn/host-executor.js`: prompt 文件写入路径
- `docker/cecelia-runner/entrypoint.sh`: PROMPT_FILE / STDOUT_FILE 改从 env 读完整路径而非自行拼接

## E2E 验收

> Planner 初稿此区块为占位，最终可执行脚本由 proposer 在 GAN 阶段产出（target_environment=local_api，bash 脚本）。

```bash
# 占位：proposer 将按 local_api 模板填入真实脚本
# 期望验收点（自然语言）：
# 1. 调用 spawn 逻辑两次（可用测试桩），cecelia-prompts 目录出现两组文件，文件名含各自运行标识
# 2. ls cecelia-prompts/ | grep <task前缀> 输出 ≥4 行（2 prompt + 2 stdout）
# 3. 用新镜像 docker run 真实容器，容器读到正确 prompt，stdout 文件写出（ls + head 确认）
# 4. 全部用 bash/ls/docker/jq 完成，无需浏览器或 Windows 环境
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/src/ 后端执行器与 docker entrypoint，无 UI / agent 协议 / engine hooks
## target_environment: local_api
## target_environment_reason: 验证对象为本地 Brain docker-executor + 宿主文件系统，curl localhost:5221 + docker run + ls 即可完成全部验证，无需浏览器或远端机器
## journey_id: d601d256-2094-4d88-8a3c-029f55e91c38
## step_id: forensics-no-overwrite-s1
