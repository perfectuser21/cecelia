import { registerCompanyKrWorkflow } from '../lib/company-kr-registration.js';
import { projectCompanyKrRegistration } from './company-kr-registration-notion.js';
import { runCompanyKrProjection } from './company-key-results.js';
import { requestCompanyKrAnalysis } from '../lib/company-kr-analysis.js';

/** 唯一启动时钟：沿已有5分钟Notion回灌周期，成功读取正式设置后再安排分析。 */
export async function runCompanyKrWorkflow(pool, deps = {}) {
  const projection = await (deps.project || runCompanyKrProjection)(pool);
  if (projection.skipped) return projection;
  let registration, registrationError;
  try {
    registration = await (deps.register || registerCompanyKrWorkflow)(pool);
    registration.notion = await (deps.projectRegistration || projectCompanyKrRegistration)(pool);
  } catch (error) {
    registrationError = error;
    console.warn('[company-kr-workflow] 登记同步失败:', error.message);
  }
  const analysis = await (deps.analyze || requestCompanyKrAnalysis)(pool);
  if (registrationError) throw registrationError;
  return { ...projection, analysis, registration };
}
