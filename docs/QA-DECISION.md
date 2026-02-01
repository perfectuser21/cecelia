# QA Decision

Decision: UPDATE_RCI
Priority: P0
RepoType: Engine

## Tests

- dod_item: "Stop Hook 使用 JSON API 格式（{\"decision\": \"block\", \"reason\": \"...\"}）"
  method: auto
  location: tests/hooks/stop-hook.test.ts

- dod_item: "Stop Hook 重试上限为 15 次"
  method: auto
  location: tests/hooks/stop-hook-retry.test.ts

- dod_item: "Stop Hook 超限后调用 track.sh 上报失败"
  method: auto
  location: tests/hooks/stop-hook-retry.test.ts

- dod_item: "SubagentStop Hook 已创建并支持 Explore/Plan agent 类型"
  method: auto
  location: tests/hooks/subagent-stop.test.ts

- dod_item: "SubagentStop Hook 重试上限为 5 次"
  method: auto
  location: tests/hooks/subagent-stop.test.ts

- dod_item: "SubagentStop Hook 超限后正确退出"
  method: auto
  location: tests/hooks/subagent-stop.test.ts

- dod_item: "所有 exit 2 改为 jq -n 输出 JSON + exit 0"
  method: auto
  location: tests/hooks/stop-hook-exit.test.ts

- dod_item: ".claude/settings.json 已更新 SubagentStop Hook 配置"
  method: manual
  location: manual:检查 settings.json 包含 SubagentStop Hook 配置

- dod_item: "强制循环机制生效：AI 不会'停下来等用户输入'"
  method: manual
  location: manual:运行完整 /dev 流程，验证 JSON API reason 作为 prompt 注入后自动继续执行

## RCI

new:
  - H7-009  # SubagentStop Hook - 新增子 agent 循环控制
update:
  - H7-001  # Stop Hook 检测 .dev-mode - 更新为支持 JSON API
  - H7-002  # Stop Hook 检查完成条件 - 更新为支持 JSON API
  - H7-003  # Stop Hook exit 机制 - 从 exit 2 改为 JSON API + exit 0

## Reason

Stop Hook 是核心循环控制机制（P0），改用 JSON API 直接影响 /dev 工作流的自动化能力。需要更新现有 H7 系列 RCI 并新增 SubagentStop 测试覆盖。
