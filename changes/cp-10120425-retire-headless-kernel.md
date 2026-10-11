## Brain {VERSION} — 关闭 harness_initiative 无头 kernel 派发入口

- 无头 kernel 自 09-30 起派发全败（30 天 372 次 / 112 单 kernel_authority_not_created，最后一次成功派发 09-30）。dispatch-route 对无头 harness_initiative 判 retired-harness-kernel（注册表 surface=none，新标签 headless_kernel_retired），dispatcher drain 段把 queued、未认领、非有头的 harness_initiative 终态 failed（error_message=retired_harness_kernel），不再进 kernel 派发。有头账本行（headed_manual 字符串或布尔）不受影响；golden_path_proposal 不动；建单入口本步不收紧（编码建单方改投 coding_workflow 之后再收）。任务 dacd75f3。
