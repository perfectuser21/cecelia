/**
 * OKR Structure Validator (L0)
 *
 * 基于 config/okr-validation-spec.yml 对 DB 中的 OKR 结构进行验证。
 * 纯代码检查，不涉及 LLM。
 *
 * 用法：
 *   // 运行时（指定 scope）
 *   const result = await validateOkrStructure(pool, { scope: 'kr', rootId: krId });
 *
 *   // CI 全量
 *   const result = await validateOkrStructure(pool, { scope: 'full' });
 *
 *   // 返回值
 *   // { ok: boolean, issues: ValidationIssue[] }
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Spec 加载 ───────────────────────────────────────────

let _cachedSpec = null;

/**
 * 加载并缓存 okr-validation-spec.yml
 * @param {string} [specPath] - 自定义路径（测试用）
 * @returns {object} 解析后的 spec 对象
 */
export function loadSpec(specPath) {
  if (_cachedSpec && !specPath) return _cachedSpec;
  const p = specPath || resolve(__dirname, '../../config/okr-validation-spec.yml');
  const raw = readFileSync(p, 'utf8');
  const spec = yaml.load(raw);
  if (!specPath) _cachedSpec = spec;
  return spec;
}

/** 清除缓存（测试用） */
export function _resetSpecCache() {
  _cachedSpec = null;
}

// ─── Issue 构造 ──────────────────────────────────────────

/**
 * @typedef {Object} ValidationIssue
 * @property {string} level - BLOCK | WARNING | INFO
 * @property {string} entity - 表名 (goals / projects / tasks / pr_plans)
 * @property {string|null} entityId - 实体 UUID
 * @property {string} rule - 规则标识
 * @property {string} message - 人可读描述
 */

function issue(level, entity, entityId, rule, message) {
  return { level, entity, entityId: entityId || null, rule, message };
}

// ─── Active Status Filter ────────────────────────────────

function buildStatusFilter(spec, table) {
  const statuses = spec.global_rules?.active_status_filter?.[table];
  if (!statuses || statuses.length === 0) return '';
  const quoted = statuses.map(s => `'${s}'`).join(', ');
  return `status IN (${quoted})`;
}

// ─── 主入口 ──────────────────────────────────────────────

/**
 * 验证 OKR 结构完整性。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @param {Object} options
 * @param {'full'|'kr'} options.scope - 'full' 全量 | 'kr' 指定 KR 子树
 * @param {string} [options.rootId] - scope='kr' 时必填，KR 的 goal id
 * @param {string} [options.specPath] - 自定义 spec 路径（测试用）
 * @returns {Promise<{ok: boolean, issues: ValidationIssue[]}>}
 */
export async function validateOkrStructure(pool, options = {}) {
  const { scope = 'full', rootId, specPath } = options;
  const spec = loadSpec(specPath);
  const issues = [];

  if (scope === 'kr' && !rootId) {
    issues.push(issue('BLOCK', 'system', null, 'missing_root_id', 'scope=kr 时必须提供 rootId'));
    return { ok: false, issues };
  }

  // 拉取活跃数据
  const data = await fetchData(pool, spec, scope, rootId);

  // 1. goals 各类型检查
  if (spec.goals) {
    for (const [goalType, rules] of Object.entries(spec.goals)) {
      const rows = data.goals.filter(g => g.type === goalType);
      for (const row of rows) {
        checkRequiredFields(issues, 'goals', row, rules.required_fields, goalType);
        checkParentRules(issues, 'goals', row, rules.parent_rules, data, goalType);
        checkChildrenCount(issues, 'goals', row, rules.children, data, goalType);
        checkTextRules(issues, 'goals', row, rules.text_rules, goalType);
      }
    }
  }

  // 2. projects 各类型检查
  if (spec.projects) {
    for (const [projType, rules] of Object.entries(spec.projects)) {
      const rows = data.projects.filter(p => p.type === projType);
      for (const row of rows) {
        checkRequiredFields(issues, 'projects', row, rules.required_fields, projType);
        checkParentRules(issues, 'projects', row, rules.parent_rules, data, projType);
        checkChildrenCount(issues, 'projects', row, rules.children, data, projType);
        checkTextRules(issues, 'projects', row, rules.text_rules, projType);
      }
    }
  }

  // 3. pr_plans 检查
  if (spec.pr_plans) {
    for (const row of data.prPlans) {
      checkRequiredFields(issues, 'pr_plans', row, spec.pr_plans.required_fields, 'pr_plan');
      checkParentRules(issues, 'pr_plans', row, spec.pr_plans.parent_rules, data, 'pr_plan');
      checkChildrenCount(issues, 'pr_plans', row, spec.pr_plans.children, data, 'pr_plan');
      checkTextRules(issues, 'pr_plans', row, spec.pr_plans.text_rules, 'pr_plan');
    }
    // 依赖环检测
    if (spec.pr_plans.dependency_graph?.detect_cycle) {
      detectCycles(issues, data.prPlans, spec.pr_plans.dependency_graph);
    }
  }

  // 4. tasks 检查
  if (spec.tasks) {
    for (const row of data.tasks) {
      checkRequiredFields(issues, 'tasks', row, spec.tasks.required_fields, 'task');
      checkParentRules(issues, 'tasks', row, spec.tasks.parent_rules, data, 'task');
      checkTextRules(issues, 'tasks', row, spec.tasks.text_rules, 'task');
    }
  }

  // 5. 全局孤儿检测
  if (spec.global_rules?.orphans) {
    for (const orphanRule of spec.global_rules.orphans) {
      checkOrphans(issues, orphanRule, data);
    }
  }

  const ok = !issues.some(i => i.level === 'BLOCK');
  return { ok, issues };
}

