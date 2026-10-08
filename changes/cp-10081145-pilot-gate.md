## Brain {VERSION} — 试点发布门禁修复：口径恢复为只认 CI 回归登记，回归格归还消费者能力

- 试点发布验证（pilot-release-verification）：只认 registerCapabilityRegression 写的 CI 回归登记（scenario + cell_key regression:%）；element/probe 由运行时探针负责，不进门禁（迁移 520 无意放宽的口径恢复到 10-04）。regression 行 assertion_ref 为空视为未声明，对应用法照报 pilot_regression_missing；引用非法照记 pilot_assertion_invalid。
- 迁移 534：迁移 520「格子跟随所属 Activity」误把共享 Activity 上按消费者登记的回归格（cell_key=regression:<能力>:…）改到 Activity 的能力，按 cell_key 改回（仅限该能力确有生效流程在用此 Activity 的行），先备份再改，附回滚。生产命中 43 行（对标获客 a1000000-…02）。
