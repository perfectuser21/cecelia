// evidence-report.mjs —— 把真机验证结果回流给结晶判官
//
// 断链背景：crystal-verify 原来只把 verdict 写成本地 JSON 就完事，
// 判官的 crystal_run_evidence 表因此永远是空的。而经济门要求 20 次滚动窗内
// ≥90% 成功率——证据不回流，promote 这条路径实质是死的：技能跑得再多再好，
// 账本停在 0 条就永远晋升不了。
//
// 真机跑一次要几十秒 + 独占一台设备，白跑掉的每一次都补不回来
// （verified_at 是过去时刻，事后没法伪造）。所以回流要么成功、要么明着喊，
// 绝不能悄悄失败。

/**
 * 把 crystal-verify 的 verdict 摊成判官 POST /crystal/evidence 的入参。
 *
 * @param verdict crystal-verify 产出的判定对象
 * @param seq     对应的序列定义（用来判断有没有 postcondition 探针）
 */
/**
 * 探索阶段的平均 token —— 也就是「纯 LLM 做这件事要花多少」，即经济账的基线。
 *
 * 基线不需要专门再测一次：探索本来就是纯 LLM 在跑。它是序列的固有属性
 * （蒸馏时定下、写进序列文件），不是每次验证都要重测的东西。
 * 没有轨迹就返回 null——判官该把它当数据缺口处理，而不是当成「基线为 0」。
 */
export function averageBaselineTokens(traces) {
  if (!Array.isArray(traces) || traces.length === 0) return null;
  const vals = traces.map((t) => Number(t?.tokens)).filter(Number.isFinite);
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
}

export function buildEvidencePayload(verdict, seq = {}) {
  const runs = Number(verdict.runs) || 0;
  const passes = Number(verdict.passes) || 0;
  return {
    // 基线缺失必须是 null 而不是 0：null=没测过，0=测过且真的不烧 token。
    // 混淆二者会让判官算出假的 cost_benefit。
    baseline_tokens: Number.isFinite(seq?.baseline_tokens) ? seq.baseline_tokens : null,
    unit_key: verdict.sequence,
    verified_at: verdict.verified_at,
    runs,
    passes,
    broken_count: Math.max(0, runs - passes),
    hot_path_tokens: verdict.avg_tokens ?? null,
    avg_ms: verdict.avg_ms ?? null,
    device: verdict.device ?? null,
    crystallized: verdict.crystallized === true,
    pure_hot_path: verdict.pure_hot_path === true,
    // 从序列真实推导，不默认填 true：这是「无探针不许固化」那道闸的输入，
    // 填死会让没有探针的序列被判官当成有探针而放行。
    has_postcondition: Boolean(seq?.postcondition),
  };
}

/**
 * 回流一条证据。永不抛出——本地验证已经花掉真机时间，
 * 不该因为中台不可达而把结果一起丢掉；但失败必须在返回值里说清楚。
 */
export async function reportEvidence(verdict, seq, { url, fetchFn = fetch } = {}) {
  if (!url) return { reported: false, skipped: true, error: null };

  const payload = buildEvidencePayload(verdict, seq);
  try {
    const res = await fetchFn(`${url.replace(/\/+$/, '')}/api/brain/crystal/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { reported: false, skipped: false, error: `HTTP ${res.status} ${body.slice(0, 120)}` };
    }
    return { reported: true, skipped: false, error: null };
  } catch (e) {
    return { reported: false, skipped: false, error: String(e?.message ?? e) };
  }
}