// ─── 数据拉取 ────────────────────────────────────────────

async function fetchData(pool, spec, scope, rootId) {
  const goalFilter = buildStatusFilter(spec, 'goals');
  const projectFilter = buildStatusFilter(spec, 'projects');
  const taskFilter = buildStatusFilter(spec, 'tasks');

  if (scope === 'kr' && rootId) {
    return fetchKrScope(pool, rootId, goalFilter, projectFilter, taskFilter);
  }
  return fetchFullScope(pool, goalFilter, projectFilter, taskFilter);
}

async function fetchFullScope(pool, goalFilter, projectFilter, taskFilter) {
  const goalWhere = goalFilter ? `WHERE ${goalFilter}` : '';
  const projectWhere = projectFilter ? `WHERE ${projectFilter}` : '';
  const taskWhere = taskFilter ? `WHERE ${taskFilter}` : '';

  const [goalsRes, projectsRes, tasksRes, prPlansRes, krLinksRes] = await Promise.all([
    pool.query(`SELECT * FROM goals ${goalWhere}`),
    pool.query(`SELECT * FROM projects ${projectWhere}`),
    pool.query(`SELECT * FROM tasks ${taskWhere}`),
    pool.query(`SELECT * FROM pr_plans WHERE status NOT IN ('completed', 'cancelled')`),
    pool.query(`SELECT * FROM project_kr_links`),
  ]);

  return {
    goals: goalsRes.rows,
    projects: projectsRes.rows,
    tasks: tasksRes.rows,
    prPlans: prPlansRes.rows,
    krLinks: krLinksRes.rows,
    goalIndex: indexById(goalsRes.rows),
    projectIndex: indexById(projectsRes.rows),
  };
}

async function fetchKrScope(pool, krId, goalFilter, projectFilter, taskFilter) {
  const goalFilterClause = goalFilter ? `AND ${goalFilter}` : '';
  const projectFilterClause = projectFilter ? `AND ${projectFilter}` : '';
  const taskFilterClause = taskFilter ? `AND ${taskFilter}` : '';

  // 递归查 KR 下所有 goals
  const goalsRes = await pool.query(`
    WITH RECURSIVE tree AS (
      SELECT * FROM goals WHERE id = $1
      UNION ALL
      SELECT g.* FROM goals g JOIN tree t ON g.parent_id = t.id
    )
    SELECT * FROM tree WHERE 1=1 ${goalFilterClause}
  `, [krId]);

  // 通过 project_kr_links 找关联 projects
  const krIds = goalsRes.rows.filter(g => g.type === 'area_kr' || g.type === 'kr').map(g => g.id);
  let projects = [];
  let krLinks = [];
  if (krIds.length > 0) {
    const krLinksRes = await pool.query(
      `SELECT * FROM project_kr_links WHERE kr_id = ANY($1)`, [krIds]
    );
    krLinks = krLinksRes.rows;
    const projectIds = krLinks.map(l => l.project_id);
    if (projectIds.length > 0) {
      const projectsRes = await pool.query(`
        WITH RECURSIVE ptree AS (
          SELECT * FROM projects WHERE id = ANY($1)
          UNION ALL
          SELECT p.* FROM projects p JOIN ptree pt ON p.parent_id = pt.id
        )
        SELECT * FROM ptree WHERE 1=1 ${projectFilterClause}
      `, [projectIds]);
      projects = projectsRes.rows;
    }
  }

  const projectAllIds = projects.map(p => p.id);
  let tasks = [];
  let prPlans = [];
  if (projectAllIds.length > 0) {
    const [tasksRes, prPlansRes] = await Promise.all([
      pool.query(
        `SELECT * FROM tasks WHERE project_id = ANY($1) ${taskFilterClause}`, [projectAllIds]
      ),
      pool.query(
        `SELECT * FROM pr_plans WHERE project_id = ANY($1) AND status NOT IN ('completed', 'cancelled')`,
        [projectAllIds]
      ),
    ]);
    tasks = tasksRes.rows;
    prPlans = prPlansRes.rows;
  }

  return {
    goals: goalsRes.rows,
    projects,
    tasks,
    prPlans,
    krLinks,
    goalIndex: indexById(goalsRes.rows),
    projectIndex: indexById(projects),
  };
}

