## smoke-task-planning.sh — task/schedule/planning/proposal 域（2026-05-01）

### 根本原因

Brain feature registry 只有 `smoke_cmd` 字符串，缺乏可独立执行的 `.sh` 脚本。
task-ci-diagnosis 端点对已完成任务返回 404（正常行为），proposal rollback 对未审批 proposal 返回 400（正常行为）。
bash 在 `set -u` 模式下将 fullwidth 括号 `（$VAR）` 中的 fullwidth 右括号 `）` 解析为变量名的一部分，导致 "unbound variable" 报错。

### 下次预防

- [ ] 所有 `$VAR` 嵌入中文/全角符号前后时，用 `${VAR}` 显式界定变量名
- [ ] 状态码断言用 `^(200|404)$` regex，不用 `== 200`，避免业务逻辑 404 导致误报
- [ ] POST 端点只发空 body，期望 400（参数校验），不调用真实业务逻辑
- [ ] 依赖特定 ID 的端点（checkpoints/logs/ci-diagnosis）先查询第一条记录，无记录时 warn+PASS，不 FAIL
- [ ] 对 proposal/rollback 等写操作：只验证端点存在（非 404/405），不真实触发变更
- [ ] fullwidth 括号 `（）` 在 bash ok/fail 信息中用 `（${CODE}）` 格式
