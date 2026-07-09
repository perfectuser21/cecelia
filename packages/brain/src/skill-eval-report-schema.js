// report-data 校验器（Sprint: skill-eval-full-4page）
// 兼容三种格式：
//   1. 新 6维度格式（有 dimensions 字段）
//   2. 旧 pipeline 格式（anatomy.pipeline）
//   3. 旧旧格式（anatomy.inputs）
export function validateReportData(d) {
  const errs = [];
  if (!d || typeof d !== 'object') return { valid: false, errors: ['report-data 必须是对象'] };
  if (!d.skill || !d.skill.name) errs.push('skill.name 必填');
  const lv = d.verdict && d.verdict.level;
  if (!['pass', 'partial', 'fail'].includes(lv)) errs.push('verdict.level 必须是 pass|partial|fail');

  // 新格式：有 dimensions 就不强制 anatomy
  const hasDimensions = d.dimensions && typeof d.dimensions === 'object';
  if (!hasDimensions) {
    // 旧格式兼容校验
    const a = d.anatomy || {};
    const hasPipeline = Array.isArray(a.pipeline) && a.pipeline.length;
    const hasLegacy = Array.isArray(a.inputs);
    if (!hasPipeline && !hasLegacy) errs.push('anatomy 需含 pipeline 或 inputs（或提供 dimensions）');
    if (!Array.isArray(a.outputs)) errs.push('anatomy.outputs 必须是数组（旧格式）');
  }

  return { valid: errs.length === 0, errors: errs };
}
