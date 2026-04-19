#!/usr/bin/env bash
# generate-alignment-table.sh — Superpowers ↔ Engine 对齐对照表生成
#
# 用法:
#   bash packages/engine/scripts/generate-alignment-table.sh
#     → 输出到 docs/superpowers-alignment-table.md
#   bash packages/engine/scripts/generate-alignment-table.sh --stdout
#     → 打印到 stdout（不写文件）
#
# 配套:
#   - sync-from-upstream.sh 检测 drift（返回 exit code）
#   - 本脚本生成可读对照表（人工看）
#   - Superpowers 升级后重跑即刷新
#
# 依赖: node (ships with Engine CI)

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

# 找 upstream cache
SP_CACHE=~/.claude-account1/plugins/cache/superpowers-marketplace/superpowers
if [[ ! -d "$SP_CACHE" ]]; then
    echo "[generate-alignment-table] ERROR: Superpowers cache not found" >&2
    exit 2
fi
UPSTREAM_VER=$(ls "$SP_CACHE" 2>/dev/null | sort -V | tail -1)
UPSTREAM_ROOT="$SP_CACHE/$UPSTREAM_VER/skills"
LOCAL_ROOT="$REPO_ROOT/packages/engine/skills/dev/prompts"
ALIGNMENT_YAML="$REPO_ROOT/packages/engine/contracts/superpowers-alignment.yaml"

OUTPUT_MODE="${1:-file}"
OUTPUT_PATH="$REPO_ROOT/docs/superpowers-alignment-table.md"

# 生成表的 node 逻辑
TABLE=$(UPSTREAM_VER="$UPSTREAM_VER" UPSTREAM_ROOT="$UPSTREAM_ROOT" \
        LOCAL_ROOT="$LOCAL_ROOT" ALIGNMENT_YAML="$ALIGNMENT_YAML" \
        node <<'NODE_EOF'
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const UPSTREAM_VER = process.env.UPSTREAM_VER;
const UPSTREAM = process.env.UPSTREAM_ROOT;
const LOCAL = process.env.LOCAL_ROOT;
const ALIGNMENT_YAML = process.env.ALIGNMENT_YAML;

// 解析 alignment.yaml (minimal: skill name + coverage_level + rejection_reason)
const ayml = fs.readFileSync(ALIGNMENT_YAML, 'utf8');
const skillMeta = {};
const skillBlocks = ayml.split(/^  - name: /m).slice(1);
for (const block of skillBlocks) {
  const name = block.split('\n')[0].trim();
  const cov = block.match(/coverage_level:\s*(\S+)/)?.[1] || '?';
  const rej = block.match(/rejection_reason:\s*([\s\S]*?)(?=\n    \w|\n  - name:|\n_metadata:|$)/)?.[1]?.trim().replace(/\n\s*/g, ' ').substring(0, 80) || '';
  skillMeta[name] = { cov, rej };
}

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').substring(0, 12);
}
function lineCount(p) {
  return fs.readFileSync(p, 'utf8').split('\n').length;
}

const upSkills = fs.readdirSync(UPSTREAM).filter(f => fs.statSync(path.join(UPSTREAM, f)).isDirectory()).sort();
const now = new Date().toISOString().split('T')[0];

let out = '';
out += '# Superpowers ↔ Cecelia Engine 对齐对照表\n\n';
out += '> 自动生成 — 升级后重跑 `bash packages/engine/scripts/generate-alignment-table.sh`\n\n';
out += `**Superpowers upstream**: v${UPSTREAM_VER}\n`;
out += '**Upstream 路径**: `' + UPSTREAM + '`\n';
out += '**Engine local**: `packages/engine/skills/dev/prompts/`\n';
out += `**生成时间**: ${now}\n\n`;

out += '## 图例\n\n';
out += '| 符号 | 含义 |\n';
out += '|---|---|\n';
out += '| 🟢 full | 方法论已在 Engine 落地，prompt 1:1 本地化 |\n';
out += '| 🟡 partial | 方法论吸收但调用时机/范围有偏离（见 notes） |\n';
out += '| 🔴 rejected | 刻意不吸收（Engine 自造替代，见 rejection_reason） |\n';
out += '| ⚫ N/A | meta skill（对 Engine 无意义） |\n';
out += '| ✅ | 本地 sha256 与 upstream 完全一致 |\n';
out += '| ❌ DRIFT | 本地与 upstream 不一致，需人工 diff 决策 |\n';
out += '| ⚠️ local-only | 本地有但 upstream 没有（可能 upstream 删除了该文件） |\n\n';

out += '## Skill 全景（upstream 总计 ' + upSkills.length + ' 个）\n\n';
out += '| # | Skill | Upstream | 本地副本 | coverage | 对齐 | 决策理由 |\n';
out += '|---|-------|---------|---------|---------|-----|---------|\n';

