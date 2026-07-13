// report-data：一份评估报告的结构化数据。渲染器与端点共用。
// validateReportData 折自 skill-eval-formb-assets/render.mjs（Track 2 折回，2026-07-08）——
// 同时兼容新 anatomy.pipeline 结构和旧 anatomy.{inputs,kernel,outputs} 结构：
// 字段存在哪个就按哪个校验规则走，不强制二选一报错。
export function validateReportData(d) {
  const errs = [];
  if (!d || typeof d !== 'object') return { valid: false, errors: ['report-data 必须是对象'] };
  if (!d.skill || !d.skill.name) errs.push('skill.name 必填');
  const lv = d.verdict && d.verdict.level;
  if (!['pass', 'partial', 'fail'].includes(lv)) errs.push('verdict.level 必须是 pass|partial|fail');
  const a = d.anatomy || {};
  const hasPipeline = Array.isArray(a.pipeline) && a.pipeline.length;
  const hasLegacy = Array.isArray(a.inputs);
  if (!hasPipeline && !hasLegacy) errs.push('anatomy 需含 pipeline 或 inputs');
  if (!Array.isArray(a.outputs)) errs.push('anatomy.outputs 必须是数组');
  return { valid: errs.length === 0, errors: errs };
}
