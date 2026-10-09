---
task_id: c954ebfd-469f-4006-a95f-b277fa6564f6
step: intent
upstream: []
---
# coding workflow runner 安装脚本支持把 CODING_WF_AUTOMERGE 写进 LaunchDaemon

### I-1
CODING_WF_AUTOMERGE=0 bash packages/brain/scripts/coding-workflow/runner/install.sh --dry-run 输出的 plist 的 EnvironmentVariables 中含键 CODING_WF_AUTOMERGE 且值为 0

### I-2
未设置 CODING_WF_AUTOMERGE 时 install.sh --dry-run 输出的 plist 不含 CODING_WF_AUTOMERGE 键

### I-3
runner 现有测试（packages/brain/scripts/coding-workflow/runner/__tests__）全部通过，并新增覆盖上述两种情况的测试
