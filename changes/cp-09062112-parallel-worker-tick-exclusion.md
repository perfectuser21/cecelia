## Brain {VERSION} — worker 池任务对 kernel tick 隔离(并行血管 P1 补丁)

- `payload.parallel_worker=true` 的任务从 kernel tick 候选谓词排除(同 headed_manual 模式)——09-06 金丝雀实证:tick(2min)必快过 worker-pool job(5min gate),两派发器猎同池
