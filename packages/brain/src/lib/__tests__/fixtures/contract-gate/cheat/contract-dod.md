# Cheat Fixture — 6 类作弊全覆盖（gate 应抓 ≥6 条）

> 永久回归样本：单文件内同时含全部 6 类作弊模式，每类至少一条。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 拿响应但不校验值（弱 oracle）
  Test: manual:bash -c 'curl -s http://localhost:5221/api/posts'

- [ ] [BEHAVIOR] 注入假环境（MOCK_*）
  Test: manual:bash -c 'MOCK_WECHAT_VERSION=4.2.0.0 node publish.js'

- [ ] [BEHAVIOR] 无条件兜底 exit 0
  Test: manual:bash -c 'run_check || exit 0'

- [ ] [BEHAVIOR] 尾部吞错 || true
  Test: manual:bash -c 'assert_output || true'

- [ ] [BEHAVIOR] 只查文件存在（无内容断言）
  Test: manual:bash -c 'test -f /tmp/out.mp4'

- [ ] [BEHAVIOR] 同义反复断言（脚本自生成值）
  Test: manual:bash -c 'echo PASS | grep PASS'
