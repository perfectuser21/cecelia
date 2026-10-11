## Brain {VERSION} — 定时引擎走独立循环（定时精度 3-9 分钟 → ≤30 秒）

- recurring-tasks 从 SERIAL_JOBS 串行轮移入独立 completion 循环（completionCadenceMs=30s，按 job 防重入）。生产实证 10-11 定时实例建单比时间点晚 58s~517s（串行轮长）。为 OpenClaw 业务定时搬进 Brain（任务 c8320370，续 0026dfe2/942491c2）铺路：晨会/班会等业务定时到点准时建单。
