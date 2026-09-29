## Brain {VERSION} — 熔断打开时派发不再整轮放弃

- dispatcher：cecelia-run 熔断打开时只跳过依赖 bridge 的那一条候选，继续选下一条（与 no_executor 分支 0014cd42 同规矩，独立跳过列表，候选耗尽/达上限仍报 circuit_breaker_open）。修 09-29 P1 bridge 任务每轮占队头被弹回、11 条 qiumi_task 一上午派不出去（任务 4c6c0f01）。
