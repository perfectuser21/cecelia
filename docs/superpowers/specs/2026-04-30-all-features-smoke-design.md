# All Features Smoke Script Design

**Goal:** 单脚本动态读取 Brain feature registry 中所有 feature 的 `smoke_cmd`，逐个执行，写回 `smoke_status`，有失败则 exit 1，挂进 CI `real-env-smoke` job 实现持续验证。

**Architecture:** 纯 bash 动态脚本，运行时从 Brain API 拉取数据，无硬编码端点列表，feature 增减自动覆盖。

**Tech Stack:** bash, curl, jq

---

## 变更清单

### 1. `packages/brain/scripts/smoke/all-features-smoke.sh`（新建）

逻辑：
1. `GET /api/brain/features?limit=500` 拉取所有 feature
2. `jq` 提取 `.features[] | select(.smoke_cmd != null) | {id, smoke_cmd}`
3. 对每个 feature：
   - `bash -c "$smoke_cmd"` 执行
   - 成功 → `PATCH smoke_status=passing + smoke_last_run=$(date -u)`
   - 失败 → `PATCH smoke_status=failing + smoke_last_run=$(date -u)` + 记录到 FAILED 列表
4. 打印摘要（passed/failed 数量，失败列表）
5. `FAILED > 0 → exit 1`

安全模式：`set -uo pipefail`（不用 `set -e`，需捕获每条命令退出码后继续）

### 2. CI 集成

无需改 `.github/workflows/ci.yml`：`real-env-smoke` job 已有通配符 `packages/brain/scripts/smoke/*.sh`，脚本放入目录后自动被 CI 执行。

---

## 测试策略

- `all-features-smoke.sh` 是 trivial wrapper（< 60 行，纯 I/O 驱动）→ 1 个 unit test
- Test 文件：`packages/brain/src/routes/__tests__/all-features-smoke.test.js`
- 验证内容：脚本文件存在 + 含关键行（`/api/brain/features`、`smoke_status`、`set -uo pipefail`、`exit 1`）
- 真环境验证：CI `real-env-smoke` job 直接执行该脚本

## 成功标准

- `all-features-smoke.sh` 在真起的 Brain 上跑通，所有 159 个 feature smoke_cmd 均 passing
- CI `real-env-smoke` job 包含该脚本且通过
- feature registry 里所有 `smoke_status` 得到实时刷新
