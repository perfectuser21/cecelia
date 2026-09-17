## Brain {VERSION} — 预览环境执行下放执行机（MMV）

- **病根是架构不是代码**：起预览环境 = 起一个 Brain 实例 + 克隆一整份数据库，这是执行活，而 us-vps 有零执行铁律（决策 96054a8b）。整套预览功能本就是为 Mac 写的——`preview-env-start.sh` 硬编码 `/Users/administrator/...`、磁盘门槛 35G 底线 + 3.5G 预留按 Mac 盘设计，而 us-vps 根分区仅 24G，**数学上不可能通过**。搬去 us-vps 那天（09-09）起，`preview_environments` 从 842 次历史记录直接归零，一次没成功过。
- 新增 `scripts/preview-agent.mjs`：MMV 侧预览代理，**复用 `routes/preview.js` 的全部逻辑与 `DEPLOY_TOKEN` 鉴权**，挂载路径与 Brain 完全一致。于是 CI 只需改指向——`request-preview-start.sh` / `wait-preview-active.sh` 一行未动，**未新增任何 GitHub secret**。
- CI 指向从 `MMV:5221` 改为 `MMV:5241`：**5221 是 socat，会把流量整个转发到 us-vps**，必须错开端口才能让执行留在本机。这是"CI 明明打的是 Mac 却落到 us-vps 执行"的真正原因。
- 克隆源改为 `PREVIEW_SOURCE_DB` 可配置（执行机上用 `cecelia_staging`，schema 443 > 最低要求 430）：执行机没有生产库 `cecelia`，且预览环境用 staging 数据足够，顺带避免生产数据复制进临时环境。源库缺失时明确报错并列出可用库，不再退化成难查的 `pg_dump` 静默失败。
- `scripts/preview-agent-install.sh` 装 LaunchAgent 常驻（KeepAlive），并硬性校验必须跑在部署根——代理与 `capacity-gate` 必须同 repo，否则后者按自身位置算 `REPO_ROOT`、去别处找采样文件，报 `sample_missing`。
- 配 `preview-agent-mmv-smoke.sh` 并登记 allowlist，两道关键闸 proven-to-fire（注入"CI 指回 us-vps"「CI 指向 socat 端口」各自报红）。
