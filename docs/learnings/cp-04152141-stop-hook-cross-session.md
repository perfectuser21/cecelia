# Learning: Stop Hook 跨 session 孤儿隔离不对称

## 背景
Brain 派发 autonomous /dev 任务时，每个 session 有独立的 CLAUDE_SESSION_ID。
主 session（headless/nested）CLAUDE_SESSION_ID 为空时，Stop Hook 将其他 session 的活跃 worktree 误判为孤儿并反复 block 退出。

### 根本原因
`packages/engine/hooks/stop-dev.sh` 第 194 行（v16.8.0）的跨 session 隔离条件：
```bash
if [[ -n "$_current_sid" && -n "$_orphan_sid" && "$_current_sid" != "$_orphan_sid" ]]; then
```
要求 `current_sid` **和** `orphan_sid` 同时非空才 skip。当 `current_sid` 为空（headless session）时，条件失败 → 把别人的 session 当成自己的孤儿 → block 退出。

### 修复
将条件改为只看 orphan 侧：
```bash
if [[ -n "$_orphan_sid" && "$_orphan_sid" != "$_current_sid" ]]; then
```
逻辑：只要 orphan 明确有 session_id 且不等于当前（包含空），就判定属于别人 → skip。

### 下次预防
- [ ] 写跨 session 隔离逻辑时，条件语义应以「orphan 是否属于别人」为视角，而非「两者是否都已知且不同」
- [ ] 隔离逻辑必须覆盖 current_sid 为空的 headless/autonomous 场景
- [ ] 对应测试用例：`current_sid=""` + orphan dev-lock 含 session_id → 期望 exit 0