function indexById(rows) {
  const map = {};
  for (const r of rows) map[r.id] = r;
  return map;
}

// ─── 检查函数 ────────────────────────────────────────────

function checkRequiredFields(issues, entity, row, requiredFields, subtype) {
  if (!requiredFields) return;
  for (const field of requiredFields) {
    const val = row[field];
    if (val === null || val === undefined || val === '') {
      issues.push(issue(
        'BLOCK', entity, row.id, 'required_field',
        `${subtype}[${row.id}] 缺少必须字段: ${field}`
      ));
    }
  }
}

function checkParentRules(issues, entity, row, parentRules, data, subtype) {
  if (!parentRules) return;

  for (const [field, rule] of Object.entries(parentRules)) {
    // 特殊处理：kr_link（project 通过 project_kr_links 关联 KR）
    if (field === 'kr_link') {
      const links = data.krLinks.filter(l => l.project_id === row.id);
      if (rule.min && links.length < rule.min) {
        issues.push(issue(
          rule.severity || 'WARNING', entity, row.id, 'kr_link_min',
          rule.message || `${subtype}[${row.id}] KR 关联数 ${links.length} < ${rule.min}`
        ));
      }
      continue;
    }

    // must_be_null 检查（global_okr 不应有 parent）
    if (rule.must_be_null) {
      if (row[field] !== null && row[field] !== undefined) {
        issues.push(issue(
          rule.severity || 'BLOCK', entity, row.id, 'parent_must_be_null',
          rule.message || `${subtype}[${row.id}].${field} 应为 null`
        ));
      }
      continue;
    }

    const parentId = row[field];

    // parent 存在性 + type 一致性（goals）
    if (rule.must_exist_in_goals) {
      if (!parentId || !data.goalIndex[parentId]) {
        issues.push(issue(
          rule.severity || 'BLOCK', entity, row.id, 'parent_not_found',
          rule.message || `${subtype}[${row.id}].${field} 指向不存在的 goal`
        ));
        continue;
      }
      if (rule.parent_type) {
        const parent = data.goalIndex[parentId];
        if (parent && parent.type !== rule.parent_type) {
          issues.push(issue(
            rule.severity || 'BLOCK', entity, row.id, 'parent_type_mismatch',
            `${subtype}[${row.id}].${field} 指向 ${parent.type}，应为 ${rule.parent_type}`
          ));
        }
      }
    }

    // parent 存在性 + type 一致性（projects）
    if (rule.must_exist_in_projects) {
      if (!parentId || !data.projectIndex[parentId]) {
        issues.push(issue(
          rule.severity || 'BLOCK', entity, row.id, 'parent_not_found',
          rule.message || `${subtype}[${row.id}].${field} 指向不存在的 project`
        ));
        continue;
      }
      if (rule.parent_type) {
        const parent = data.projectIndex[parentId];
        if (parent && parent.type !== rule.parent_type) {
          issues.push(issue(
            rule.severity || 'BLOCK', entity, row.id, 'parent_type_mismatch',
            `${subtype}[${row.id}].${field} 指向 ${parent.type}，应为 ${rule.parent_type}`
          ));
        }
      }
    }
  }
}

