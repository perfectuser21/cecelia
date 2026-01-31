import { useState } from 'react';
import {
  Package,
  GitBranch,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Activity,
  History,
  Layers,
} from 'lucide-react';
import {
  TimelineData,
  ProjectGroup,
  FeatureGroup,
  CeceliaRun,
  TaskStep,
} from '../api/agents.api';

interface TimelineViewProps {
  data: TimelineData;
}

export default function TimelineView({ data }: TimelineViewProps) {
  if (data.projects.length === 0) {
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-12 text-center">
        <Layers className="w-12 h-12 text-gray-600 mx-auto mb-3" />
        <p className="text-gray-400">暂无项目数据</p>
        <p className="text-sm text-gray-500 mt-1">
          运行 Cecelia 任务后将显示项目时间线
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {data.projects.map((project) => (
        <ProjectCard key={project.name} project={project} />
      ))}
    </div>
  );
}

// ============ Project Card ============

interface ProjectCardProps {
  project: ProjectGroup;
}

function ProjectCard({ project }: ProjectCardProps) {
  const [expanded, setExpanded] = useState(project.runningCount > 0);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      {/* Project Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-700/30 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="p-2.5 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl">
            <Package className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white">{project.name}</h2>
              {project.repoUrl && (
                <a
                  href={project.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-gray-500 hover:text-blue-400 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
              {project.runningCount > 0 && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-blue-900/50 text-blue-400 flex items-center gap-1">
                  <Activity className="w-3 h-3 animate-pulse" />
                  {project.runningCount} 运行中
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {project.features.length} Features · {project.totalRuns} Runs
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="w-5 h-5 text-gray-500" />
        ) : (
          <ChevronRight className="w-5 h-5 text-gray-500" />
        )}
      </button>

      {/* Features */}
      {expanded && (
        <div className="border-t border-slate-700 divide-y divide-slate-700/50">
          {project.features.map((feature) => (
            <FeatureRow key={feature.name} feature={feature} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============ Feature Row ============

interface FeatureRowProps {
  feature: FeatureGroup;
}

function FeatureRow({ feature }: FeatureRowProps) {
  const [selectedRun, setSelectedRun] = useState<CeceliaRun | null>(
    feature.current || null
  );
  const isRunning = !!feature.current;

  return (
    <div className={`px-6 py-4 ${isRunning ? 'bg-blue-900/10' : ''}`}>
      {/* Feature Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <GitBranch className={`w-4 h-4 ${isRunning ? 'text-blue-400' : 'text-cyan-400'}`} />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-white">{feature.displayName}</span>
              {isRunning && (
                <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-500/30 text-blue-300 flex items-center gap-1">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                  运行中
                </span>
              )}
            </div>
            {/* History Timeline */}
            <div className="flex items-center gap-1 mt-1.5">
              <History className="w-3 h-3 text-gray-500" />
              <div className="flex items-center gap-1">
                {feature.history.map((ver, idx) => (
                  <button
                    key={ver.id}
                    onClick={() => setSelectedRun(
                      feature.current?.id === ver.id ? feature.current :
                      feature.latestRun.id === ver.id ? feature.latestRun : null
                    )}
                    className={`
                      px-1.5 py-0.5 text-[10px] rounded transition-colors
                      ${ver.status === 'running'
                        ? 'bg-blue-500/30 text-blue-300'
                        : ver.status === 'completed'
                        ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                        : ver.status === 'failed'
                        ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                        : 'bg-slate-700/50 text-gray-400 hover:bg-slate-700'
                      }
                    `}
                    title={`v${ver.version} - ${ver.date} - ${ver.branch}`}
                  >
                    v{ver.version}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Current Run Details or Checkpoint Timeline */}
      {(feature.current || selectedRun) && (
        <RunDetails run={feature.current || selectedRun!} />
      )}
    </div>
  );
}

// ============ Run Details with Checkpoint Timeline ============

interface RunDetailsProps {
  run: CeceliaRun;
}

function RunDetails({ run }: RunDetailsProps) {
  const [expandedCheckpoint, setExpandedCheckpoint] = useState<string | null>(
    run.checkpoints_detail?.find(cp => cp.status === 'in_progress')?.id || null
  );

  // 如果有 checkpoints_detail，显示水平时间线
  if (run.checkpoints_detail && run.checkpoints_detail.length > 0) {
    return (
      <div className="mt-3 ml-7">
        {/* PRD Info */}
        {run.prd_title && (
          <div className="mb-3 text-sm">
            <span className="text-gray-400">当前: </span>
            <span className="text-white">{run.prd_title}</span>
          </div>
        )}

        {/* Checkpoint Timeline (Horizontal) */}
        <div className="flex items-start gap-2 overflow-x-auto pb-2">
          {run.checkpoints_detail.map((cp, idx) => {
            const isExpanded = expandedCheckpoint === cp.id;
            const isCurrent = cp.status === 'in_progress';

            return (
              <div key={cp.id} className="flex items-start gap-2">
                {/* Checkpoint Card */}
                <button
                  onClick={() => setExpandedCheckpoint(isExpanded ? null : cp.id)}
                  className={`
                    flex-shrink-0 w-28 p-3 rounded-lg border text-left transition-all
                    ${isCurrent
                      ? 'border-blue-500/50 bg-blue-900/30'
                      : cp.status === 'done'
                      ? 'border-emerald-500/30 bg-emerald-900/20'
                      : cp.status === 'failed'
                      ? 'border-red-500/30 bg-red-900/20'
                      : 'border-slate-600/30 bg-slate-700/30'
                    }
                    hover:scale-105
                  `}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <CheckpointStatusIcon status={cp.status} />
                    <span className="text-[10px] font-mono text-gray-400">{cp.id}</span>
                  </div>
                  <p className="text-xs text-white truncate" title={cp.name}>
                    {cp.name}
                  </p>
                  {isCurrent && (
                    <p className="text-[10px] text-blue-400 mt-1">← 当前</p>
                  )}
                </button>

                {/* Arrow */}
                {idx < run.checkpoints_detail!.length - 1 && (
                  <div className="flex items-center h-full pt-6 text-gray-600">→</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Expanded Checkpoint Dev Steps */}
        {expandedCheckpoint && (
          <DevStepsPanel
            run={run}
            checkpointId={expandedCheckpoint}
          />
        )}
      </div>
    );
  }

  // 如果只有 steps，显示简化版
  if (run.steps && run.steps.length > 0) {
    return (
      <div className="mt-3 ml-7">
        <DevSteps steps={run.steps} currentStep={run.current_step} />
      </div>
    );
  }

  // 简单进度条
  return (
    <div className="mt-3 ml-7">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden max-w-xs">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-cyan-500"
            style={{
              width: run.total_checkpoints > 0
                ? `${(run.completed_checkpoints / run.total_checkpoints) * 100}%`
                : '0%'
            }}
          />
        </div>
        <span className="text-xs text-gray-400">
          {run.completed_checkpoints}/{run.total_checkpoints}
        </span>
      </div>
    </div>
  );
}

// ============ Dev Steps Panel ============

interface DevStepsPanelProps {
  run: CeceliaRun;
  checkpointId: string;
}

function DevStepsPanel({ run, checkpointId }: DevStepsPanelProps) {
  const checkpoint = run.checkpoints_detail?.find(cp => cp.id === checkpointId);
  const steps = checkpoint?.dev_steps || run.steps || [];

  if (steps.length === 0) {
    return (
      <div className="mt-3 p-3 bg-slate-700/30 rounded-lg text-center">
        <p className="text-xs text-gray-500">暂无步骤详情</p>
      </div>
    );
  }

  return (
    <div className="mt-3 p-3 bg-slate-700/30 rounded-lg">
      <p className="text-xs text-gray-400 mb-2">
        {checkpointId} Dev 流程
      </p>
      <DevSteps steps={steps} currentStep={run.current_step} />
    </div>
  );
}

// ============ Dev Steps ============

interface DevStepsProps {
  steps: TaskStep[];
  currentStep?: number;
}

function DevSteps({ steps, currentStep }: DevStepsProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {steps.map((step) => (
        <span
          key={step.id}
          className={`
            px-2 py-1 text-xs rounded-md border transition-colors
            ${step.status === 'done'
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
              : step.status === 'in_progress'
              ? 'bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse'
              : step.status === 'failed'
              ? 'bg-red-500/20 text-red-400 border-red-500/30'
              : 'bg-slate-700/50 text-gray-500 border-slate-600/30'
            }
          `}
        >
          {step.name}
        </span>
      ))}
    </div>
  );
}

// ============ Checkpoint Status Icon ============

interface CheckpointStatusIconProps {
  status: string;
}

function CheckpointStatusIcon({ status }: CheckpointStatusIconProps) {
  switch (status) {
    case 'done':
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
    case 'in_progress':
      return <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
    case 'failed':
      return <XCircle className="w-3.5 h-3.5 text-red-500" />;
    default:
      return <Clock className="w-3.5 h-3.5 text-gray-500" />;
  }
}
