/**
 * Dev Session Management - KR1 Implementation
 *
 * Tracks headless /dev sessions with Memory integration:
 * - Session lifecycle (start → steps → quality gates → summary)
 * - Artifact tracking (files, scripts, commits)
 * - Quality gate validation
 * - Summary generation to episodic memory
 */

import { writeMemory, queryMemory, type MemoryEntry } from './memory.js';

// Session ID format: dev_YYYYMMDD_HHMMSS_xxxxxx
const SESSION_ID_REGEX = /^dev_\d{8}_\d{6}_[a-z0-9]{6}$/;

export type SessionStatus = 'running' | 'completed' | 'failed';

export interface StepRecord {
  step_number: number;
  name: string;
  started_at: Date;
  completed_at?: Date;
  status: 'pending' | 'running' | 'completed' | 'failed';
  artifacts?: {
    files_touched?: string[];
    scripts_run?: string[];
    output?: string;
  };
}

export interface QualityGateResult {
  qa_decision: boolean;
  audit_pass: boolean;
  gate_file: boolean;
  all_passed: boolean;
  checked_at: Date;
}

export interface VerifyResult {
  script: string;
  passed: boolean;
  checks_total: number;
  checks_passed: number;
  executed_at: Date;
}

export interface SessionSummary {
  files_modified: string[];
  scripts_executed: string[];
  assertions_checked: string[];
  pr_url?: string;
  commit_shas: string[];
  next_steps: string[];
  total_steps: number;
  completed_steps: number;
  duration_ms: number;
  // KR1 hardening fields - anti-regression audit trail
  trace_id?: string;
  commit_hash?: string;
  verify_results?: VerifyResult[];
}

export interface DevSession {
  session_id: string;
  branch: string;
  prd_path: string;
  project: string;
  started_at: Date;
  completed_at?: Date;
  status: SessionStatus;
  steps: StepRecord[];
  quality_gates?: QualityGateResult;
  summary?: SessionSummary;
}

/**
 * Generate a unique session ID
 * Format: dev_YYYYMMDD_HHMMSS_xxxxxx
 */
export function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toISOString().slice(11, 19).replace(/:/g, '');
  const random = Math.random().toString(36).substring(2, 8);
  return `dev_${date}_${time}_${random}`;
}

/**
 * Validate session ID format
 */
export function validateSessionId(sessionId: string): boolean {
  return SESSION_ID_REGEX.test(sessionId);
}

/**
 * Create a new dev session
 */
export async function createDevSession(data: {
  branch: string;
  prd_path: string;
  project: string;
  session_id?: string;
}): Promise<DevSession> {
  const session_id = data.session_id || generateSessionId();

  const session: DevSession = {
    session_id,
    branch: data.branch,
    prd_path: data.prd_path,
    project: data.project,
    started_at: new Date(),
    status: 'running',
    steps: [],
  };

  // Write to episodic memory
  await writeMemory({
    layer: 'episodic',
    category: 'event',
    key: `dev_session_${session_id}`,
    value: session as unknown as Record<string, unknown>,
    source: 'system',
  });

  return session;
}

/**
 * Get a dev session by ID
 */
export async function getDevSession(sessionId: string): Promise<DevSession | null> {
  const entries = await queryMemory({
    layer: 'episodic',
    keys: [`dev_session_${sessionId}`],
  });

  if (entries.length === 0) {
    return null;
  }

  return entries[0].value as unknown as DevSession;
}

/**
 * Update a dev session
 */
export async function updateDevSession(
  sessionId: string,
  updates: Partial<Omit<DevSession, 'session_id' | 'started_at'>>
): Promise<DevSession | null> {
  const session = await getDevSession(sessionId);
  if (!session) {
    return null;
  }

  const updatedSession: DevSession = {
    ...session,
    ...updates,
  };

  await writeMemory({
    layer: 'episodic',
    category: 'event',
    key: `dev_session_${sessionId}`,
    value: updatedSession as unknown as Record<string, unknown>,
    source: 'system',
  });

  return updatedSession;
}

/**
 * Add a step to a dev session
 */
export async function addSessionStep(
  sessionId: string,
  step: Omit<StepRecord, 'started_at' | 'status'>
): Promise<DevSession | null> {
  const session = await getDevSession(sessionId);
  if (!session) {
    return null;
  }

  const newStep: StepRecord = {
    ...step,
    started_at: new Date(),
    status: 'running',
  };

  session.steps.push(newStep);

  return updateDevSession(sessionId, { steps: session.steps });
}

/**
 * Complete a step in a dev session
 */
export async function completeSessionStep(
  sessionId: string,
  stepNumber: number,
  artifacts?: StepRecord['artifacts']
): Promise<DevSession | null> {
  const session = await getDevSession(sessionId);
  if (!session) {
    return null;
  }

  const stepIndex = session.steps.findIndex(s => s.step_number === stepNumber);
  if (stepIndex === -1) {
    return null;
  }

  session.steps[stepIndex] = {
    ...session.steps[stepIndex],
    completed_at: new Date(),
    status: 'completed',
    artifacts: artifacts || session.steps[stepIndex].artifacts,
  };

  return updateDevSession(sessionId, { steps: session.steps });
}

/**
 * Set quality gate results for a session
 */
