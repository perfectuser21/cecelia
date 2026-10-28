// 旧正文由可信活动读取固定 Git 字节；模型只收到数据，不执行正文中的指令。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { validateAuthority, loadAuthorityIndex, resolveAuthority, commitAvailable } from './authority-refs.mjs';
import { renderIntent } from './intent.mjs';
import { parseFrontmatter } from './md-chain.mjs';
import { validateBase } from './protocol.mjs';

const SECTION = '## 旧资料引用事实';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const reject = code => { throw new Error(code); };
const unconfigured = () => ({ status: 'unconfigured', refs: [], rules: [], approvals: [] });
const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], {
  stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024,
  env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'].includes(key))), GIT_NO_REPLACE_OBJECTS: '1' },
});

/** 稳定规则取自冻结 rule 原文：显式锚点或无 ID 旧版的顶层项目符号。 */
export function registeredRules(refs) {
  const out = [];
  for (const ref of refs.filter(r => r.kind === 'rule')) {
    const lines = ref.content.split(/\r?\n/); let current = null; let fence = null;
    if (!lines.some(line => /^<!-- rule: [a-z][a-z0-9_-]{0,63} -->$/.test(line))) {
      let start = -1; let ordinal = 0; let block = []; fence = null;
      const finishLegacy = () => {
        if (start < 0) return;
        const ruleText = block.join('\n').trim();
        if (!ruleText) reject('baseline_rule_empty');
        ordinal++;
        const digest = hash(Buffer.from(ruleText));
        const ruleId = `legacy-${hash(Buffer.from(JSON.stringify([ref.ref_id, ref.revision, ref.path, ordinal, digest]))).slice(0, 24)}`;
        out.push({ ref_id: ref.ref_id, rule_id: ruleId, text: ruleText, line: start + 1, ordinal });
        start = -1; block = [];
      };
      lines.forEach((line, index) => {
        const marker = /^\s*(`{3,}|~{3,})/.exec(line);
        if (marker) { if (!fence) fence = marker[1][0]; else if (fence === marker[1][0]) fence = null; }
        if (fence) { if (start >= 0) block.push(line); return; }
        if (/^#{1,6}\s/.test(line)) { finishLegacy(); return; }
        if (/^-\s+\S/.test(line)) { finishLegacy(); start = index; block = [line]; return; }
        if (start >= 0) block.push(line);
      });
      finishLegacy();
      if (!ordinal) reject('baseline_rules_unconfigured');
      continue;
    }
    const finish = () => {
      if (!current) return;
      const text = current.lines.join('\n').trim();
      if (!text) reject('baseline_rule_empty');
      out.push({ ref_id: ref.ref_id, rule_id: current.id, text });
    };
    const seen = new Set();
    for (const line of lines) {
      const fenced = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fenced) { if (!fence) fence = fenced[1][0]; else if (fence === fenced[1][0]) fence = null; }
      const marker = !fence && /^<!-- rule: ([a-z][a-z0-9_-]{0,63}) -->$/.exec(line);
      if (marker) {
        finish(); if (seen.has(marker[1])) reject('baseline_rule_duplicate');
        seen.add(marker[1]); current = { id: marker[1], lines: [] };
      } else if (current) current.lines.push(line);
    }
    finish(); if (!seen.size) reject('baseline_rules_unconfigured');
  }
  return out;
}

// 一期有限批准协议：真实冻结 I 条目以独立句声明“批准修改 rule#cw-x”等。
// 不识别背景、代码围栏、任意引用；未识别的批准保持缺口，不让模型补造。
function approvalsOf(body, refs, rules, intentIds) {
  const approvals = []; const ids = []; let current = null; let fence = null;
  const actions = { 修改: 'modify', 更新: 'update', 废弃: 'retire' };
  for (const line of body.split(/\r?\n/)) {
    const fenced = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenced) { if (!fence) fence = fenced[1][0]; else if (fence === fenced[1][0]) fence = null; continue; }
    if (fence) continue;
    const heading = /^### (I-\d+)(?:\s.*)?$/.exec(line);
    if (heading) { current = heading[1]; ids.push(current); continue; }
    if (/^#{1,3}\s/.test(line)) { current = null; continue; }
    if (!current) continue;
    for (const sentence of line.split(/[；;。]/)) {
      const match = /^\s*批准(修改|更新|废弃)\s+([a-z][a-z0-9_-]{0,63})(?:#([a-z][a-z0-9_-]{0,63}))?\s*$/.exec(sentence);
      if (!match) continue;
      const [, verb, ref_id, rule_id] = match; const action = actions[verb];
      if (!refs.some(r => r.ref_id === ref_id) || rule_id && !rules.some(r => r.ref_id === ref_id && r.rule_id === rule_id)) reject('baseline_approval_target_unknown');
      if (rule_id ? !['modify', 'retire'].includes(action) : !['update', 'retire'].includes(action)) reject('baseline_approval_action_invalid');
      approvals.push({ ref_id, ...(rule_id ? { rule_id } : {}), action, intent_id: current });
    }
  }
  if (new Set(ids).size !== ids.length || JSON.stringify(ids) !== JSON.stringify(intentIds)) reject('baseline_intent_ids_mismatch');
  return approvals;
}

export function loadBaselineContext(input) {
  let intent = '';
  if (input.worktree && input.sprint_dir) {
    const { dir } = validateBase(input); const file = path.join(dir, '01-intent.md');
    if (fs.existsSync(file)) {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 2 * 1024 * 1024) reject('baseline_intent_invalid');
      intent = fs.readFileSync(file, 'utf8');
    }
  }
  const preItems = intent.split(/^### I-\d+/m)[0];
  const sections = preItems.split(/^## 旧资料引用事实\r?\n/m);
  const factSection = sections.length > 1 ? sections.at(-1).trim() : '';
  const managed = input.authority_required === true || input.authority !== undefined || /^- object_id: .+\r?\n  ref_id: /m.test(factSection);
  if (!managed) return unconfigured();
  if (input.authority_required !== true || !input.authority || !input.trusted_repo || !input.authority_index_sha) reject('baseline_binding_missing');
  if (!intent || !/^[a-f0-9]{64}$/.test(input.intent_sha256 || '') || hash(intent) !== input.intent_sha256) reject('baseline_intent_hash_mismatch');
  const parsed = parseFrontmatter(intent);
  if (parsed?.data.task_id !== input.task_id || parsed?.data.step !== 'intent') reject('baseline_intent_identity_mismatch');
  const index = loadAuthorityIndex(input.trusted_repo, input.authority_index_sha);
  const errors = validateAuthority(input.authority, index); if (errors.length) reject(errors[0]);
  if (!commitAvailable(input.worktree, input.initial_base_sha)) reject('baseline_base_unavailable');
  const facts = resolveAuthority(input.trusted_repo, input.authority.refs, { trustedSha: input.authority_index_sha })
    .map(f => ({ ...f, object_id: input.authority.object_id }));
  if (facts.some(f => f.status !== 'found')) reject(facts.find(f => f.status !== 'found').reason);
  const expected = renderIntent({ taskId: input.task_id, title: '', items: [], authorityFacts: facts }).split(SECTION + '\n')[1].trim();
  if (factSection !== expected) reject('baseline_intent_refs_mismatch');
  let bytesRead = 0;
  const refs = facts.map(f => {
    const bytes = git(input.trusted_repo, ['show', `${f.revision}:${f.path}`]); bytesRead += bytes.length;
    if (bytesRead > 512 * 1024) reject('baseline_content_too_large');
    if (hash(bytes) !== f.actual_digest) reject('baseline_content_digest_mismatch');
    let content; try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { reject('baseline_content_not_text'); }
    return { ...f, content };
  });
  const rules = registeredRules(refs);
  const approvals = approvalsOf(parsed.body, refs, rules, input.intent_ids);
  return { status: 'managed', object_id: input.authority.object_id, base_sha: input.initial_base_sha, index_sha: input.authority_index_sha, refs, rules, approvals };
}

export function renderBaselineContext(baseline) {
  return JSON.stringify(baseline, null, 2);
}
