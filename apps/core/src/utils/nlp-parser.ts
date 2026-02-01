/**
 * NLP Parser for Intent Recognition
 *
 * Lightweight rule-based natural language parser for intent recognition.
 * Uses keyword matching and pattern detection (no ML models).
 */

import {
  IntentType,
  Priority,
  TaskStatus,
  ExtractedEntities,
  ConfidenceLevel
} from '../types/intent.types.js';

/**
 * Pattern definitions for intent recognition
 */
const INTENT_PATTERNS = {
  // Goal patterns (high-level objectives)
  CREATE_GOAL: [
    /完成.*系统/i,
    /实现.*系统/i,
    /目标.*是/i,
    /作为.*目标/i,
    /P0.*目标/i,
    /P1.*目标/i,
    /P2.*目标/i,
  ],

  // Project patterns
  CREATE_PROJECT: [
    /新建.*项目/i,
    /创建.*项目/i,
    /建立.*项目/i,
    /新项目/i,
    /new project/i,
    /create project/i,
  ],

  // Task patterns (specific implementations)
  CREATE_TASK: [
    /实现.*功能/i,
    /实现.*接口/i,
    /实现.*API/i,
    /添加.*功能/i,
    /创建.*任务/i,
    /新任务/i,
    /做.*功能/i,
    /写.*代码/i,
    /开发.*功能/i,
    /implement/i,
    /add.*feature/i,
    /create.*task/i,
    /build/i,
  ],

  // Query patterns
  QUERY_TASKS: [
    /有哪些.*任务/i,
    /查看.*任务/i,
    /列出.*任务/i,
    /我的任务/i,
    /待办任务/i,
    /what.*tasks/i,
    /list.*tasks/i,
    /show.*tasks/i,
    /查询/i,
  ],

  // Update patterns
  UPDATE_TASK: [
    /标记为.*完成/i,
    /设置为.*完成/i,
    /改为.*完成/i,
    /更新.*状态/i,
    /修改.*状态/i,
    /mark.*complete/i,
    /update.*status/i,
    /set.*status/i,
  ],
};

/**
 * Priority extraction patterns
 */
const PRIORITY_PATTERNS: Record<Priority, RegExp[]> = {
  P0: [/P0/i, /最高优先级/i, /紧急/i, /critical/i, /urgent/i],
  P1: [/P1/i, /高优先级/i, /重要/i, /important/i],
  P2: [/P2/i, /普通优先级/i, /一般/i, /normal/i, /低优先级/i, /low/i],
};

/**
 * Status extraction patterns
 */
const STATUS_PATTERNS: Record<TaskStatus, RegExp[]> = {
  pending: [/待办/i, /未开始/i, /pending/i, /todo/i],
  queued: [/排队/i, /queued/i],
  in_progress: [/进行中/i, /正在做/i, /in progress/i, /doing/i],
  completed: [/完成/i, /已完成/i, /done/i, /completed/i, /finished/i],
  failed: [/失败/i, /failed/i],
  blocked: [/阻塞/i, /被阻塞/i, /blocked/i],
};

/**
 * Extract intent type from text using pattern matching
 */
export function extractIntent(text: string): {
  intent: IntentType;
  confidence: number;
  matchedPhrases: string[];
} {
  const normalizedText = text.trim();
  let bestMatch = { intent: IntentType.UNKNOWN, confidence: 0, phrases: [] as string[] };

  // Check each intent type
  for (const [intentName, patterns] of Object.entries(INTENT_PATTERNS)) {
    const matchedPhrases: string[] = [];
    let matchCount = 0;

    for (const pattern of patterns) {
      if (pattern.test(normalizedText)) {
        matchCount++;
        const match = normalizedText.match(pattern);
        if (match) {
          matchedPhrases.push(match[0]);
        }
      }
    }

    if (matchCount > 0) {
      // Calculate confidence based on number of matching patterns
      const confidence = Math.min(matchCount / patterns.length + 0.3, 1.0);

      if (confidence > bestMatch.confidence) {
        bestMatch = {
          intent: intentName as IntentType,
          confidence,
          phrases: matchedPhrases,
        };
      }
    }
  }

  // Distinguish between Goal and Task by semantic keywords
  if (bestMatch.intent === IntentType.CREATE_TASK || bestMatch.intent === IntentType.CREATE_GOAL) {
    // Goals are typically about systems, objectives, high-level achievements
    const goalKeywords = [
      '系统', '目标', '完成整个', '实现整个', '构建整个',
      'system', 'objective', 'goal', 'complete entire',
    ];

    // Tasks are specific implementations
    const taskKeywords = [
      '实现', '接口', 'API', '功能', '添加', '修改',
      'implement', 'interface', 'feature', 'add', 'modify',
    ];

    const hasGoalKeyword = goalKeywords.some(kw =>
      normalizedText.toLowerCase().includes(kw.toLowerCase())
    );
    const hasTaskKeyword = taskKeywords.some(kw =>
      normalizedText.toLowerCase().includes(kw.toLowerCase())
    );

    // If both present, check which appears first or is more prominent
    if (hasGoalKeyword && !hasTaskKeyword) {
      bestMatch.intent = IntentType.CREATE_GOAL;
    } else if (hasTaskKeyword && !hasGoalKeyword) {
      bestMatch.intent = IntentType.CREATE_TASK;
    }
    // If both or neither, keep current best match
  }

  return {
    intent: bestMatch.intent,
    confidence: bestMatch.confidence,
    matchedPhrases: bestMatch.phrases,
  };
}

