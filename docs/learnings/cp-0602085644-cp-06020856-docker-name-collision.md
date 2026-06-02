## 容器名按 taskId 固定 → GAN 多轮撞名 exit 125 → proposer 没 push（2026-06-02）

### 根本原因

docker-executor `containerName(taskId)` 容器名只按 taskId 算（cecelia-task-{id12}）。
这个名字是 quarantine / startup-recovery / session-bridge 跨系统按 taskId 算出来的
查找契约——不能改成随机名。但 GAN 同一 task 每轮 proposer/reviewer 复用同名容器，
配合 --rm 异步删除留时间窗 → 下一轮 spawn 撞 "container name already in use"
（exit 125）→ proposer 没启动没 push → verifyProposer 报 proposer_didnt_push → 空转。

这才是之前误判成"429 烧账号"的真因；账号始终健康。

### 下次预防

- [ ] 复用确定性资源名（容器名/锁）+ 异步清理（--rm）= 必有冲突窗，复用前要幂等清残留
- [ ] 修复放在"复用发生的那一层"（GAN 节点），不要塞进通用 executeInDocker——后者被
      大量 sequence-based spawn-mock 测试覆盖，插入 spawn 调用会打乱调用序列连环报错
- [ ] docker exit=125 = 容器没启动（撞名/缺镜像），不是任务逻辑失败，要单独识别
- [ ] 断言根因前先做最便宜的验证（直接跑账号确认是否真限流）——我这次错判 429 的教训
