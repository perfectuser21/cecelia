// report-data：一份评估报告的结构化数据。渲染器与端点共用。
export function validateReportData(d) {
  const errs = [];
  if (!d || typeof d !== 'object') return { valid: false, errors: ['report-data 必须是对象'] };
  if (!d.skill || !d.skill.name) errs.push('skill.name 必填');
  const lv = d.verdict && d.verdict.level;
  if (!['pass', 'partial', 'fail'].includes(lv)) errs.push('verdict.level 必须是 pass|partial|fail');
  const a = d.anatomy || {};
  if (!Array.isArray(a.inputs)) errs.push('anatomy.inputs 必须是数组');
  if (!a.kernel || !Array.isArray(a.kernel.rules)) errs.push('anatomy.kernel.rules 必须是数组');
  if (!Array.isArray(a.outputs)) errs.push('anatomy.outputs 必须是数组');
  return { valid: errs.length === 0, errors: errs };
}