/**
 * Extract priority from text
 */
export function extractPriority(text: string): Priority | undefined {
  for (const [priority, patterns] of Object.entries(PRIORITY_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return priority as Priority;
      }
    }
  }
  return undefined; // Default will be set by service
}

/**
 * Extract status from text
 */
export function extractStatus(text: string): TaskStatus | undefined {
  for (const [status, patterns] of Object.entries(STATUS_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return status as TaskStatus;
      }
    }
  }
  return undefined;
}

/**
 * Extract title from text based on intent type
 * @param text The input text
 * @param intent The recognized intent type
 * @returns The extracted title
 */
export function extractTitle(text: string, intent: IntentType): string | undefined {
  // Remove common action words to extract the core title
  const actionWords = [
    '实现', '添加', '创建', '新建', '完成', '做', '开发', '写', '构建',
    '标记为', '设置为', '改为', '更新', '修改',
    'implement', 'add', 'create', 'build', 'complete', 'mark', 'set', 'update',
    '任务', '功能', '目标', '项目', 'task', 'feature', 'goal', 'project',
    '：', ':', // Remove colons
  ];

  let title = text.trim();

  // Remove priority markers
  title = title.replace(/P[012]/gi, '').trim();

  // Remove action words at the beginning
  for (const word of actionWords) {
    const regex = new RegExp(`^${word}\\s*`, 'i');
    title = title.replace(regex, '');
  }

  // Remove quotes if present
  title = title.replace(/^["']|["']$/g, '');

  // Clean up multiple spaces
  title = title.replace(/\s+/g, ' ').trim();

  return title || undefined;
}

/**
 * Extract project or goal reference from text
 */
export function extractProjectGoal(text: string): {
  project?: string;
  goal?: string;
} {
  const result: { project?: string; goal?: string } = {};

  // Pattern: "for project XXX" or "属于XXX项目"
  // Use restrictive character class for project/goal names
  const namePattern = '[A-Za-z0-9\\u4e00-\\u9fa5_\\-\\s]+';
  const projectMatch = text.match(new RegExp(`(?:for project|属于|在)\\s*["""']?(${namePattern}?)["""']?\\s*(?:项目|project)`, 'i'));
  if (projectMatch && projectMatch[1]) {
    const extracted = projectMatch[1].trim();
    // Validate length (1-100 characters)
    if (extracted.length > 0 && extracted.length <= 100) {
      result.project = extracted;
    }
  }

  // Pattern: "for goal XXX" or "目标XXX"
  const goalMatch = text.match(new RegExp(`(?:for goal|目标)\\s*["""']?(${namePattern}?)["""']?`, 'i'));
  if (goalMatch && goalMatch[1]) {
    const extracted = goalMatch[1].trim();
    // Validate length (1-100 characters)
    if (extracted.length > 0 && extracted.length <= 100) {
      result.goal = extracted;
    }
  }

  return result;
}

/**
 * Determine confidence level from numeric confidence
 */
export function getConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.7) return 'high';
  if (confidence >= 0.4) return 'medium';
  return 'low';
}

/**
 * Extract all entities from text
 */
export function extractEntities(text: string, intent: IntentType): ExtractedEntities {
  const entities: ExtractedEntities = {};

  // Extract title
  entities.title = extractTitle(text, intent);

  // Extract priority
  entities.priority = extractPriority(text);

  // Extract status (for query or update operations)
  entities.status = extractStatus(text);

  // Extract project/goal references
  const projectGoal = extractProjectGoal(text);
  entities.project = projectGoal.project;
  entities.goal = projectGoal.goal;

  return entities;
}

/**
 * Generate explanation for the recognition result
 */
export function generateExplanation(intent: IntentType, entities: ExtractedEntities, confidence: number): string {
  const confidenceLevel = getConfidenceLevel(confidence);

  let explanation = '';

  switch (intent) {
    case IntentType.CREATE_TASK:
      explanation = `识别为创建任务意图 (${Math.round(confidence * 100)}% 确信度)`;
      if (entities.title) explanation += `，任务名称: "${entities.title}"`;
      break;

    case IntentType.CREATE_GOAL:
      explanation = `识别为创建目标意图 (${Math.round(confidence * 100)}% 确信度)`;
      if (entities.title) explanation += `，目标名称: "${entities.title}"`;
      break;

    case IntentType.CREATE_PROJECT:
      explanation = `识别为创建项目意图 (${Math.round(confidence * 100)}% 确信度)`;
      if (entities.title) explanation += `，项目名称: "${entities.title}"`;
      break;

    case IntentType.QUERY_TASKS:
      explanation = `识别为查询任务意图 (${Math.round(confidence * 100)}% 确信度)`;
      if (entities.status) explanation += `，状态过滤: ${entities.status}`;
      break;

    case IntentType.UPDATE_TASK:
      explanation = `识别为更新任务意图 (${Math.round(confidence * 100)}% 确信度)`;
      if (entities.title) explanation += `，任务: "${entities.title}"`;
      if (entities.status) explanation += `，新状态: ${entities.status}`;
      break;

    default:
      explanation = `无法明确识别意图类型 (${Math.round(confidence * 100)}% 确信度)`;
  }

  if (confidenceLevel === 'low') {
    explanation += ' (建议用户确认)';
  }

  return explanation;
}
