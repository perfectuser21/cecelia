/**
 * Pre-flight Check - Task Quality Validation
 *
 * Validates task quality before dispatch to prevent wasting executor resources.
 *
 * @module pre-flight-check
 */

/**
 * Perform pre-flight check on a task
 *
 * @param {Object} task - Task object from database
 * @param {string} task.id - Task ID
 * @param {string} task.title - Task title
 * @param {string} task.description - Task description (PRD content)
 * @param {string} task.priority - Priority (P0/P1/P2)
 * @returns {Promise<Object>} Check result
 * @returns {boolean} .passed - Whether check passed
 * @returns {Array<string>} .issues - List of issues found
 * @returns {Array<string>} .suggestions - Suggestions for fixing issues
 */
export async function preFlightCheck(task) {
  const issues = [];
  const suggestions = [];

  // System-generated tasks do not need PRDs — skip description/content checks
  const SYSTEM_TASK_TYPES = ['dept_heartbeat', 'codex_qa', 'initiative_verify'];
  const isSystemTask = SYSTEM_TASK_TYPES.includes(task.task_type);

  // Check 1: Title validation
  if (!task.title || task.title.trim().length === 0) {
    issues.push('Task title is empty');
    suggestions.push('Provide a descriptive title');
  } else if (task.title.trim().length < 5) {
    issues.push('Task title too short (< 5 characters)');
    suggestions.push('Use a more descriptive title (minimum 5 characters)');
  }

  // Check 2: Description validation (PRD content)
  // System tasks (dept_heartbeat, codex_qa, etc.) are auto-generated — no PRD required
  // Use description or prd_content as fallback
  const descContent = task.description || task.prd_content;
  if (!isSystemTask) {
    if (!descContent || descContent.trim().length === 0) {
      issues.push('Task description is empty');
      suggestions.push('Provide a PRD with clear requirements');
    } else if (descContent.trim().length < 20) {
      issues.push('Task description too short (< 20 characters)');
      suggestions.push('Provide more detailed requirements in the PRD');
    }
  }

  // Check 3: Priority validation
  const validPriorities = ['P0', 'P1', 'P2'];
  if (!task.priority || !validPriorities.includes(task.priority)) {
    issues.push(`Invalid priority: ${task.priority || 'undefined'}`);
    suggestions.push(`Set priority to one of: ${validPriorities.join(', ')}`);
  }

  // Check 4: Skill validation (if specified)
  if (task.skill) {
    const validSkills = ['/dev', '/qa', '/audit', '/review'];
    if (!validSkills.includes(task.skill)) {
      issues.push(`Unknown skill: ${task.skill}`);
      suggestions.push(`Use a valid skill: ${validSkills.join(', ')}`);
    }
  }

  // Check 5: Description content quality (basic heuristics)
  if (descContent) {
    // Strip markdown code blocks and inline code before placeholder detection,
    // so that examples like `- Task ID: xxx` or ```sql ... xxx``` don't false-positive.
    const stripped = descContent
      .replace(/```[\s\S]*?```/g, '')   // remove fenced code blocks
      .replace(/`[^`]*`/g, '');          // remove inline code spans
    const desc = stripped.toLowerCase();

    // Check for placeholder text using word boundaries to avoid false positives.
    // e.g. "TODO 记录" or "fixme this" in prose vs a bare "todo" / "tbd" as description.
    // `xxx` is only flagged when surrounded by non-CJK characters (avoids Chinese prose context).
    const hasWordPlaceholder = /\b(todo|tbd|fixme)\b/.test(desc);
    // `xxx` flagged only as a standalone token (word boundary, not inside Chinese text)
    const hasXxx = /(?<![^\x00-\x7F])xxx(?![^\x00-\x7F])/.test(stripped.toLowerCase());
    const hasPlaceholder = hasWordPlaceholder || hasXxx;

    if (hasPlaceholder) {
      issues.push('Description contains placeholder text');
      suggestions.push('Replace placeholder text with actual requirements');
    }

    // Check for minimal effort descriptions
    if (desc.trim() === 'test' || desc.trim() === 'fix' || desc.trim() === 'update') {
      issues.push('Description is too generic');
      suggestions.push('Provide specific details about what needs to be done');
    }
  }

  const passed = issues.length === 0;

  return {
    passed,
    issues,
    suggestions
  };
}

/**
 * Get pre-flight check statistics from working_memory
 *
 * @param {Object} pool - Database pool
 * @returns {Promise<Object>} Statistics
 */
export async function getPreFlightStats(pool) {
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE metadata->>'pre_flight_failed' = 'true') as failed_count,
      COUNT(*) FILTER (WHERE metadata->>'pre_flight_failed' IS NULL) as passed_count,
      jsonb_agg(metadata->'pre_flight_issues') FILTER (WHERE metadata->>'pre_flight_failed' = 'true') as all_issues
    FROM tasks
    WHERE created_at > NOW() - INTERVAL '7 days'
  `);

  const row = result.rows[0];
  const failedCount = parseInt(row.failed_count) || 0;
  const passedCount = parseInt(row.passed_count) || 0;
  const totalChecked = failedCount + passedCount;

  const passRate = totalChecked > 0 ? (passedCount / totalChecked * 100).toFixed(2) : 0;

  // Count issue types
  const issueDistribution = {};
  if (row.all_issues) {
    const allIssues = row.all_issues.flat().filter(Boolean);
    allIssues.forEach(issue => {
      issueDistribution[issue] = (issueDistribution[issue] || 0) + 1;
    });
  }

  return {
    totalChecked,
    passed: passedCount,
    failed: failedCount,
    passRate: `${passRate}%`,
    issueDistribution
  };
}
