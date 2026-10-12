---
type: fix
scope: phone-rpa
---

比价领单器统一租约守卫：409后停止业务、抑制迟到结果，精确owner停止标记保留设备finally清理；永久Node/Python回归纳入CI。

消费者四文件由 lease-migration 中的固定 SHA256 文本 patch 发布；apply.py 在任何现场写入前核完整基线及产物哈希，保留备份并回滚写入失败。以实际部署副本为基线隔离应用，执行已有 Node/Python 回归；不引入旧 Draft PR #6117 的其他改动。
