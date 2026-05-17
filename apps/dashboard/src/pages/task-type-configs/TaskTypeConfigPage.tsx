/**
 * TaskTypeConfigPage — 三层下钻架构
 * 路由：/task-type-configs
 *
 * 第一层：ABCD 类别卡片总览
 * 第二层：某类的任务列表（点击进入）
 * 第三层：右侧 DetailPanel — 任务详情 + 编辑（C类动态任务可保存）
 */

import { useState, useEffect, useCallback } from 'react';

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface DynamicConfig {
  task_type: string;
  location: 'us' | 'hk' | 'xian' | 'xian_m1';
  executor: string;
  skill: string | null;
  description: string | null;
  updated_at: string;
}

type Category = 'A' | 'B' | 'C' | 'D';

interface TaskDef {
  task_type: string;
  location: string;
  skill: string;
  desc: string;
  editable?: boolean;        // C类动态任务（切换机器）
  editableExecutor?: boolean; // B类任务（切换 executor：Claude Code / Codex）
}

// ─── 静态数据 ─────────────────────────────────────────────────────────────────

const DEVICE_LABELS: Record<string, string> = {
  us: '美国M4', hk: '香港VPS', xian: '西安M4', xian_m1: '西安M1',
};

const DEVICE_COLORS: Record<string, string> = {
  us: 'bg-blue-100 text-blue-700',
  hk: 'bg-red-100 text-red-700',
  xian: 'bg-amber-100 text-amber-700',
  xian_m1: 'bg-orange-100 text-orange-700',
};

const CATEGORY_META: Record<Category, { label: string; tag: string; desc: string; color: string; border: string; iconBg: string }> = {
  A: {
    label: 'A类', tag: '锁机器 + 锁模型',
    desc: '必须在美国M4上，必须用 Claude Code，不可替换',
    color: 'bg-blue-50', border: 'border-blue-200', iconBg: 'bg-blue-500',
  },
  B: {
    label: 'B类', tag: '锁机器（美国M4）',
    desc: '需要本机代码/worktree/Brain DB 上下文，Claude Code 或 Codex 均可',
    color: 'bg-indigo-50', border: 'border-indigo-200', iconBg: 'bg-indigo-500',
  },
  C: {
    label: 'C类', tag: '锁模型（Codex），不锁机器',
    desc: '美国M4 或 西安M4 均可，动态任务可实时切换机器',
    color: 'bg-amber-50', border: 'border-amber-200', iconBg: 'bg-amber-500',
  },
  D: {
    label: 'D类', tag: '纯脚本，不锁机器',
    desc: '香港VPS，MiniMax / N8N，无需大模型推理',
    color: 'bg-red-50', border: 'border-red-200', iconBg: 'bg-red-500',
  },
};

