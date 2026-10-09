/** 设备清单人管字段入口；技术映射与机器镜子字段始终留在台账。 */
const plain = p => (p?.title ?? p?.rich_text ?? []).map(t => t.plain_text ?? t.text?.content ?? '').join('').trim();
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unique = a => [...new Set(a.filter(Boolean))];
const safe = s => { if (/[\t\r\n\0]/.test(String(s))) throw new Error('字段含非法控制字符'); return s; };
const accountOf = text => {
  const s = safe(text.trim());
  const m = s.match(/^(.*?)\s*[（(]([A-Za-z0-9_-]+)[）)]$/);
  return m ? { nickname: m[1].trim(), id: m[2] } : { nickname: s, id: null };
};
function accountsOf(raw, previous) {
  if (!raw) return { accounts: [], wechat: null, douyinSource: '', wechatSource: '' };
  const parts = raw.split(/[|｜]/).map(s => s.trim());
  if (parts.length > 2 || !/^抖音[：:]/.test(parts[0])) throw new Error('账号格式不明确');
  const [primary, ...secondary] = parts[0].replace(/^抖音[：:]\s*/, '').split(/[；;]/).map(s => s.trim());
  const currentText = primary.replace(/【(?:当前|唯一)】$/, '').trim();
  const current = accountOf(currentText);
  if (!current.nickname) throw new Error('账号昵称为空');
  const accounts = [{ ...current, current: true }];
  for (const text of secondary) {
    if (!/^副号[：:]/.test(text)) throw new Error('副账号格式不明确');
    const a = accountOf(text.replace(/^副号[：:]\s*/, ''));
    if (!a.nickname) throw new Error('副账号为空');
    accounts.push({ ...a, current: false });
  }
  for (const a of accounts) if (!a.id) a.id = previous?.find(p => p.nickname === a.nickname)?.id ?? null;
  if (new Set(accounts.map(a => a.nickname)).size !== accounts.length) throw new Error('账号重复');
  let wechat = null;
  const wechatSource = parts[1] ?? null;
  if (wechatSource !== null) {
    if (!/^微信[：:]/.test(wechatSource)) throw new Error('微信账号格式不明确');
    const content = wechatSource.replace(/^微信[：:]\s*/, '').trim();
    if (content && !content.startsWith('未登录')) {
      // 视频号是独立信息，不进入微信身份字段。
      wechat = accountOf(content.split(/[，,]/)[0]);
      if (!wechat.id || !wechat.nickname) throw new Error('微信账号缺少明确ID');
    }
  }
  return { accounts, wechat, douyinSource: parts[0], wechatSource };
}
export function parseNotionPhone(page, row = {}, baseline = {}) {
  const p = page?.properties ?? {};
  if (p['类型']?.select?.name !== '安卓手机') return null;
  const serial = safe(plain(p['序列号']));
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(serial)) throw new Error('序列号非法');
  const title = safe(plain(p['名称']));
  if (!title) throw new Error('名称为空');
  const name = title.match(/^(.*?)[（(]([^（）()]+)[）)]$/);
  const nickname = (name?.[1] ?? title).trim();
  if (!nickname) throw new Error('名称为空');
  const aliases = name ? name[2].split(/[、，,]/).map(x => x.trim()).filter(Boolean) : [];
  const source = { nickname, aliases };
  const fields = { nickname, aliases: unique([...(row.aliases ?? []).filter(a => !(baseline.aliases ?? []).includes(a)), ...aliases]) };
  if (own(p, '归属')) source.owner = fields.owner = safe(p['归属']?.select?.name ?? null);
  const role = plain(p['备注']).match(/^(研发|生产)机(?:\s|[·，,]|$)/)?.[1];
  if (role) source.role = fields.role = role;
  if (own(p, '账号')) {
    const a = accountsOf(safe(plain(p['账号'])), row.douyin_accounts);
    fields.douyin_accounts = a.accounts; source.douyin_accounts = a.douyinSource;
    if (a.wechatSource !== null) { fields.wechat = a.wechat; source.wechat = a.wechatSource; }
  }
  return { pageId: page.id, serial, fields, source };
}
export function planPhoneChanges(pages, rows, baselines = {}) {
  const out = { changes: [], baselines: { ...baselines }, invalid: [], unchanged: [] };
  const bySerial = new Map(rows.map(r => [r.serial, r]));
  const counts = new Map();
  for (const p of pages) {
    if (p?.properties?.['类型']?.select?.name !== '安卓手机') continue;
    const serial = plain(p.properties['序列号']); counts.set(serial, (counts.get(serial) ?? 0) + 1);
  }
  for (const page of pages) {
    try {
      const serial = plain(page?.properties?.['序列号']);
      if (page?.properties?.['类型']?.select?.name !== '安卓手机') continue;
      if (counts.get(serial) !== 1) throw new Error('重复序列号');
      const row = bySerial.get(serial); if (!row) throw new Error('未知序列号，先登记技术映射');
      const prior = baselines[serial] ?? {};
      const parsed = parseNotionPhone(page, row, prior);
      const fields = {}; const before = {};
      for (const [key, value] of Object.entries(parsed.fields)) {
        if ((!own(prior, key) || !same(prior[key], parsed.source[key])) && !same(row[key], value)) {
          fields[key] = value; before[key] = row[key] ?? null;
        }
      }
      out.baselines[serial] = { ...prior, ...parsed.source };
      if (Object.keys(fields).length) out.changes.push({ serial, pageId: parsed.pageId, fields, before });
      else out.unchanged.push(serial);
    } catch (err) { out.invalid.push({ pageId: page.id, error: err.message }); }
  }
  return out;
}
