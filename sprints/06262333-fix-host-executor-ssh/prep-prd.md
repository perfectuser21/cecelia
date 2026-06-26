# Bug PrepPRD：harness mac_web 任务全部卡死（host-executor 容器内 spawn claude ENOENT）

## 症状
所有 target_environment=mac_web 的 harness 任务，worktree 建好后 agent 节点零活动空转，
brain 日志反复刷 `[host-executor] error task=ws1: spawn claude ENOENT`，task 卡 in_progress 不前进。

## 根因
Brain 跑在 docker 容器 cecelia-node-brain 里，`host-executor.executeOnHost()` 直接在容器内
`nodeSpawn('claude' | 'bash claude-launch.sh')`。容器内：
1. 无 claude 二进制；PATH=/usr/local/sbin:...:/bin（无 /opt/homebrew/bin）；
2. import.meta.url 在容器是 /app/src/spawn/，repoRoot 错算成 /，launcherPath=/scripts/... 不存在 → 退化为 bare `claude`；
3. env.PATH 被 ...process.env（容器 PATH）覆盖。
→ 三者都使 spawn 必 ENOENT。设计假设"brain 跑裸机主机"，与"brain 在 docker"部署矛盾。

## 关联上下文
- Journey：Cecelia Harness Pipeline（唯一线）
- Issue：cd8bf7e6-b131-4c80-9ca5-b45c38759984
- Decision：a3e6ba4f-2d62-479e-b174-11d289349ec9

## 修法
executeOnHost 检测 /.dockerenv（容器标志）为真时，改为 ssh 逃逸到主机执行：
`ssh -i <host私钥> -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes
 administrator@host.docker.internal "cd <worktree> && env <注入env> bash <host launcher> --dangerously-skip-permissions -p"`
prompt 经 ssh stdin 转发给主机 claude。裸机(无 /.dockerenv)时保留原直接 spawn 逻辑。
配置可被 env 覆盖：CECELIA_HOST_EXEC_SSH / CECELIA_HOST_EXEC_SSH_KEY / CECELIA_HOST_REPO。
已最小验证：容器内 ssh -i id_rsa administrator@host.docker.internal "which claude" → /opt/homebrew/bin/claude。

## Regression Test 计划
host-executor-ssh-escape.test.js：注入 spawnFn + inContainer=true，断言 spawn 的是 ssh、含目标主机、
远端命令含 claude + worktree + 注入 env；inContainer=false 时回退本机直接 spawn。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复让 test 变绿（commit-2）
- [ ] CI 全绿
- [ ] brain-deploy 后真实 mac_web 任务能起 agent（不再 ENOENT）
