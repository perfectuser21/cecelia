## Brain {VERSION} — Notion 排单接手（双向·pull 半边）

- feat(brain): runNotionTaskPull——主理人在 Notion Tasks 库把行拖到 Delegated 即排单，Brain 建任务并回执 brain:<id> ✓已接管 进 Description；幂等（已带 brain: 标记跳过）；接手先落 blocked 等 map 路由（防 tick 撞墙 autoblock）；与 push 并联进 legacy scheduler 默认周期
