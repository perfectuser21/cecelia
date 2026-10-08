## Brain {VERSION} — 试点发布门禁修复：空骨架格不算 invalid，回归格归还消费者能力

- 试点发布验证（pilot-release-verification）：assertion_ref 为空的格子（v3.0 八格骨架）视为未声明断言，与未匹配同等跳过；非空但解析失败的仍记 pilot_assertion_invalid，期望用法仍只认真实断言覆盖。
- 迁移 534：迁移 520「格子跟随所属 Activity」误把共享 Activity 上按消费者登记的回归格（cell_key=regression:<能力>:…）改到 Activity 的能力，按 cell_key 改回（仅限该能力确有生效流程在用此 Activity 的行），先备份再改，附回滚。生产命中 43 行（对标获客 a1000000-…02）。
