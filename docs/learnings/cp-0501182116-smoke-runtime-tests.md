# Cecelia Brain smoke-runtime tests PR 1/3（2026-05-01）

## 根本原因

Brain 的 171 个 feature 只有 smoke_cmd 字符串（动态 DB 驱动），没有可独立运行、固定断言的 .sh 测试脚本。CI 的 real-env-smoke job 需要 packages/brain/scripts/smoke/*.sh 真实脚本，不能读 DB。前 4 个域（health/admin/agent/tick，共 27 个 feature）的断言体系刚定稿，此时打包成 PR1/3 冻结，后续 PR2/3 补全其余 9 个域。

## 下次预防

- [ ] 新 feature 域合并时同步补充对应 smoke-*.sh 脚本段落
- [ ] smoke_cmd 和 smoke.sh 断言保持一致：端点变更两处同步更新
- [ ] tick 操作类测试（disable/drain）必须在断言后立即恢复状态（enable/drain-cancel），否则污染后续 tick 轮次
- [ ] 响应字段验证前先用 `|| { fail "msg"; r="{}"; }` 兜底，避免 set -e 中断测试流程
- [ ] 用真实 Brain 验证响应字段存在，不要在 spec 里写不存在的字段名（防止虚假通过）
- [ ] curl 失败场景用 `-f` 捕获 HTTP 错误码，`-s` 静默输出，组合 `-sf` 最安全
- [ ] jq 多条件时用 `and` 而不是多个 `jq -e` 串联，避免反复解析 JSON
