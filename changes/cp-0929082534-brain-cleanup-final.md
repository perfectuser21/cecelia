## Brain {VERSION} — 空表清理收尾：6 张连代码删；AI Journey / AI Feature 恢复推送

- 迁移 486：删 topic_decision_feedback、publish_success_daily（D 类「接口都在从没人调用」剩余两张，主理人「全删」）；删 licenses、license_machines、license_credit_transactions、keyword_tasks（ZenithJoy 授权大脑侧空副本，真账在 hk zenithjoy）。非空闸、无 CASCADE、回滚=生产 pg_dump -s。
- 同迁移：AI Journey / AI Feature 两镜子登记恢复 push/active（库 09-27 已从回收站恢复；决策 7a4a41a9 覆盖 24a37029）。
- 同 PR 删代码：topic-heat-scorer 的 saveTopicFeedback / getHighPerformingTopics 及周报、选题调用；发布监控每日快照写入、kr1-kr2-updater 与 tick 调用、/publish/success-rate；license / agent-credit / acquisition 三个无调用方路由及测试、4 个冒烟脚本与名单条目。
- 生产结构副本实测：闸拦截、6 表删除、两登记恢复、回滚复原、重放幂等；相关 69 个测试文件全绿。
