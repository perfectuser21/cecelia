## Brain {VERSION} — 排空（drain）运行期超龄自愈

- drain.js isDraining()：排空超过 DRAIN_RESTORE_MAX_AGE_MS（15 分钟）即按部署残留自动解除并清持久化行。修 09-29 部署后 drain-cancel 静默失败、新容器恢复 drain、运行期再无解除路径导致派发停摆（两次部署后秋米 11 条积压，任务 d78898ff）。
