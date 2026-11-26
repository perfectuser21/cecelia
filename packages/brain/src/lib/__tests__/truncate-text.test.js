import { describe, it, expect } from 'vitest';
import { truncateText } from '../truncate-text.js';
import { buildRunProps } from '../../runs-notion-projection.js';

describe('truncateText', () => {
  const hasLoneSurrogate = (str) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(str);

  it('null/undefined → null；短串原样返回', () => {
    expect(truncateText(null, 10)).toBeNull();
    expect(truncateText(undefined, 10)).toBeNull();
    expect(truncateText('abc', 10)).toBe('abc');
  });

  it('普通字符串按码元截到 max', () => {
    expect(truncateText('a'.repeat(30), 10)).toHaveLength(10);
  });

  it('恰在代理对边界截断时不留孤立高代理项，且长度 <= max', () => {
    // 'a'*9 + emoji(2 码元) → 第 10 个码元是高代理项
    const s = 'a'.repeat(9) + '\u{1F600}' + 'tail';
    const out = truncateText(s, 10);
    expect(hasLoneSurrogate(out)).toBe(false);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out).toBe('a'.repeat(9));
  });

  it('代理对完整落在上限内时保留', () => {
    const out = truncateText('a'.repeat(8) + '\u{1F600}' + 'tail', 10);
    expect(out).toBe('a'.repeat(8) + '\u{1F600}');
  });

  it('历史Runs投影标题在UTF16边界仍可安全序列化', () => {
    const props = buildRunProps({run_id:'openclaw:historic',trigger_ref:'x'.repeat(199)+'😀',started_at:new Date('2026-10-07T00:00:00Z'),outcome:'pass'});
    const title = props['任务'].title[0].text.content;
    expect(title).toBe('x'.repeat(199));
    expect(hasLoneSurrogate(title)).toBe(false);
    expect(JSON.parse(JSON.stringify(props))).toEqual(props);
    expect(props['来源'].select.name).toBe('OpenClaw');
  });
});
