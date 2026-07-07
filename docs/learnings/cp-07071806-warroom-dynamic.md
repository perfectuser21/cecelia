## warroom 前端四板块动态化（2026-07-07）

### 根本原因
war room 前端长期停在「任务清单板」：交接单/哨兵/战况/决策四类数据器官在库里和 API 层就绪后，前端没有消费面——器官建成与接线之间缺一个明确的"接进前端"收口步骤。

### 下次预防
- [ ] 数据器官类 PR（新 API/新表）verdict 里写明前端消费方与接线计划，避免"写侧完工读侧悬空"（与 item1 learning 同根因，前后端两面）
- [ ] 主仓 node_modules 的 @esbuild 平台目录被 docker build 穿透污染成 linux-arm64（darwin 本机跑 dashboard vitest 必炸）——修复主仓依赖前，worktree 里用 ESBUILD_BINARY_PATH 指向正确平台二进制绕行；根治需重装主仓依赖并查 docker volume mount
- [ ] 哨兵/告警类 UI 的空态要区分「没有数据」和「应有数据但全灭」——后者是最需要报警的状态，渲染条件必须含 expected 比对（本次盲区被审查抓出并补修）
