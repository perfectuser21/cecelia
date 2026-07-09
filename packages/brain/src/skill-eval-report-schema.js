// report-data schema 校验 — v2 支持 6 维度结构（dimensions 对象）+ 向后兼容 v1（anatomy-only）
export function validateReportData(d) {
  const errs = [];
  if (!d || typeof d !== 'object') return { valid: false, errors: ['report-data 必须是对象'] };
  if (!d.skill || !d.skill.name) errs.push('skill.name 必填');
  const lv = d.verdict && d.verdict.level;
  if (!['pass', 'partial', 'fail'].includes(lv)) errs.push('verdict.level 必须是 pass|partial|fail');

  // v2: 含 dimensions 对象（6 维度评估）
  if (d.dimensions && typeof d.dimensions === 'object') {
    const dims = ['functional_map', 'dependency_audit', 'logic_soundness', 'output_verifiability', 'redline', 'maturity'];
    for (const dim of dims) {
      if (!d.dimensions[dim]) errs.push(`dimensions.${dim} 必填`);
    }
    return { valid: errs.length === 0, errors: errs, version: 'v2' };
  }

  // v1: 旧 anatomy-only 格式（向后兼容）
  const a = d.anatomy || {};
  const hasPipeline = Array.isArray(a.pipeline) && a.pipeline.length;
  const hasLegacy = Array.isArray(a.inputs);
  if (!hasPipeline && !hasLegacy) errs.push('anatomy 需含 pipeline 或 inputs');
  if (!Array.isArray(a.outputs)) errs.push('anatomy.outputs 必须是数组');
  return { valid: errs.length === 0, errors: errs, version: 'v1' };
}
