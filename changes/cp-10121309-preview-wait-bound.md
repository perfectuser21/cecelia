## Brain {VERSION} — coding workflow 预览等待有界

- pending/error 按 PR head 跨 tick 持久计时，超过现有预览等待阈值交 commander；预览恢复或 head 更新后重新计时。
- 永久回归覆盖 pending、网络错误、恢复和 head 更换；不绕过 QA。
