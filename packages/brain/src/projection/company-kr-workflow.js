import { runCompanyKrProjection } from './company-key-results.js';
import { requestCompanyKrAnalysis } from '../lib/company-kr-analysis.js';

/** 唯一启动时钟：沿已有5分钟Notion回灌周期，成功读取正式设置后再安排分析。 */
export async function runCompanyKrWorkflow(pool, deps = {}) {
  const projection = await (deps.project || runCompanyKrProjection)(pool);
  if (projection.skipped) return projection;
  const analysis = await (deps.analyze || requestCompanyKrAnalysis)(pool);
  return { ...projection, analysis };
}