let idx = 0;
let skillsDrifted = 0;
let skillsAligned = 0;
let skillsRejected = 0;
let skillsNA = 0;

for (const skill of upSkills) {
  idx++;
  const upDir = path.join(UPSTREAM, skill);
  const localDir = path.join(LOCAL, skill);
  const upFiles = fs.readdirSync(upDir).filter(f => f.endsWith('.md')).length;
  const meta = skillMeta[skill] || { cov: '-', rej: '' };

  let matchStatus = '—';
  let localFiles = '无副本';
  if (fs.existsSync(localDir)) {
    const localMdFiles = fs.readdirSync(localDir).filter(f => f.endsWith('.md'));
    localFiles = `${localMdFiles.length} 个 md`;
    const mismatches = [];
    for (const f of localMdFiles) {
      const lPath = path.join(localDir, f);
      const uPath = path.join(upDir, f);
      if (!fs.existsSync(uPath)) mismatches.push(`${f}(local-only)`);
      else if (sha256(lPath) !== sha256(uPath)) mismatches.push(`${f}(DRIFT)`);
    }
    if (mismatches.length === 0) { matchStatus = '✅'; skillsAligned++; }
    else { matchStatus = '❌ ' + mismatches.join(','); skillsDrifted++; }
  } else {
    if (meta.cov === 'rejected') skillsRejected++;
    else if (meta.cov === 'not_applicable') skillsNA++;
  }

  const covMark = { full: '🟢 full', partial: '🟡 partial', rejected: '🔴 rejected', not_applicable: '⚫ N/A' }[meta.cov] || meta.cov;
  const reason = meta.rej.substring(0, 60) || (meta.cov === 'full' ? '1:1 同步' : meta.cov === 'partial' ? '部分吸收' : meta.cov === 'not_applicable' ? 'meta skill' : '-');

  out += `| ${idx} | ${skill} | ${upFiles} md | ${localFiles} | ${covMark} | ${matchStatus} | ${reason} |\n`;
}

out += '\n## 统计\n\n';
out += `- 🟢 Full 对齐（sha256 全匹配）: ${skillsAligned} 个\n`;
out += `- 🔴 Rejected（刻意自造）: ${skillsRejected} 个\n`;
out += `- ⚫ N/A（meta skill）: ${skillsNA} 个\n`;
out += `- ❌ Drifted（需人工处理）: ${skillsDrifted} 个\n`;
out += `- **总计**: ${upSkills.length} 个 upstream skill\n\n`;

out += '## 文件级详情\n\n';
out += '| Skill | 文件 | 行数 | local sha256 | upstream sha256 | 状态 |\n';
out += '|-------|------|-----|-------------|----------------|------|\n';

for (const skill of upSkills.sort()) {
  const localDir = path.join(LOCAL, skill);
  if (!fs.existsSync(localDir)) continue;
  const localMdFiles = fs.readdirSync(localDir).filter(f => f.endsWith('.md')).sort();
  for (const f of localMdFiles) {
    const lPath = path.join(localDir, f);
    const uPath = path.join(UPSTREAM, skill, f);
    const lSha = sha256(lPath);
    const lLine = lineCount(lPath);
    const uSha = fs.existsSync(uPath) ? sha256(uPath) : 'NO_UPSTREAM';
    const status = !fs.existsSync(uPath) ? '⚠️ local-only' : (lSha === uSha ? '✅' : '❌ DRIFT');
    out += `| ${skill} | ${f} | ${lLine} | \`${lSha}\` | \`${uSha}\` | ${status} |\n`;
  }
}

out += '\n## 升级 workflow\n\n';
out += '```\n';
out += '1. 下载 Superpowers 新版到 ~/.claude-account1/plugins/cache/superpowers-marketplace/superpowers/<new-ver>/\n';
out += '2. bash packages/engine/scripts/sync-from-upstream.sh       # 检测 drift\n';
out += '3. bash packages/engine/scripts/generate-alignment-table.sh # 刷新本表\n';
out += '4. 对每个 DRIFT 人工 diff upstream vs local → 决定同步 / 刻意偏离\n';
out += '5. 更新 alignment.yaml 对应 sha256（如同步）\n';
out += '6. node packages/engine/scripts/devgate/check-superpowers-alignment.cjs  # 验证\n';
out += '7. 推 PR，CI alignment gate 防退化\n';
out += '```\n';

console.log(out);
NODE_EOF
)

if [[ "$OUTPUT_MODE" == "--stdout" ]]; then
    echo "$TABLE"
else
    mkdir -p "$(dirname "$OUTPUT_PATH")"
    echo "$TABLE" > "$OUTPUT_PATH"
    echo "[generate-alignment-table] ✅ 写入 $OUTPUT_PATH"
    echo "[generate-alignment-table] upstream=v$UPSTREAM_VER 对齐表已刷新"
fi
