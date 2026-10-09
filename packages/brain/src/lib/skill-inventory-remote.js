/**
 * skill-inventory-remote.js — 三平台 skill 远端采集（Skill 台账投影 PR1a，任务 47def5bb）
 *
 * collectSkillInventory 必须【自包含】：整个函数经 toString() 送到 mmv，交给 `node -` 执行（us-vps 零执行）。
 * 所以函数体里只能用 process.getBuiltinModule 取内置模块，不能用 import()——vitest 会把 import() 改写成
 * __vite_ssr_dynamic_import__，toString() 送到远端后会报 ReferenceError（代审实测复现）。
 * 也不能引用模块作用域里的任何东西。
 *
 * 探不到 ≠ 零个：某个来源读不到（根目录缺失 / openclaw 任一 agent 失败或超预算）→ 该来源整体 status=fail，
 * 由 Brain 侧把它排除在缺席判定之外（判定点 e22aab26）。
 */
export async function collectSkillInventory(opts = {}) {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const crypto = process.getBuiltinModule('node:crypto');
  const cp = process.getBuiltinModule('node:child_process');
  const home = opts.home || process.env.HOME;
  const repoRoot = opts.repoRoot || path.join(home, 'perfect21/zenithjoy-skills');
  const openclawBin = opts.openclawBin || 'openclaw';
  const budgetMs = opts.budgetMs ?? 150_000;
  const agentTimeoutMs = opts.agentTimeoutMs ?? 45_000;
  const concurrency = opts.concurrency ?? 4;
  const maxBytes = opts.maxContentBytes ?? 512 * 1024;
  const started = Date.now();
  const contents = {};
  const OC_KEEP = new Set(['openclaw-workspace', 'openclaw-managed', 'openclaw-workshop', 'agents-skills-personal']);

  const listFiles = (dir) => {
    const out = [];
    const walk = (d, rel, depth) => {
      if (out.length >= 200 || depth > 4) return;
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries.sort((x, y) => x.name.localeCompare(y.name))) {
        if (out.length >= 200) return;
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        let st;
        try { st = fs.statSync(path.join(d, e.name)); } catch { continue; }
        if (st.isDirectory()) walk(path.join(d, e.name), r, depth + 1); else out.push(r);
      }
    };
    walk(dir, '', 0);
    return out;
  };

  const readSkill = (name, dir) => {
    const file = path.join(dir, 'SKILL.md');
    const buf = fs.readFileSync(file);
    const truncated = buf.length > maxBytes;
    const text = (truncated ? buf.subarray(0, maxBytes) : buf).toString('utf8');
    const digest = crypto.createHash('sha256').update(buf).digest('hex');
    contents[digest] = text;
    let realPath = file;
    try { realPath = fs.realpathSync(file); } catch { /* 保持原路径 */ }
    return { name, path: file, real_path: realPath, digest, lines: text.split('\n').length, truncated, files: listFiles(dir) };
  };

  // 扫一个根目录：<root>/<skill>/SKILL.md，或一层分组 <root>/<group>/<skill>/SKILL.md
  const scanRoot = (root, { grouped = false } = {}) => {
    if (!fs.existsSync(root)) return { status: 'fail', error: `root_missing: ${root}`, items: [], broken: [] };
    const items = [];
    const broken = [];
    for (const e of fs.readdirSync(root, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(root, e.name);
      let st;
      try { st = fs.statSync(p); } catch { if (e.isSymbolicLink()) broken.push(e.name); continue; }
      if (!st.isDirectory()) continue;
      if (fs.existsSync(path.join(p, 'SKILL.md'))) {
        try { items.push(readSkill(e.name, p)); } catch { /* 读不了的单项跳过 */ }
      } else if (grouped) {
        for (const g of fs.readdirSync(p, { withFileTypes: true })) {
          const gp = path.join(p, g.name);
          try { if (fs.statSync(gp).isDirectory() && fs.existsSync(path.join(gp, 'SKILL.md'))) items.push(readSkill(g.name, gp)); } catch { /* skip */ }
        }
      }
    }
    return { status: 'ok', items, broken };
  };

  const findSkillDir = (root, name) => {
    if (!root || !fs.existsSync(root)) return null;
    const direct = path.join(root, name);
    if (fs.existsSync(path.join(direct, 'SKILL.md'))) return direct;
    for (const g of fs.readdirSync(root)) {
      const p = path.join(root, g, name);
      if (fs.existsSync(path.join(p, 'SKILL.md'))) return p;
    }
    return null;
  };

  const runAgent = (id) => new Promise((resolve, reject) => {
    cp.execFile(openclawBin, ['skills', 'list', '--agent', id, '--json'],
      { timeout: agentTimeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(new Error(`${id}: ${String(err.message || err).split('\n')[0].slice(0, 120)}`));
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error(`${id}: invalid json`)); }
      });
  });

  const scanOpenclaw = async () => {
    let entries;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(home, '.openclaw/openclaw.json'), 'utf8'));
      entries = cfg?.agents?.entries || {};
    } catch (err) {
      return { status: 'fail', error: `config: ${String(err.message).slice(0, 120)}` };
    }
    const ids = Object.keys(entries);
    const results = {};
    const errors = [];
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        if (Date.now() - started > budgetMs) { errors.push(`${id}: budget exceeded`); continue; }
        try { results[id] = await runAgent(id); } catch (err) { errors.push(err.message); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
    if (errors.length) return { status: 'fail', error: errors.slice(0, 5).join('; ') };

    const byPath = new Map();
    for (const id of ids) {
      const r = results[id] || {};
      const allow = Array.isArray(entries[id]?.skills) ? entries[id].skills : null;
      for (const s of r.skills || []) {
        if (!OC_KEEP.has(s.source)) continue;
        let root = null;
        if (s.source === 'openclaw-workspace') root = r.workspaceDir ? path.join(r.workspaceDir, 'skills') : null;
        else if (s.source === 'openclaw-managed') root = r.managedSkillsDir;
        else if (s.source === 'openclaw-workshop') root = path.join(home, '.openclaw/agents', id, 'agent/workshop-skills');
        else root = path.join(home, '.agents/skills');
        const dir = findSkillDir(root, s.name);
        if (!dir) continue;
        const key = `${s.name}@${dir}`;
        if (!byPath.has(key)) {
          try { byPath.set(key, { ...readSkill(s.name, dir), source: s.source, agents: [], assigned: [] }); } catch { continue; }
        }
        const item = byPath.get(key);
        item.agents.push(id);
        if ((allow && allow.includes(s.name)) || s.source === 'openclaw-workspace') item.assigned.push(id);
      }
    }
    return { status: 'ok', items: [...byPath.values()] };
  };

  const repoScan = scanRoot(repoRoot);
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    sources: {
      claude: scanRoot(path.join(home, '.claude/skills')),
      agents: scanRoot(path.join(home, '.agents/skills'), { grouped: true }),
      repo: { status: repoScan.status, error: repoScan.error, items: repoScan.items },
      openclaw: await scanOpenclaw(),
    },
    contents,
  };
}

/** 拼远端程序：自包含函数 + 调用 + 输出一行 JSON。失败也输出 JSON（ok:false），退出码 2。 */
export function buildRemoteProgram(opts = {}) {
  return `(${collectSkillInventory.toString()})(${JSON.stringify(opts)})`
    + '.then((r) => process.stdout.write(JSON.stringify(r)))'
    + '.catch((e) => { process.stdout.write(JSON.stringify({ ok: false, error: String((e && e.message) || e) })); process.exit(2); });';
}

/** mmv 上执行程序的 shell：补 PATH（ssh 非交互 shell 可能没有 homebrew），base64 送达，命令行里没有单引号。 */
export function buildRemoteShell(program) {
  const b64 = Buffer.from(program, 'utf8').toString('base64');
  return `export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH; echo ${b64} | (base64 -d 2>/dev/null || base64 -D) | node -`;
}
