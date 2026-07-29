# Notion Acceptance Worker

交付人工验收闭环（工厂·F1 开发闭环的收口 Ability）。跑在 Notion 云基础设施上的 TypeScript Worker，把 Brain 的验收单搬进 Notion 给人填，把人的判定搬回 Brain 关账。**Brain 是唯一 SSOT 和唯一计算点，本 Worker 只做搬运。**

## 架构

```
Brain (SSOT)                       Notion 云                        员工/主理人
 acceptance_runs/checks ── runsSync/checksSync(15m) ──→ 验收单/验收项(锁定列)
 POST /acceptance/results ←─ resultsSync(5m) ─────────── 「结果/备注」原生列 ←── 人填
      ↑ 经 https://brain-acceptance.zenjoymedia.media（cloudflared→127.0.0.1:5223，Bearer token）
```

- 三个 sync 全部 **incremental**（不删 Notion 历史——验收记录永久保留，主理人要求）
- 验收不通过 → Brain 侧转变沿自动开 `[验收驳回]` 修复任务（模式三）
- 超 48h 未验收 → Brain `acceptance-aging` 哨兵红灯 Bark 验收人（=主理人，决策 18174291）

## 部署（Notion CLI）

```bash
npm install -g ntn            # Notion 官方 CLI
export NOTION_KEYRING=0       # mosh/tmux 环境钥匙串不可用，走文件存储
ntn login                     # 登录 Zenithjoy-July workspace（员工工作区）
cd packages/notion-acceptance-worker
npm install
npm run check                 # tsc --noEmit
ntn workers deploy            # workers.json 已绑定 worker 019fac67-c538-70be-8fe0-b5614cef3cb1
```

## Env（`ntn workers env push --yes`，值见 1Password CS）

| 变量 | 说明 |
|---|---|
| `NOTION_API_TOKEN` | Worker 内 context.notion 鉴权（sync 非 tool 不自动注入）|
| `BRAIN_ACCEPTANCE_URL` | `https://brain-acceptance.zenjoymedia.media` |
| `BRAIN_ACCEPTANCE_TOKEN` | 1Password CS「Acceptance API」（Brain 5223 Bearer）|
| `ACCEPTANCE_CHECKS_DATA_SOURCE_ID` | 验收项库 data source id（`ntn api /v1/search` 查）|

## 运维

```bash
ntn workers sync status                 # 三个 sync 健康度
ntn workers sync trigger runsSync       # 手动触发（绕过 schedule）
ntn workers runs list                   # 执行历史
ntn workers runs logs <run-id>          # 单次执行日志
```

## 已知约束

- 托管库锁定列只能由 sync 写；员工只填「结果/备注」原生列
- Notion automation（编辑即触发）在 private alpha，当前靠 5 分钟 resultsSync 轮询兜底
- Brain 侧配套：`packages/brain/src/routes/acceptance.js`（端点）、`acceptance-public-server.js`（5223 listener）、`acceptance-aging.js`（哨兵）、migration 369
