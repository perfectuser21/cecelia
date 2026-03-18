# Learning: packages/brain/.env 必须与 docker-compose.yml 双写

## 任务背景
hotfix: CECELIA_BUDGET_SLOTS=7 补写到 packages/brain/.env

---

### 根本原因

commit #1077（2026-03-10）只在 `docker-compose.yml` 中写入了 `CECELIA_BUDGET_SLOTS=7`，
未同步到 `packages/brain/.env`。

结果：
- Docker 容器：通过 `docker-compose.yml` environment 正确注入 → 正常
- 裸进程（`node server.js`）：从 `packages/brain/.env` 读取，未设置 → `budget_cap = null`
- 并发保护层（slot-allocator）失效超过 8 天

### 下次预防

- [ ] 每次修改 `docker-compose.yml` 的 environment 变量时，同步检查 `packages/brain/.env`
- [ ] 每次修改 `packages/brain/.env` 时，同步检查 `docker-compose.yml` environment 块
- [ ] 未来的 PRD/DoD 中：凡涉及环境变量的变更，success criteria 必须同时验证 `docker-compose.yml` 和 `.env` 两处

### 为什么 .env 和 docker-compose.yml 必须双写

`packages/brain` 有两种运行模式：
1. **Docker 容器**（`docker-compose up`）：从 `docker-compose.yml` 的 `environment:` 块注入
2. **裸进程**（`node server.js`，开发/生产裸跑）：从 `packages/brain/.env` 由 `dotenv/config` 加载

两者互不继承，修改一处不影响另一处。必须双写。

---

**验证结果**（2026-03-18）：
- `.env` 追加 `CECELIA_BUDGET_SLOTS=7` + `CECELIA_MAX_SEATS=10` 后 Brain 重启
- `GET /api/brain/slots` 返回 `capacity.budget=7, capacity.effective=7` ✅
