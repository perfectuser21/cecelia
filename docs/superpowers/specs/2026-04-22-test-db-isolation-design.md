# 本地 cecelia_test DB + db-config guard — 防测试污染生产

日期：2026-04-22
分支：cp-0422xxxxxx-test-db-isolation（以 worktree 生成为准）
Brain Task：2302a40f-7ce0-4f12-8969-7634e8ed94d8

## 真实事故（根因）

昨晚 muted-toggle-e2e.integration.test.js 本地跑：
1. 本地没 `cecelia_test` DB，DB_DEFAULTS 解析到 `cecelia`（生产 DB）
2. test `beforeEach` DELETE + INSERT + 最后一个 subtest PATCH {enabled:false}
3. **测试结束后 DB 里 `brain_muted.enabled=false` 残留**
4. 今早 Brain 重启 → `initMutedGuard(pool)` 读到 false → 飞书恢复发

## 设计

### 1. 本地建 cecelia_test DB

脚本：`packages/brain/scripts/setup-test-db.sh`（新建）

```bash
#!/bin/bash
set -e
# unset NODE_ENV/VITEST 避免子进程/父环境污染（guard 误触发）
unset NODE_ENV VITEST
DB=cecelia_test

# 幂等：已存在跳过 create
if ! psql postgres -lqt | cut -d\| -f1 | grep -qw "$DB"; then
  echo "创建 $DB"
  createdb -O cecelia "$DB"
fi

# 跑 migrations（migrate.js 自己幂等）
DB_NAME="$DB" node packages/brain/src/migrate.js
echo "✅ $DB 准备就绪"
```

**注意**：setup 脚本**不**显式设 NODE_ENV=test。migrate.js 只需要 DB_NAME 路由即可。显式设 test 会让子进程继承，其他 script 意外中 guard。

幂等：可重复跑。首次建 DB + 跑全套 migrations，之后增量。

### 2. db-config.js 加 NODE_ENV=test guard

改 `packages/brain/src/db-config.js`：

```js
// ... 现有 dotenv 逻辑不变 ...

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const dbName = process.env.DB_NAME || (isTest ? 'cecelia_test' : 'cecelia');

// Guard: 禁止测试环境连生产 DB
if (isTest && dbName === 'cecelia') {
  throw new Error(
    '❌ NODE_ENV=test 或 VITEST=true 时禁止连接 cecelia 生产 DB。\n' +
    '解决：\n' +
    '  1. 显式设置 DB_NAME=cecelia_test\n' +
    '  2. 本地首次运行：bash packages/brain/scripts/setup-test-db.sh'
  );
}

export const DB_DEFAULTS = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: dbName,  // 从 isTest 推导
  // ... 其余不变 ...
};
```

**行为矩阵**：

| NODE_ENV / VITEST | DB_NAME env | 结果 |
|---|---|---|
| test / true | 未设 | database=`cecelia_test` |
| test / true | `cecelia_test` | database=`cecelia_test` |
| test / true | `cecelia` | **throw Error（拒绝）** |
| production / unset | 未设 | database=`cecelia`（不受影响）|
| production / unset | `cecelia` | database=`cecelia`（不受影响）|

### 3. 单测覆盖 4 场景