function checkChildrenCount(issues, entity, row, childrenRules, data, subtype) {
  if (!childrenRules) return;

  for (const [childType, rule] of Object.entries(childrenRules)) {
    let count = 0;

    if (childType === 'global_kr' || childType === 'area_okr' || childType === 'area_kr') {
      count = data.goals.filter(g => g.parent_id === row.id && g.type === childType).length;
    } else if (childType === 'project') {
      count = data.krLinks.filter(l => l.kr_id === row.id).length;
    } else if (childType === 'initiative') {
      count = data.projects.filter(p => p.parent_id === row.id && p.type === 'initiative').length;
    } else if (childType === 'task') {
      count = data.tasks.filter(t => {
        if (entity === 'pr_plans') return t.pr_plan_id === row.id;
        return t.project_id === row.id;
      }).length;
    }

    if (rule.min !== undefined && count < rule.min) {
      issues.push(issue(
        rule.severity || 'WARNING', entity, row.id, 'children_min',
        `${subtype}[${row.id}] 子 ${childType} 数量 ${count} < 最小 ${rule.min}`
      ));
    }
    if (rule.max !== undefined && count > rule.max) {
      issues.push(issue(
        rule.severity || 'WARNING', entity, row.id, 'children_max',
        `${subtype}[${row.id}] 子 ${childType} 数量 ${count} > 最大 ${rule.max}`
      ));
    }
  }
}

function checkTextRules(issues, entity, row, textRules, subtype) {
  if (!textRules) return;

  for (const [field, rule] of Object.entries(textRules)) {
    const val = row[field];
    if (val === null || val === undefined) continue;

    const text = String(val);

    if (rule.min_length !== undefined && text.length < rule.min_length) {
      issues.push(issue(
        rule.severity || 'WARNING', entity, row.id, 'text_too_short',
        `${subtype}[${row.id}].${field} 长度 ${text.length} < 最小 ${rule.min_length}`
      ));
    }

    if (rule.max_length !== undefined && text.length > rule.max_length) {
      issues.push(issue(
        rule.severity || 'WARNING', entity, row.id, 'text_too_long',
        `${subtype}[${row.id}].${field} 长度 ${text.length} > 最大 ${rule.max_length}`
      ));
    }

    if (rule.forbidden_phrases) {
      for (const phrase of rule.forbidden_phrases) {
        if (text.includes(phrase)) {
          issues.push(issue(
            rule.severity || 'BLOCK', entity, row.id, 'forbidden_phrase',
            `${subtype}[${row.id}].${field} 包含禁词: "${phrase}"`
          ));
        }
      }
    }
  }
}

// ─── 孤儿检测 ────────────────────────────────────────────

function checkOrphans(issues, orphanRule, data) {
  const { entity, parent_field, parent_table, filter, severity, message } = orphanRule;

  let rows;
  if (entity === 'tasks') {
    rows = data.tasks;
  } else if (entity === 'projects') {
    rows = data.projects;
    if (filter) {
      const match = filter.match(/type\s*=\s*'(\w+)'/);
      if (match) {
        rows = rows.filter(r => r.type === match[1]);
      }
    }
  }

  if (!rows) return;

  const parentIndex = parent_table === 'projects' ? data.projectIndex : data.goalIndex;

  for (const row of rows) {
    const parentId = row[parent_field];
    if (parentId && !parentIndex[parentId]) {
      issues.push(issue(
        severity || 'BLOCK', entity, row.id, 'orphan',
        message || `${entity}[${row.id}].${parent_field} 指向不存在的 ${parent_table} 记录`
      ));
    }
  }
}

// ─── 环检测（pr_plans.depends_on）────────────────────────

/**
 * DFS 检测 pr_plans.depends_on 中的环。
 */
export function detectCycles(issues, prPlans, graphSpec) {
  const adjMap = {};
  for (const plan of prPlans) {
    const deps = plan[graphSpec.field];
    if (Array.isArray(deps) && deps.length > 0) {
      adjMap[plan.id] = deps;
    }
  }

  const visited = new Set();
  const inStack = new Set();
  const cyclePaths = [];

  function dfs(nodeId, path) {
    if (inStack.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      cyclePaths.push(path.slice(cycleStart).concat(nodeId));
      return;
    }
    if (visited.has(nodeId)) return;

    visited.add(nodeId);
    inStack.add(nodeId);
    path.push(nodeId);

    const neighbors = adjMap[nodeId] || [];
    for (const next of neighbors) {
      dfs(next, path);
    }

    path.pop();
    inStack.delete(nodeId);
  }

  for (const nodeId of Object.keys(adjMap)) {
    if (!visited.has(nodeId)) {
      dfs(nodeId, []);
    }
  }

  for (const cycle of cyclePaths) {
    issues.push(issue(
      graphSpec.severity || 'BLOCK',
      'pr_plans',
      cycle[0],
      'dependency_cycle',
      `pr_plan 依赖环: ${cycle.join(' → ')}`
    ));
  }
}
