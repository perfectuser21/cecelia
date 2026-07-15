# Gate3 自动部署全红——green canary 容器内不可达 + 变更检测死代码（2026-07-15）

## 根本原因

1. **主因（自动全红、手动全绿的分叉）**：webhook 链路里 brain-deploy.sh 在 cecelia-node-brain 容器内执行，bluegreen.sh 的 pre-swap smoke 用 `BRAIN_URL=http://localhost:5223` 探 green canary；但 green 用 `-p 5223:5221` 把端口发布在**宿主**，且起在默认 bridge 网络（blue 在 cecelia_default，docker 跨网络隔离）→ 容器内 localhost:5223 秒拒（0ms），4/5 smoke 必挂 → 保留 blue → 自动部署永远失败。手动在宿主跑同一脚本则 localhost 可达、smoke 全过。上面的 health poll 因有 `docker inspect` 兜底能过，掩盖了可达性问题。
2. **latent（原立案项）**：Gate3 workflow 变更检测 `git diff | grep | tr '\n' ' ' || echo fallback`——管道退出码取最后命令 `tr`（恒 0），`|| echo` 是死代码，shallow diff 失败时静默送出空列表。
3. **误诊链**：07-14 曾把同一症状先修成"容器内缺 jq"（jq shim），本次立案又假设"changed 为空"——两次都是治上一层症状。真根因靠逐份宿主部署日志 + GHA run 日志对拼才定位。

## 下次预防

- [ ] 任何"探活/冒烟 URL"在容器内执行的脚本，禁止裸写 localhost:宿主端口——必须双模式解析（本次已在 bluegreen.sh 落 GREEN_URL 模式，新增探活点照抄它）
- [ ] bash 管道 fallback 必须用显式空判（`[[ -z "${X//[[:space:]]/}" ]]`），禁止依赖 `pipeline || fallback`（退出码取最后命令）
- [ ] 部署链兜底判据（docker inspect health）通过而主判据（curl）不通时，应打 WARN 日志——兜底静默通过会掩盖可达性退化
- [ ] "同一症状修过一次又复发"→ 先怀疑上次修的是症状层，回到日志逐层对拼（cecelia-harness-debug 层级 filter）
