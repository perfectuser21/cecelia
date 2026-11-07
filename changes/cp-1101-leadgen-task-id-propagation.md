## Brain {VERSION} — 获客中央设备锁任务身份传递

- Brain 派发 101/102 时，将已登记且核验的原 Task UUID 注入正式获客子进程的 `WF_BRAIN_TASK_ID`。子进程清除继承的旧 `BRAIN_TASK_ID`，避免错误身份与中央锁冲突；隔离回归直接执行冻结控制器生成的 Python 启动器，验证真实子进程收到当前 Task UUID。
