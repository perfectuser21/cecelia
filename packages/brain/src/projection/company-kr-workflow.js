import { runCompanyKrProjection } from './company-key-results.js';

/** 沿已有5分钟Notion回灌周期同步正式指标；退休分析不再建单或登记能力。 */
export async function runCompanyKrWorkflow(pool, deps = {}) {
  return (deps.project || runCompanyKrProjection)(pool);
}
