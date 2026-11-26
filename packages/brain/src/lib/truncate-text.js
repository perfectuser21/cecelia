/**
 * 按 UTF-16 码元截断到 max；若末码元是高代理项（代理对被从中间切开）再去掉一位，
 * 避免写入 jsonb 时被 Postgres 以孤立代理项拒收。长度上限仍按码元计，始终 <= max。
 */
export function truncateText(v, max) {
  if (v === null || v === undefined) return null;
  let out = String(v).slice(0, max);
  if (out.length > 0) {
    const last = out.charCodeAt(out.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  }
  return out;
}

