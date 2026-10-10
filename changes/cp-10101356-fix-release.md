## Brain {VERSION} — 发布线审查修复：没有可退目标时也告警（去重）

- `lib/release-line-rollback.js` 自动退回评估：连续失败、又没有曾收敛的可退目标（`rollback_unavailable`）时，生产版从未收敛也发 P2 告警 `activity_production_rollback_unavailable:<activity>`（曾收敛的仍 P1），不发 Bark、不改指针。落实主理人原话「没有则只告警（去重）不退回」；此前未收敛生产版只写日志，而今天裁判表没有任何收敛，等于这条告警整体失效。
- 防刷屏沿用已有去重：同一 Activity + 同一生产版 24 小时内、期间没有全绿运行只记一次事件、只告警一次；告警 fire-and-forget，出错不影响裁判落库与返回。