const TASKS_BY_CATEGORY: Record<Category, TaskDef[]> = {
  A: [
    { task_type: 'dev', location: 'us', skill: '/dev', desc: '主力开发，Opus + /dev 全流程' },
  ],
  B: [
    { task_type: 'initiative_execute',  location: 'us', skill: '/dev',                desc: 'Initiative 执行，/dev 全流程',          editableExecutor: true },
    { task_type: 'initiative_plan',     location: 'us', skill: '/decomp',             desc: 'Initiative 规划，读现有代码',            editableExecutor: true },
    { task_type: 'initiative_verify',   location: 'us', skill: '/arch-review verify', desc: 'Initiative 验收，核查代码实现',          editableExecutor: true },
    { task_type: 'intent_expand',       location: 'us', skill: '/intent-expand',      desc: '意图扩展，读 Brain DB 补全 PRD',        editableExecutor: true },
    { task_type: 'pipeline_rescue',     location: 'us', skill: '/dev',                desc: 'Pipeline 救援，读 .dev-mode + worktree', editableExecutor: true },
    { task_type: 'code_review',         location: 'us', skill: '/code-review',        desc: '代码审查，读代码上下文',                editableExecutor: true },
    { task_type: 'code_review_gate',    location: 'us', skill: '/code-review-gate',   desc: '代码质量门禁（push 前审查）',           editableExecutor: true },
    { task_type: 'prd_review',          location: 'us', skill: '/prd-review',         desc: 'PRD 审查',                              editableExecutor: true },
    { task_type: 'spec_review',         location: 'us', skill: '/spec-review',        desc: 'Spec 审查',                             editableExecutor: true },
    { task_type: 'initiative_review',   location: 'us', skill: '/initiative-review',  desc: 'Initiative 整体审查',                   editableExecutor: true },
    { task_type: 'decomp_review',       location: 'us', skill: '/decomp-check',       desc: '拆解审查（Vivian 角色）',               editableExecutor: true },
    { task_type: 'architecture_design', location: 'us', skill: '/architect design',   desc: '架构设计，读代码',                      editableExecutor: true },
    { task_type: 'architecture_scan',   location: 'us', skill: '/architect scan',     desc: '系统扫描，读代码',                      editableExecutor: true },
    { task_type: 'arch_review',         location: 'us', skill: '/arch-review review', desc: '架构巡检，读代码',                      editableExecutor: true },
    { task_type: 'dept_heartbeat',      location: 'us', skill: '/cecelia',            desc: '部门心跳',                              editableExecutor: true },
  ],
  C: [
    // 所有 C类任务均可编辑（editable: true），UPSERT 写 DB
    { task_type: 'codex_dev',          location: 'xian', skill: '/dev',              desc: 'Codex /dev，runner.sh 执行',          editable: true },
    { task_type: 'codex_qa',           location: 'xian', skill: '/codex',            desc: 'Codex 免疫检查',                      editable: true },
    { task_type: 'codex_playwright',   location: 'xian', skill: '/playwright',       desc: 'Playwright 自动化 → CDP 控制西安PC', editable: true },
    { task_type: 'codex_test_gen',     location: 'xian', skill: '/codex-test-gen',   desc: '自动生成测试',                        editable: true },
    { task_type: 'pr_review',          location: 'xian', skill: '/review',           desc: '异步 PR 审查（独立账号）',            editable: true },
    { task_type: 'content-pipeline',   location: 'xian', skill: '/content-creator',  desc: '内容工厂 Pipeline 入口',             editable: true },
    { task_type: 'content-research',   location: 'xian', skill: '/notebooklm',       desc: '内容调研',                           editable: true },
    { task_type: 'content-generate',   location: 'xian', skill: '/content-creator',  desc: '内容生成',                           editable: true },
    { task_type: 'content-review',     location: 'xian', skill: '/content-creator',  desc: '内容审核',                           editable: true },
    { task_type: 'content-export',     location: 'xian', skill: '/content-creator',  desc: '内容导出',                           editable: true },
    { task_type: 'suggestion_plan',    location: 'xian', skill: '/plan',             desc: '层级识别',                           editable: true },
    { task_type: 'strategy_session',   location: 'xian', skill: '/strategy-session', desc: '战略会议',                           editable: true },
    { task_type: 'knowledge',          location: 'xian', skill: '/knowledge',        desc: '知识记录',                           editable: true },
    { task_type: 'scope_plan',         location: 'xian', skill: '/decomp',           desc: 'Scope 规划',                         editable: true },
    { task_type: 'project_plan',       location: 'xian', skill: '/decomp',           desc: 'Project 规划',                       editable: true },
  ],
  D: [
    { task_type: 'explore',  location: 'hk', skill: '/explore',  desc: '快速调研（MiniMax）' },
    { task_type: 'talk',     location: 'hk', skill: '/cecelia',  desc: '对话（MiniMax）' },
    { task_type: 'research', location: 'hk', skill: '/research', desc: '深度调研（MiniMax）' },
    { task_type: 'data',     location: 'hk', skill: '/sync-hk',  desc: '数据处理（N8N）' },
  ],
};

// ─── 子组件 ──────────────────────────────────────────────────────────────────

