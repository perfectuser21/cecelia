# Red Evidence — headed-smoke-test (task b30fe42b)

Red 基线：合同测试随 proposer commit 已在分支上（rebase 后 SHA e356387614），未重复 checkout（relay 常态）。

vitest JSON 判定：failed=6 passed=0 total=6（全红，符合预期——工件 smoke-artifact.json 未落地）

```
FAILED | smoke-artifact.json 存在且为合法 JSON 对象
FAILED | task_id 字面等于 b30fe42b-86c7-412e-9e05-eb08ac26488e
FAILED | smoke_tag 字面等于 claude-headed-dispatch-local-31156-4267
FAILED | mode 字面等于 headed
FAILED | 顶层 keys 完全等于 mode,smoke_tag,task_id
FAILED | 篡改 smoke_tag 后同一断言必失败
```
