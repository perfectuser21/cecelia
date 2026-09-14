## Brain {VERSION} — 修 syncOpenClawRuns 引用不存在列 finished_at

- ops_runs 真实列为 stopped_at；旧 SQL 次次抛错被 catch，OpenClaw 终态→Notion Status 同步腿从未生效（09-14 生产实证）
- 回归用例断言 SQL 不得含 finished_at