function DeviceBadge({ location }: { location: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${DEVICE_COLORS[location] ?? 'bg-gray-100 text-gray-600'}`}>
      {DEVICE_LABELS[location] ?? location}
    </span>
  );
}

/** 面包屑 breadcrumb */
function Breadcrumb({ category, task, onHome, onCategory }: {
  category: Category | null;
  task: TaskDef | null;
  onHome: () => void;
  onCategory: () => void;
}) {
  return (
    <nav className="flex items-center gap-1 text-sm text-gray-500 mb-5">
      <button onClick={onHome} className="hover:text-gray-900 transition-colors">任务路由</button>
      {category && (
        <>
          <span className="text-gray-300">/</span>
          <button
            onClick={task ? onCategory : undefined}
            className={task ? 'hover:text-gray-900 transition-colors' : 'text-gray-900 font-medium'}
          >
            {CATEGORY_META[category].label}
          </button>
        </>
      )}
      {task && (
        <>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900 font-medium font-mono text-xs">{task.task_type}</span>
        </>
      )}
    </nav>
  );
}

/** 第一层：类别卡片 CategoryCard */
function CategoryCard({ cat, count, onClick }: { cat: Category; count: number; onClick: () => void }) {
  const m = CATEGORY_META[cat];
  return (
    <button
      onClick={onClick}
      className={`text-left w-full rounded-xl border ${m.border} ${m.color} p-5 hover:shadow-md transition-all group`}
    >
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-lg ${m.iconBg} flex items-center justify-center text-white font-bold text-lg mb-3`}>
          {cat}
        </div>
        <span className="text-xs text-gray-400 group-hover:text-gray-600 transition-colors mt-1">
          {count} 个任务类型 →
        </span>
      </div>
      <div className="font-semibold text-gray-800">{m.tag}</div>
      <div className="text-xs text-gray-500 mt-1 leading-relaxed">{m.desc}</div>
    </button>
  );
}