`packages/brain/src/__tests__/db-config-guard.test.js`（新建）：

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('db-config NODE_ENV=test guard', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('场景 1: NODE_ENV=test + VITEST=false + DB_NAME 未设 → database=cecelia_test', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VITEST', '');
    vi.stubEnv('DB_NAME', '');
    const mod = await import('../db-config.js');
    expect(mod.DB_DEFAULTS.database).toBe('cecelia_test');
  });

  it('场景 2: NODE_ENV=test + DB_NAME=cecelia → throw', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DB_NAME', 'cecelia');
    await expect(import('../db-config.js')).rejects.toThrow(/生产 DB/);
  });

  it('场景 3: NODE_ENV=test + DB_NAME=cecelia_test → OK', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DB_NAME', 'cecelia_test');
    const mod = await import('../db-config.js');
    expect(mod.DB_DEFAULTS.database).toBe('cecelia_test');
  });

  it('场景 4: NODE_ENV=production + VITEST=false + DB_NAME=cecelia → OK（生产不受影响）', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');
    vi.stubEnv('DB_NAME', 'cecelia');
    const mod = await import('../db-config.js');
    expect(mod.DB_DEFAULTS.database).toBe('cecelia');
  });
});
```

**用 vi.stubEnv + vi.resetModules**：比手写 process.env 更稳，自动隔离每个 case 的 module cache 和 env 快照，避免 flaky。

### 4. 本地 smoke

```bash
# 1. 建 cecelia_test
bash packages/brain/scripts/setup-test-db.sh

# 2. 跑现有 muted-toggle-e2e 应连 cecelia_test（不是 cecelia）
cd packages/brain && npx vitest run src/__tests__/integration/muted-toggle-e2e.integration.test.js 2>&1 | tail -5

# 3. 验证 cecelia.working_memory.brain_muted 状态未被改
psql cecelia -tAc "SELECT value_json FROM working_memory WHERE key='brain_muted';"
# 预期：不是 enabled:false（不被测试覆盖）

# 4. 验证 cecelia_test.working_memory.brain_muted 存在（测试写的）
psql cecelia_test -tAc "SELECT value_json FROM working_memory WHERE key='brain_muted';"
```

## 变更清单

| 文件 | 动作 |
|---|---|
| `packages/brain/scripts/setup-test-db.sh` | Create 幂等建 DB + 跑 migrations |
| `packages/brain/src/db-config.js` | Modify 加 isTest 分支 + guard |
| `packages/brain/src/__tests__/db-config-guard.test.js` | Create 4 场景 |
| `.dod` + `docs/learnings/cp-*-test-db-isolation.md` | Create |

## 不做

- 不改 CI workflow（已用 DB_NAME=cecelia_test + NODE_ENV=test 走正确路径）
- 不改已有 migration（本 PR 合并后，新 migration 跑到 cecelia_test 由 setup-test-db.sh 或 test 启动时自动负责）
- 不改 consciousness-toggle-e2e / muted-toggle-e2e 测试本身（它们用 DB_DEFAULTS，自动跟随新 db-config）
- 不删 cecelia 生产 DB

## 风险

- **LaunchDaemon 误设 NODE_ENV=test**：Brain 启动连不上 cecelia 会崩。Plist 检查：
  ```bash
  sudo /usr/libexec/PlistBuddy -c "Print :EnvironmentVariables" /Library/LaunchDaemons/com.cecelia.brain.plist | grep -i NODE_ENV
  ```
  现在 plist 没 NODE_ENV，生产默认不是 test。OK。
- **migration 引用 cecelia 独有的表**（比如 social_media_raw）：setup-test-db.sh 跑 migrations 可能失败。如失败，手工处理单个 migration 或跳过（但 242/243 都不涉及外部表，本次 smoke 应该过）。
- **子进程继承 NODE_ENV=test**：某些 runtime 脚本也可能继承 → 意外 guard 触发。若发生可用 `NODE_ENV=production bash ...` 覆盖。

## 成功标准

- [ARTIFACT] `scripts/setup-test-db.sh` 新文件，可执行
- [ARTIFACT] `db-config.js` 含 isTest 判断 + guard throw
- [ARTIFACT] `db-config-guard.test.js` 4 场景
- [BEHAVIOR] 4 单测全绿
- [BEHAVIOR] 本地 cecelia_test DB 存在 + working_memory 表建好
- [BEHAVIOR] smoke：跑 muted-toggle-e2e 后 cecelia.brain_muted 不变
- [BEHAVIOR] smoke：显式 `DB_NAME=cecelia NODE_ENV=test node -e "..."` → 报错
