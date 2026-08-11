#!/usr/bin/env bash
# credential-freshness-preflight-smoke.sh
#
# 验收：派发前只读凭据新鲜度闸（事故 2026-08-10 修复）在真环境按合同判定。
# 真跑 orchestrator/preflight/credential-freshness.js：
#   - token 剩 5min（< 10min 阈值）→ 拦截（fresh=false）
#   - token 剩 8h → 放行（fresh=true）
#   - 文件缺失 / JSON 非法 / 缺 claudeAiOauth → 三者均拦截
#   - 只读红线：对 0444 凭据文件检查后 mtime 不变（零写入）
# 纯只读、无网络依赖，可在 CI real-env-smoke 容器内直接跑。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
MODULE="$REPO_ROOT/packages/brain/src/orchestrator/preflight/credential-freshness.js"
export SMOKE_TMP="$(mktemp -d)"
trap 'rm -rf "$SMOKE_TMP"' EXIT

if [ ! -f "$MODULE" ]; then
  echo "❌ 模块缺失: $MODULE"
  exit 1
fi

SCRIPT="$SMOKE_TMP/run.mjs"
cat > "$SCRIPT" <<MJS
import { writeFileSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  inspectCredentialFreshness,
  createCredentialFreshnessCheck,
  DEFAULT_CREDENTIAL_FRESHNESS_THRESHOLD_MS,
  CREDENTIAL_FRESHNESS_REASONS,
} from '${MODULE}';

const tmp = process.env.SMOKE_TMP;
const NOW = 1754000000000;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
let fail = 0;
const check = (label, cond) => { console.log((cond ? '✅ ' : '❌ ') + label); if (!cond) fail++; };

if (DEFAULT_CREDENTIAL_FRESHNESS_THRESHOLD_MS !== 10 * MIN) { console.log('❌ 默认阈值应为 10min'); fail++; }

const write = (name, contents) => {
  const p = join(tmp, name);
  writeFileSync(p, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return p;
};

const soon = inspectCredentialFreshness({ credentialPath: write('soon.json', { claudeAiOauth: { expiresAt: NOW + 5 * MIN } }), now: () => NOW });
check('token 剩 5min → 拦截 (expiring_soon)', soon.fresh === false && soon.reason === CREDENTIAL_FRESHNESS_REASONS.EXPIRING_SOON);

const fresh = inspectCredentialFreshness({ credentialPath: write('fresh.json', { claudeAiOauth: { expiresAt: NOW + 8 * HOUR } }), now: () => NOW });
check('token 剩 8h → 放行', fresh.fresh === true);

const missing = inspectCredentialFreshness({ credentialPath: join(tmp, 'nope.json'), now: () => NOW });
check('文件缺失 → 拦截', missing.fresh === false && missing.reason === CREDENTIAL_FRESHNESS_REASONS.FILE_MISSING);

const bad = inspectCredentialFreshness({ credentialPath: write('bad.json', '{ not json ]'), now: () => NOW });
check('JSON 非法 → 拦截', bad.fresh === false && bad.reason === CREDENTIAL_FRESHNESS_REASONS.PARSE_ERROR);

const noOauth = inspectCredentialFreshness({ credentialPath: write('noauth.json', { other: 1 }), now: () => NOW });
check('缺 claudeAiOauth → 拦截', noOauth.fresh === false && noOauth.reason === CREDENTIAL_FRESHNESS_REASONS.OAUTH_MISSING);

// 只读红线：0444 文件检查后 mtime 不变
const roPath = write('readonly.json', { claudeAiOauth: { expiresAt: NOW + 5 * MIN } });
chmodSync(roPath, 0o444);
const before = statSync(roPath).mtimeMs;
inspectCredentialFreshness({ credentialPath: roPath, now: () => NOW });
const after = statSync(roPath).mtimeMs;
check('只读红线：mtime 检查前后不变（零写入）', before === after);

// account 级适配器：claude 走凭据路径，codex 跳过
const claudeCheck = createCredentialFreshnessCheck({ now: () => NOW, resolveCredentialPath: () => roPath });
check('claude account → 走凭据检查', claudeCheck({ provider: 'claude', account: 'account1' }).fresh === false);
const codexCheck = createCredentialFreshnessCheck({ now: () => NOW, resolveCredentialPath: () => null });
check('codex account（无本地凭据）→ 跳过', codexCheck({ provider: 'codex', account: 'team1' }).skipped === true);

if (fail > 0) { console.log('SMOKE FAIL count=' + fail); process.exit(1); }
console.log('SMOKE PASS');
MJS

node "$SCRIPT"