export async function setQualityGates(
  sessionId: string,
  gates: Omit<QualityGateResult, 'checked_at' | 'all_passed'>
): Promise<DevSession | null> {
  const quality_gates: QualityGateResult = {
    ...gates,
    all_passed: gates.qa_decision && gates.audit_pass && gates.gate_file,
    checked_at: new Date(),
  };

  return updateDevSession(sessionId, { quality_gates });
}

/**
 * Options for summary generation with anti-regression fields
 */
export interface SummaryOptions {
  trace_id?: string;
  commit_hash?: string;
  verify_results?: VerifyResult[];
}

/**
 * Generate a trace ID for the session
 */
function generateTraceId(sessionId: string): string {
  return `trace_${sessionId}_${Date.now().toString(36)}`;
}

/**
 * Get current git commit hash (returns null if not in git repo)
 */
async function getGitCommitHash(): Promise<string | null> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const { stdout } = await execAsync('git rev-parse HEAD', { timeout: 5000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Generate and store session summary
 */
export async function generateSessionSummary(
  sessionId: string,
  options?: SummaryOptions
): Promise<SessionSummary | null> {
  const session = await getDevSession(sessionId);
  if (!session) {
    return null;
  }

  // Aggregate data from steps
  const files_modified = new Set<string>();
  const scripts_executed = new Set<string>();
  const commit_shas: string[] = [];

  for (const step of session.steps) {
    if (step.artifacts) {
      step.artifacts.files_touched?.forEach(f => files_modified.add(f));
      step.artifacts.scripts_run?.forEach(s => scripts_executed.add(s));
    }
  }

  // Calculate duration
  const duration_ms = session.completed_at
    ? new Date(session.completed_at).getTime() - new Date(session.started_at).getTime()
    : Date.now() - new Date(session.started_at).getTime();

  // Get anti-regression audit trail fields
  const trace_id = options?.trace_id || generateTraceId(sessionId);
  const commit_hash = options?.commit_hash || (await getGitCommitHash()) || undefined;
  const verify_results = options?.verify_results || [];

  const summary: SessionSummary = {
    files_modified: Array.from(files_modified),
    scripts_executed: Array.from(scripts_executed),
    assertions_checked: session.quality_gates
      ? ['qa_decision', 'audit_pass', 'gate_file'].filter(
          k => session.quality_gates![k as keyof QualityGateResult]
        )
      : [],
    commit_shas,
    next_steps: generateNextSteps(session),
    total_steps: session.steps.length,
    completed_steps: session.steps.filter(s => s.status === 'completed').length,
    duration_ms,
    // Anti-regression audit trail
    trace_id,
    commit_hash,
    verify_results,
  };

  // Store summary in episodic memory
  await writeMemory({
    layer: 'episodic',
    category: 'event',
    key: `summary_${sessionId}`,
    value: {
      session_id: sessionId,
      project: session.project,
      branch: session.branch,
      status: session.status,
      summary,
      generated_at: new Date().toISOString(),
    },
    source: 'system',
  });

  // Update session with summary
  await updateDevSession(sessionId, { summary });

  return summary;
}

/**
 * Generate next steps based on session state
 */
function generateNextSteps(session: DevSession): string[] {
  const steps: string[] = [];

  if (session.status === 'failed') {
    steps.push('Review error logs and fix issues');
    steps.push('Re-run /dev workflow');
    return steps;
  }

  if (!session.quality_gates?.all_passed) {
    if (!session.quality_gates?.qa_decision) {
      steps.push('Review and approve QA decision');
    }
    if (!session.quality_gates?.audit_pass) {
      steps.push('Address audit findings');
    }
    if (!session.quality_gates?.gate_file) {
      steps.push('Run quality gate validation');
    }
  }

  if (session.status === 'completed') {
    steps.push('Monitor CI pipeline');
    steps.push('Review merged changes');
  }

  return steps;
}

/**
 * Query recent dev sessions
 */
export async function queryDevSessions(options?: {
  status?: SessionStatus;
  project?: string;
  limit?: number;
}): Promise<DevSession[]> {
  const entries = await queryMemory({
    layer: 'episodic',
    category: 'event',
  });

  // Filter to dev_session_ entries
  let sessions = entries
    .filter((e: MemoryEntry) => e.key.startsWith('dev_session_'))
    .map((e: MemoryEntry) => e.value as unknown as DevSession);

  // Apply filters
  if (options?.status) {
    sessions = sessions.filter(s => s.status === options.status);
  }

  if (options?.project) {
    sessions = sessions.filter(s => s.project === options.project);
  }

  // Sort by started_at descending
  sessions.sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );

  // Apply limit
  if (options?.limit) {
    sessions = sessions.slice(0, options.limit);
  }

  return sessions;
}

/**
 * Complete a dev session
 */
export async function completeDevSession(
  sessionId: string,
  status: 'completed' | 'failed',
  prUrl?: string
): Promise<DevSession | null> {
  const session = await getDevSession(sessionId);
  if (!session) {
    return null;
  }

  // Update session status
  const updates: Partial<DevSession> = {
    status,
    completed_at: new Date(),
  };

  // Update and generate summary
  const updatedSession = await updateDevSession(sessionId, updates);
  if (!updatedSession) {
    return null;
  }

  // Generate summary
  const summary = await generateSessionSummary(sessionId);
  if (summary && prUrl) {
    summary.pr_url = prUrl;
    await updateDevSession(sessionId, { summary });
  }

  return getDevSession(sessionId);
}
