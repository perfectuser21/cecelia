#!/usr/bin/env node
/**
 * product-map-adapter.mjs — ZenithJoy product-map.yaml → Map Manifest 转换器
 *
 * 刀5：接 zenithjoy-workspace 作为第二个真实 repo/scope
 * 复用其现有 product-map/product-map.yaml，不新增第二份分类文件。
 *
 * 用法：
 *   node scripts/map/product-map-adapter.mjs \
 *     --input /path/to/product-map/product-map.yaml \
 *     --scope zenithjoy \
 *     --decision-id <uuid>
 *
 * 输出：manifest JSON（可直接 POST /api/brain/map/manifests）
 */

import { readFileSync, writeFileSync } from 'fs';
import { parseArgs } from 'util';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { brainAuthHeaders } = require('../lib/brain-auth-headers.cjs');

// ─── CLI args ────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    input: { type: 'string' },
    scope: { type: 'string', default: 'zenithjoy' },
    'decision-id': { type: 'string' },
    output: { type: 'string' },
    submit: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (args.help || !args.input) {
  console.log(`
product-map-adapter.mjs — ZenithJoy product-map.yaml → Map Manifest

Usage:
  node scripts/map/product-map-adapter.mjs \\
    --input <product-map.yaml> \\
    --scope <scope_key>         (default: zenithjoy)
    --decision-id <uuid>        (required for activation)
    --output <out.json>         (optional; prints to stdout if omitted)
    --submit                    (trusted host only: validate + submit + activate)

Example:
  node scripts/map/product-map-adapter.mjs \\
    --input ~/zenithjoy/product-map/product-map.yaml \\
    --scope zenithjoy \\
    --decision-id "some-decision-uuid" \\
    --output /tmp/zenithjoy-manifest.json \
    --submit
`);
  process.exit(0);
}

// ─── YAML parser (built-in JS only, no deps) ─────────────────────────────────

function basicYamlParse(text) {
  const lines = text.split('\n');
  const root = {};
  const stack = [{ obj: root, indent: -1 }];
  let i = 0;

  function current() { return stack[stack.length - 1]; }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();
    i++;
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.length - trimmed.length;
    const colonIdx = trimmed.indexOf(':');

    // Pop stack back to appropriate level
    while (stack.length > 1 && indent <= current().indent) {
      stack.pop();
    }

    if (trimmed.startsWith('- ')) {
      const val = trimmed.slice(2).trim();
      const parent = current().obj;
      const lastKey = current().lastKey;
      if (lastKey && !Array.isArray(parent[lastKey])) {
        parent[lastKey] = [];
      }
      if (lastKey) parent[lastKey].push(parseValue(val));
    } else if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();
      const parent = current().obj;
      if (val === '' || val === '|' || val === '>') {
        parent[key] = {};
        stack.push({ obj: parent[key], indent, lastKey: null });
      } else {
        parent[key] = parseValue(val);
      }
      current().lastKey = key;
    }
  }

  return root;
}