/** 第二层：任务列表行 */
function TaskRow({ task, isSelected, onClick }: {
  task: TaskDef; isSelected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0 ${isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-medium text-gray-800">{task.task_type}</span>
          {task.editable && <span className="text-amber-500 text-xs">● 可配置</span>}
          {task.editableExecutor && <span className="text-indigo-500 text-xs">● 执行器可选</span>}
        </div>
        <div className="text-xs text-gray-400 mt-0.5 truncate">{task.desc}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <DeviceBadge location={task.location} />
        <span className="text-gray-300 text-sm">›</span>
      </div>
    </button>
  );
}

/** 第三层：右侧详情面板 DetailPanel */
function DetailPanel({ task, dynamicConfig, onSave, saving, saved, error }: {
  task: TaskDef;
  dynamicConfig: DynamicConfig | null;
  onSave: (taskType: string, updates: { location?: string; executor?: string }) => void;
  saving: boolean;
  saved: boolean;
  error: string | null;
}) {
  const [editLocation, setEditLocation] = useState<string>(
    dynamicConfig?.location ?? task.location
  );
  const [editExecutor, setEditExecutor] = useState<string>(
    dynamicConfig?.executor ?? 'claude_code'
  );

  useEffect(() => {
    setEditLocation(dynamicConfig?.location ?? task.location);
    setEditExecutor(dynamicConfig?.executor ?? 'claude_code');
  }, [task.task_type, dynamicConfig]);

  // C类任务均可编辑（切换机器），B类任务可切换 executor
  const isEditable = !!task.editable;
  const isExecutorEditable = !!task.editableExecutor;
  const currentLocation = dynamicConfig?.location ?? task.location;
  const currentExecutor = dynamicConfig?.executor ?? 'claude_code';

  return (
    <div className="h-full flex flex-col">
      {/* 面板头 */}
      <div className="px-5 py-4 border-b border-gray-200 bg-gray-50">
        <div className="font-mono text-sm font-bold text-gray-900">{task.task_type}</div>
        <div className="text-xs text-gray-500 mt-0.5">{task.desc}</div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* 当前路由 */}
        <section>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">当前路由</div>
          <DeviceBadge location={currentLocation} />
        </section>

        {/* Skill */}
        <section>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Skill</div>
          <code className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-700">{task.skill}</code>
        </section>

        {/* Executor（动态任务） */}
        {dynamicConfig && (
          <section>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Executor</div>
            <code className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-700">{dynamicConfig.executor}</code>
          </section>
        )}

        {/* 约束说明 */}
        <section>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">机器约束</div>
          {isEditable ? (
            <div className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 border border-amber-200">
              C类任务，不锁机器。可在美国M4 / 西安M4 / 西安M1 之间切换，保存后 Brain 立即生效。
            </div>
          ) : isExecutorEditable ? (
            <div className="text-xs text-indigo-700 bg-indigo-50 rounded px-3 py-2 border border-indigo-200">
              B类任务，锁定美国M4，不可切换机器。可选择执行器：Claude Code（默认）或 Codex CLI。
            </div>
          ) : (
            <div className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-2 border border-gray-200">
              {task.location === 'hk'
                ? 'D类任务，固定香港VPS。纯脚本执行，不涉及大模型路由。'
                : 'A类任务，锁定美国M4 + Claude Code，不可更改。'}
            </div>
          )}
        </section>

        {/* Executor 编辑表单（B类任务） */}
        {isExecutorEditable && (
          <section>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">执行器</div>
            <div className="space-y-3">
              {([
                { value: 'claude_code', label: 'Claude Code', desc: '本机 cecelia-bridge · 10-slot 池' },
                { value: 'codex',       label: 'Codex CLI',   desc: '本机 Codex CLI · 独立 2-slot 池' },
              ] as const).map(opt => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    editExecutor === opt.value
                      ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="executor"
                    value={opt.value}
                    checked={editExecutor === opt.value}
                    onChange={() => setEditExecutor(opt.value)}
                    className="sr-only"
                  />
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    editExecutor === opt.value ? 'border-indigo-600' : 'border-gray-300'
                  }`}>
                    {editExecutor === opt.value && <div className="w-2 h-2 rounded-full bg-indigo-600" />}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="text-xs text-gray-400">{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            {currentExecutor !== editExecutor && (
              <div className="mt-2 text-xs text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded border border-indigo-200">
                当前：{currentExecutor === 'codex' ? 'Codex CLI' : 'Claude Code'} → 切换为：{editExecutor === 'codex' ? 'Codex CLI' : 'Claude Code'}
              </div>
            )}

            {error && (
              <div className="mt-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded border border-red-200">{error}</div>
            )}

            <button
              onClick={() => onSave(task.task_type, { executor: editExecutor })}
              disabled={saving}
              className="mt-4 w-full py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? '保存中…' : saved ? '✓ 已保存' : '保存执行器配置'}
            </button>

            {saved && (
              <div className="mt-2 text-xs text-green-600 text-center">Brain 已立即生效</div>
            )}
          </section>
        )}

        {/* 机器切换表单（仅 C类动态任务） */}
        {isEditable && (
          <section>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">切换机器</div>
            <div className="space-y-3">
              {(['us', 'xian', 'xian_m1'] as const).map(loc => (
                <label
                  key={loc}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    editLocation === loc
                      ? `${DEVICE_COLORS[loc]} border-current/30`
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="location"
                    value={loc}
                    checked={editLocation === loc}
                    onChange={() => setEditLocation(loc)}
                    className="sr-only"
                  />
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    editLocation === loc ? 'border-current' : 'border-gray-300'
                  }`}>
                    {editLocation === loc && <div className="w-2 h-2 rounded-full bg-current" />}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{DEVICE_LABELS[loc]}</div>
                    <div className="text-xs text-gray-400">
                      {loc === 'us' ? '美国 Mac mini M4 · 38.23.47.81'
                        : loc === 'xian' ? '西安 Mac mini M4 · Tailscale 100.86.57.69'
                        : '西安 Mac mini M1 · Tailscale 100.88.166.55'}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {error && (
              <div className="mt-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded border border-red-200">{error}</div>
            )}

            <button
              onClick={() => onSave(task.task_type, { location: editLocation })}
              disabled={saving}
              className="mt-4 w-full py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? '保存中…' : saved ? '✓ 已保存' : '保存配置'}
            </button>

            {saved && (
              <div className="mt-2 text-xs text-green-600 text-center">Brain 已立即生效</div>
            )}
          </section>
        )}

        {/* 更新时间 */}
        {dynamicConfig?.updated_at && (
          <div className="text-xs text-gray-300 pt-2 border-t border-gray-100">
            上次修改：{new Date(dynamicConfig.updated_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 主页面 ──────────────────────────────────────────────────────────────────

export default function TaskTypeConfigPage() {
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskDef | null>(null);
  const [dynamicConfigs, setDynamicConfigs] = useState<DynamicConfig[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch('/api/cecelia/task-type-configs');
      const data = await res.json();
      if (data.success) setDynamicConfigs(data.configs);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const handleSave = async (taskType: string, updates: { location?: string; executor?: string }) => {
    setSaving(true); setSaveError(null);
    try {
      const res = await fetch(`/api/cecelia/task-type-configs/${taskType}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(taskType);
        setTimeout(() => setSaved(null), 3000);
        await fetchConfigs();
      } else {
        setSaveError(data.error ?? '保存失败');
      }
    } catch { setSaveError('网络错误'); }
    finally { setSaving(false); }
  };

  const goHome = () => { setSelectedCategory(null); setSelectedTask(null); };
  const goCategory = () => setSelectedTask(null);

  const tasks = selectedCategory ? TASKS_BY_CATEGORY[selectedCategory] : [];
  const dynamicMap = Object.fromEntries(dynamicConfigs.map(c => [c.task_type, c]));

  // ── 第一层：类别总览 ──
  if (!selectedCategory) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">任务路由配置</h1>
          <p className="mt-1 text-sm text-gray-500">选择类别查看任务列表，点击任务查看详情与配置。</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {(Object.keys(CATEGORY_META) as Category[]).map(cat => (
            <CategoryCard
              key={cat}
              cat={cat}
              count={TASKS_BY_CATEGORY[cat].length}
              onClick={() => setSelectedCategory(cat)}
            />
          ))}
        </div>
      </div>
    );
  }

  const meta = CATEGORY_META[selectedCategory];

  // ── 第二层 + 第三层：任务列表 + 右侧面板 ──
  return (
    <div className="max-w-5xl mx-auto">
      <Breadcrumb
        category={selectedCategory}
        task={selectedTask}
        onHome={goHome}
        onCategory={goCategory}
      />

      <div className={`flex gap-0 rounded-xl border overflow-hidden ${meta.border}`}>
        {/* 左：任务列表 */}
        <div className={`${selectedTask ? 'w-80 shrink-0' : 'flex-1'} border-r border-gray-200 bg-white`}>
          {/* 列表头 */}
          <div className={`px-4 py-3 ${meta.color} border-b ${meta.border}`}>
            <div className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded ${meta.iconBg} flex items-center justify-center text-white font-bold text-xs`}>
                {selectedCategory}
              </div>
              <span className="font-semibold text-sm text-gray-800">{meta.tag}</span>
            </div>
            <div className="text-xs text-gray-500 mt-0.5 ml-8">{tasks.length} 个任务类型</div>
          </div>
          {/* 任务行 */}
          <div>
            {tasks.map(t => (
              <TaskRow
                key={t.task_type}
                task={t}
                isSelected={selectedTask?.task_type === t.task_type}
                onClick={() => setSelectedTask(t)}
              />
            ))}
          </div>
        </div>

        {/* 右：详情面板 DetailPanel */}
        {selectedTask && (
          <div className="flex-1 min-w-0 bg-white">
            <DetailPanel
              task={selectedTask}
              dynamicConfig={dynamicMap[selectedTask.task_type] ?? null}
              onSave={handleSave}
              saving={saving}
              saved={saved === selectedTask.task_type}
              error={saveError}
            />
          </div>
        )}

        {/* 右侧空态提示 */}
        {!selectedTask && (
          <div className="flex-1 flex items-center justify-center text-gray-300 text-sm bg-gray-50">
            ← 点击左侧任务查看详情
          </div>
        )}
      </div>
    </div>
  );
}
