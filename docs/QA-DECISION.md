# QA Decision

Decision: NO_RCI
Priority: P1
RepoType: Engine

Tests:
  - dod_item: "back-merge-main-to-develop.yml 添加 check-trigger guard job"
    method: manual
    location: "manual:查看 .github/workflows/back-merge-main-to-develop.yml 包含 check-trigger job"

  - dod_item: "back-merge guard job 检查 event_name == push && ref_name == main"
    method: manual
    location: "manual:验证 guard job 的 bash 脚本逻辑"

  - dod_item: "back-merge 其他 jobs 依赖 guard job 且使用 if 条件"
    method: manual
    location: "manual:验证 back-merge job 的 needs 和 if 字段"

  - dod_item: "nightly.yml 添加 check-trigger guard job"
    method: manual
    location: "manual:查看 .github/workflows/nightly.yml 包含 check-trigger job"

  - dod_item: "nightly guard job 检查 event_name != push"
    method: manual
    location: "manual:验证 guard job 的 bash 脚本逻辑"

  - dod_item: "nightly 其他 jobs 依赖 guard job 且使用 if 条件"
    method: manual
    location: "manual:验证 regression job 的 needs 和 if 字段"

  - dod_item: "Push 到非 main 分支后，back-merge workflow 跳过（不失败）"
    method: manual
    location: "manual:查看 CI runs，验证 develop/feature 分支 push 后 back-merge 跳过"

  - dod_item: "Push 任何分支后，nightly workflow 跳过（不失败）"
    method: manual
    location: "manual:查看 CI runs，验证 push 事件后 nightly 跳过"

RCI:
  new: []
  update: []

Reason: CI infrastructure bugfix，通过 workflow 文件审查和 CI 实际运行验证即可，无需回归契约
