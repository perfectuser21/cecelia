## 容器名按 taskId 固定 → GAN 多轮撞名 exit 125 → proposer 没 push（2026-06-02）

### 根本原因

docker-executor.js `containerName(taskId)` 容器名只按 taskId 算，harness GAN 同一 task 的每轮 proposer/reviewer 复用同名容器 `cecelia-task-{id12}`。配合 `--rm`（退出后 docker 异步删除），`docker run` 一返回上层立刻 spawn 下一轮同名容器——上一个还没删完 → "Conflict. container name already in use" → exit 125 → 该轮 proposer 根本没启动 → 没 push 分支 → verifyProposer 报 proposer_didnt_push → GAN 空转。

这才是之前误判成"429 烧账号"的真因。账号始终健康；是容器名冲突让 proposer 间歇性不启动。

### 下次预防

- [ ] 复用资源名（容器名/锁/临时文件）+ 异步清理（--rm）= 必有冲突窗，跑前要幂等清残留
- [ ] docker exit=125 = 容器没启动（名字冲突/镜像缺失），不是任务逻辑失败，要单独识别
- [ ] 排查"间歇性失败"先看资源名是否唯一，别先怀疑配额/网络（我这次错判 429 的教训）
- [ ] 断言根因前先做最便宜的验证（如直接跑账号确认是否真限流）
