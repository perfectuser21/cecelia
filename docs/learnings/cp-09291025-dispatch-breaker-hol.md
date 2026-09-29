# cecelia-run 熔断打开时整轮放弃，秋米任务被队头堵死（09-29）

### 根本原因
- dispatcher 熔断分支（needsBridgeCheck && !isAllowed('cecelia-run')）回滚候选后直接 return，整轮放弃。
- 同一函数里 no_executor 分支早在 0014cd42 就改成了「跳过换下一候选」，熔断分支漏改。
- cecelia-run 熔断因 data 类任务反复失败（容器内读 xian-m4 的 codex 账号文件 ENOENT）长期开着；P1 的 data/content-pipeline/project 每轮占队头被弹回，11 条不依赖 bridge 的 P2 qiumi_task 一上午都没轮到。

### 下次预防
- [ ] 派发循环里任何「这一条不能派」的分支都必须跳过换下一条，只有「整体不能派」（排空/全局冷却）才允许整轮放弃
- [ ] 队列里有 queued 任务长时间不动时，先看派发日志的 tick actions 与熔断状态，而不是先怀疑任务本身
