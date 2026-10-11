## Brain {VERSION} — 定时实例按模板+时间点判身份，不再被标题查重互锁

- 派发前标题查重（Jaccard≥0.6）对定时实例改按身份判：候选与 sibling 都是定时实例（payload.recurring_task_id）时不算重复。生产 10-12 00:52 复现：5 个不同模板同一时间点各建一张 qiumi_task，标题只差 agent 名，两两判重、都 queued 互相跳过，谁都派不出去。定时实例与手工任务之间、非定时任务之间仍按原标题规则。任务 c8320370（OpenClaw 业务定时搬进 Brain）。
