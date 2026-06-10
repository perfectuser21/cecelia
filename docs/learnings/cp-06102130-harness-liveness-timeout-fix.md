# Learning: harness callback 超时误杀健康 generator

## 现象

Line 07 initiative 失败 "Serial gate: ws1 did not merge (status=failed)"，但 generator
worktree 里有 5 个真实 commit —— 它被判死时还在干活。

### 根本原因

1. 超时检查（CALLBACK_TIMEOUT_MS）排在 liveness 检查之前：`claude -p --output-format json`
   只在结束时输出一次，"没有 callback" ≠ "挂死"，必须先问 docker inspect。
2. "没有输出的等待" 与 "真挂死" 的区分只能靠容器活性 + hard ceiling 双信号，单一时长
   阈值必然在长任务上误杀（设计注释自己写了 generator 合法跑 11-89min，real-world
   sprint + fix round 轻松超 100min）。
3. 401 等基础设施失败混在 container_exit 里，fix loop 同账号重试 → 系统性复发。
4. watchdog staleMinutes=3 假设心跳永不抖动；任何 >3min 的事件循环阻塞（execSync 调
   gh/git）都触发 re-claim，产生并发 poller 和 queued 透传。

### 下次预防

- [ ] 任何 "超时 → 判死" 的逻辑必须先验执行体活性（docker inspect / daemon health），
      超时只配 hard ceiling 用
- [ ] LLM 容器失败必须分类（auth / quota / 业务），auth 类要熔断账号再重试
- [ ] 看门狗阈值必须 >> 心跳间隔的最坏抖动（含事件循环阻塞），并在误杀路径留 log
- [ ] 放弃等待时必须回收执行体（docker kill），不许留孤儿容器烧配额