function parseValue(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  return v.replace(/^["']|["']$/g, '');
}

// ─── Adapter: product-map.yaml → Map Manifest ────────────────────────────────

/**
 * Convert ZenithJoy product-map.yaml structure to Map Manifest v1.
 *
 * Expected product-map.yaml top-level keys:
 *   scope_key, value_streams, capabilities, boundaries, crosscut_pool,
 *   shared_prerequisites, source_decision_id
 *
 * If the file already matches manifest format, pass-through with validation.
 * If it has a different structure (legacy ZenithJoy format), attempt conversion.
 */
function convertToManifest(raw, scopeKey, decisionId) {
  // If it already has manifest structure, use it directly
  if (raw.schema_version && raw.value_streams) {
    return {
      ...raw,
      scope_key: scopeKey || raw.scope_key,
      source_decision_id: decisionId || raw.source_decision_id || undefined,
    };
  }

  // Legacy ZenithJoy format conversion
  // product-map.yaml typically has: lines, capabilities, cross-cuts, boundaries
  const manifest = {
    scope_key: scopeKey,
    schema_version: 1,
    source_decision_id: decisionId || undefined,
    value_streams: [],
    capabilities: [],
    boundaries: [],
    crosscut_pool: [],
    shared_prerequisites: { applicable: false, items: [], reason: '' },
  };

  // Convert lines → value_streams
  if (raw.lines) {
    manifest.value_streams = Object.entries(raw.lines).map(([key, line], idx) => ({
      key,
      name: typeof line === 'object' ? (line.name || key) : String(line),
      perceiver: typeof line === 'object' ? (line.perceiver || '') : '',
      order: idx + 1,
    }));
  } else if (raw.value_streams) {
    manifest.value_streams = raw.value_streams;
  }

  // Convert capabilities
  if (raw.capabilities) {
    const caps = Array.isArray(raw.capabilities)
      ? raw.capabilities
      : Object.entries(raw.capabilities).map(([key, cap]) => ({
          key, ...(typeof cap === 'object' ? cap : { name: cap }),
        }));
    manifest.capabilities = caps.map((cap, idx) => ({
      key: cap.key || cap.id,
      name: cap.name,
      value_stream_key: cap.line || cap.value_stream_key || cap.stream || manifest.value_streams[0]?.key,
      order: cap.order || idx + 1,
      aliases: cap.aliases || [],
    }));
  }

  // Convert boundaries
  if (raw.boundaries) {
    const boundaries = Array.isArray(raw.boundaries)
      ? raw.boundaries
      : Object.entries(raw.boundaries).map(([key, b]) => ({ key, ...b }));
    manifest.boundaries = boundaries.map((b) => ({
      key: b.key || `${b.from}_to_${b.to}`,
      from: b.from,
      to: b.to,
      statement: b.statement || b.description || '',
    }));
  }

  // Convert cross-cuts
  const rawCrosscuts = raw.cross_cuts || raw.crosscuts || raw.crosscut_pool || [];
  const crosscuts = Array.isArray(rawCrosscuts)
    ? rawCrosscuts
    : Object.entries(rawCrosscuts).map(([key, cc]) => ({ key, ...cc }));
  manifest.crosscut_pool = crosscuts.map((cc) => ({
    key: cc.key || cc.id,
    name: cc.name,
    serves: cc.serves || cc.lines || manifest.value_streams.map((v) => v.key),
    owner: cc.owner || undefined,
    aliases: cc.aliases || [],
  }));

  // shared_prerequisites
  if (raw.shared_prerequisites) {
    manifest.shared_prerequisites = raw.shared_prerequisites;
  } else if (raw.prerequisites) {
    manifest.shared_prerequisites = {
      applicable: Array.isArray(raw.prerequisites) && raw.prerequisites.length > 0,
      items: Array.isArray(raw.prerequisites) ? raw.prerequisites : [],
      reason: raw.prerequisites_reason || '',
    };
  }

  return manifest;
}

// ─── Validate output manifest ─────────────────────────────────────────────────

function validateManifest(manifest) {
  const errors = [];
  if (!manifest.scope_key) errors.push('scope_key 必填');
  if (manifest.schema_version !== 1) errors.push('schema_version 必须为 1');
  if (!manifest.value_streams?.length) errors.push('value_streams 至少一条');
  if (!manifest.capabilities?.length) errors.push('capabilities 至少一条');

  const vsKeys = new Set(manifest.value_streams?.map((v) => v.key) || []);
  for (const cap of manifest.capabilities || []) {
    if (!vsKeys.has(cap.value_stream_key)) {
      errors.push(`capability '${cap.key}' 的 value_stream_key='${cap.value_stream_key}' 不存在`);
    }
  }

  const capKeys = new Set(manifest.capabilities?.map((c) => c.key) || []);
  for (const b of manifest.boundaries || []) {
    if (!capKeys.has(b.from)) errors.push(`boundary '${b.key}' from='${b.from}' 不存在`);
    if (!capKeys.has(b.to)) errors.push(`boundary '${b.key}' to='${b.to}' 不存在`);
  }

  return errors;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const inputPath = args.input;
  const scopeKey = args.scope || 'zenithjoy';
  const decisionId = args['decision-id'];
  const outputPath = args.output;
  const shouldSubmit = args.submit;

  let rawText;
  try {
    rawText = readFileSync(inputPath, 'utf8');
  } catch (err) {
    console.error(`[adapter] 无法读取文件 ${inputPath}: ${err.message}`);
    process.exit(1);
  }

  // Parse YAML
  let raw;
  try {
    // Try js-yaml first
    const { default: yaml } = await import('js-yaml').catch(() => ({ default: null }));
    raw = yaml ? yaml.load(rawText) : basicYamlParse(rawText);
  } catch (err) {
    console.error(`[adapter] YAML 解析失败: ${err.message}`);
    process.exit(1);
  }

  // Convert to manifest
  const manifest = convertToManifest(raw, scopeKey, decisionId);

  // Validate
  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    console.error('[adapter] Manifest 校验失败:');
    errors.forEach((e) => console.error(`  - ${e}`));
    console.error('\n生成的 manifest (供参考):');
    console.error(JSON.stringify(manifest, null, 2));
    process.exit(1);
  }

  const output = JSON.stringify(manifest, null, 2);

  if (outputPath) {
    writeFileSync(outputPath, output, 'utf8');
    console.error(`[adapter] Manifest 已写入 ${outputPath}`);
  } else {
    console.log(output);
  }

  if (shouldSubmit) {
    if (!decisionId) {
      throw new Error('--submit 必须同时提供 --decision-id，拒绝无拍板法源激活');
    }
    const authHeaders = brainAuthHeaders();
    if (!authHeaders.Authorization) {
      throw new Error(
        '受信提交缺少 CECELIA_INTERNAL_TOKEN；请在宿主 credentials SSOT 配置后重试',
      );
    }
    const brainUrl = process.env.BRAIN_URL || 'http://localhost:5221';
    const requestJson = async (path, options = {}) => {
      const response = await fetch(`${brainUrl}${path}`, {
        ...options,
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
          ...(options.headers ?? {}),
        },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`${path} 返回 HTTP ${response.status}: ${JSON.stringify(body)}`);
      }
      return body;
    };
    const validation = await requestJson('/api/brain/map/manifests/validate', {
      method: 'POST',
      body: JSON.stringify(manifest),
    });
    if (validation.valid !== true) throw new Error('Brain 拒绝 manifest 校验');
    const submitted = await requestJson('/api/brain/map/manifests', {
      method: 'POST',
      body: JSON.stringify({ manifest, source_decision_id: decisionId }),
    });
    const activated = await requestJson(
      `/api/brain/map/manifests/${submitted.manifest_id}/activate`,
      { method: 'POST', body: JSON.stringify({ scope_key: scopeKey }) },
    );
    console.error(
      `[adapter] manifest ${submitted.manifest_id} 已激活，projection=${activated.projection?.projection_digest ?? 'unknown'}`,
    );
    return;
  }

  // Print submission instructions
  const BRAIN = process.env.BRAIN_URL || 'http://localhost:5221';
  console.error(`
下一步（Brain 重启并加载 migrations 后执行）：

1. 校验：
   curl -s -X POST ${BRAIN}/api/brain/map/manifests/validate \\
     -H "Authorization: Bearer \${CECELIA_INTERNAL_TOKEN}" \\
     -H "Content-Type: application/json" \\
     -d @${outputPath || '<manifest.json>'}

2. 提交：
   MANIFEST_ID=$(curl -s -X POST ${BRAIN}/api/brain/map/manifests \\
     -H "Authorization: Bearer \${CECELIA_INTERNAL_TOKEN}" \\
     -H "Content-Type: application/json" \\
     -d '{"manifest": $(cat ${outputPath || '<manifest.json>'}), "source_decision_id": "${decisionId || '<uuid>'}"}' \\
     | jq -r '.manifest_id')

3. 激活：
   curl -s -X POST ${BRAIN}/api/brain/map/manifests/$MANIFEST_ID/activate \\
     -H "Authorization: Bearer \${CECELIA_INTERNAL_TOKEN}" \\
     -H "Content-Type: application/json" \\
     -d '{"scope_key": "${scopeKey}"}'

4. 验证：
   curl -s "${BRAIN}/api/brain/map?scope=${scopeKey}" | jq '.summary'
`);
}

main().catch((err) => {
  console.error('[adapter] 致命错误:', err.message);
  process.exit(1);
});
