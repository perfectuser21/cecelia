/**
 * Regression: weak-oracle/curl-no-jq 必须放行 inline 管道 `curl ... | grep -q '<字面量>'`。
 *
 * 背景（2026-06-26 实证）：harness 内部线 dashboard run 的合同用
 *   curl -sf "http://localhost:5211/..." | grep -q "Cecelia Harness 工厂线已贯通" || { echo FAIL; exit 1; }
 * 验证 HTML 页面（HTML 无法 jq）。但 curl-no-jq 的豁免只认 inline jq -e / 状态码 oracle /
 * capture-then-assert（VAR=$(curl) 后 grep），漏了 inline `curl | grep -q '<字面量>'` 这种
 * 验 HTML/文本响应的合法强 oracle → 误判弱断言、反复 REVISION 打回 → GAN 收敛不了、空转数小时。
 *
 * 本测试永久守死：inline curl|grep-q 字面量放行；但不能放水（裸 curl 无断言仍命中）。
 */
import { describe, it, expect } from 'vitest';
import { evaluateContractText, hasInlineGrepAssert } from '../contract-gate.js';

const wrap = (lines) => ['```bash', ...lines, '```'].join('\n');

describe('curl-no-jq 放行 inline curl|grep-q（验 HTML/文本响应的合法强 oracle）', () => {
  it('inline curl ... | grep -q "<字面量>" → 不命中 curl-no-jq', () => {
    const r = evaluateContractText(wrap([
      'curl -sf --max-time 10 "http://localhost:5211/" | grep -q "Cecelia Harness 工厂线已贯通" || { echo FAIL; exit 1; }',
    ]));
    expect(r.hits.map((h) => h.ruleId)).not.toContain('weak-oracle/curl-no-jq');
  });

  it('复现实证 dashboard 合同：curl 首页/bundle 用 inline grep 断言内容 → 放行', () => {
    const r = evaluateContractText(wrap([
      'curl -sf --max-time 10 "http://localhost:5211/" | grep -q "<!doctype html>" || { echo "FAIL: live:5211 首页不可达"; exit 1; }',
      'curl -sf --max-time 10 "http://localhost:5211/assets/app.js" | grep -q "Cecelia Harness 工厂线已贯通" || { echo "FAIL: 生产 bundle 未含固定文字"; exit 1; }',
    ]));
    expect(r.hits.map((h) => h.ruleId)).not.toContain('weak-oracle/curl-no-jq');
  });

  it('grep -Eq 变体同样放行', () => {
    const r = evaluateContractText(wrap([
      'curl -sf "http://host:5223/" | grep -Eq "状态标识已上线" || exit 1',
    ]));
    expect(r.hits.map((h) => h.ruleId)).not.toContain('weak-oracle/curl-no-jq');
  });

  it('不放水：裸 curl 无任何断言 → 仍命中 curl-no-jq', () => {
    const r = evaluateContractText(wrap([
      'curl -sf "http://localhost:5211/" || { echo FAIL; exit 1; }',
    ]));
    expect(r.hits.map((h) => h.ruleId)).toContain('weak-oracle/curl-no-jq');
  });

  it('helper hasInlineGrepAssert：curl|grep-q=true，纯 curl=false', () => {
    expect(hasInlineGrepAssert('curl -sf url | grep -q "x"')).toBe(true);
    expect(hasInlineGrepAssert('curl -sf url')).toBe(false);
    expect(hasInlineGrepAssert('echo hi')).toBe(false);
  });
});
