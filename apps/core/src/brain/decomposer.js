/**
 * TRD Decomposer - Stage 2
 *
 * Decomposes a Technical Requirements Document (TRD) into:
 * TRD -> Milestones -> PRDs -> Tasks
 *
 * Each task can be executed by cecelia-run (1 task = 1 PR)
 */

import pool from '../task-system/db.js';
import crypto from 'crypto';

/**
 * Parse TRD content and extract section structure
 * @param {string} content - Raw TRD text
 * @returns {Array} Sections with headers and content
 */
export function parseTRDSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let currentSection = null;

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);

    if (headerMatch) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        level: headerMatch[1].length,
        title: headerMatch[2].trim(),
        content: [],
        items: []
      };
    } else if (currentSection) {
      const listMatch = line.match(/^[\s]*[-*]\s+(.+)$/) || line.match(/^[\s]*\d+\.\s+(.+)$/);
      if (listMatch) {
        currentSection.items.push(listMatch[1].trim());
      }
      currentSection.content.push(line);
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Extract milestones from parsed sections
 * @param {Array} sections - Parsed sections
 * @returns {Array} Milestones with associated sections
 */
export function extractMilestones(sections) {
  const milestones = [];
  let currentMilestone = null;

  for (const section of sections) {
    if (section.level === 1) {
      continue;
    }

    if (section.level === 2) {
      if (currentMilestone) {
        milestones.push(currentMilestone);
      }
      currentMilestone = {
        id: `milestone-${crypto.randomUUID().slice(0, 8)}`,
        title: section.title,
        sections: [section],
        items: [...section.items]
      };
    } else if (currentMilestone) {
      currentMilestone.sections.push(section);
      currentMilestone.items.push(...section.items);
    }
  }

  if (currentMilestone) {
    milestones.push(currentMilestone);
  }

  if (milestones.length === 0 && sections.length > 0) {
    milestones.push({
      id: `milestone-${crypto.randomUUID().slice(0, 8)}`,
      title: sections[0]?.title || 'Default Milestone',
      sections: sections,
      items: sections.flatMap(s => s.items)
    });
  }

  return milestones;
}

/**
 * Generate a PRD from a milestone
 */
export function generatePRD(milestone, index) {
  const prdContent = `# PRD: ${milestone.title}

## Background

This PRD is auto-generated from TRD milestone ${index + 1}.

## Requirements

${milestone.items.map((item, i) => `${i + 1}. ${item}`).join('\n')}

## Acceptance Criteria

${milestone.items.map((item) => `- [ ] ${item}`).join('\n')}
`;

  return {
    id: `prd-${crypto.randomUUID().slice(0, 8)}`,
    title: milestone.title,
    content: prdContent,
    milestoneId: milestone.id,
    items: milestone.items
  };
}

/**
 * Create tasks from a PRD
 */
export function createTasksFromPRD(prd, milestoneIndex) {
  const tasks = [];
  const basePriority = milestoneIndex === 0 ? 'P1' : 'P2';

  for (let i = 0; i < prd.items.length; i++) {
    const item = prd.items[i];

    const task = {
      id: `task-${crypto.randomUUID().slice(0, 8)}`,
      title: item,
      prdId: prd.id,
      prdTitle: prd.title,
      milestoneId: prd.milestoneId,
      priority: i === 0 ? basePriority : 'P2',
      depends_on: i > 0 ? [tasks[i - 1].id] : [],
      sequence: i + 1,
      prd_content: `# Task: ${item}\n\nPart of: ${prd.title}\n\n## Requirement\n\n${item}\n\n## Context\n\n${prd.content}`
    };

    tasks.push(task);
  }

  return tasks;
}

/**
 * Establish cross-milestone dependencies
 */
export function establishDependencies(allTasks) {
  const result = [];
  let previousLastTask = null;

  for (const milestoneTasks of allTasks) {
    if (milestoneTasks.length > 0) {
      if (previousLastTask && milestoneTasks[0].depends_on.length === 0) {
        milestoneTasks[0].depends_on.push(previousLastTask.id);
      }

      result.push(...milestoneTasks);
      previousLastTask = milestoneTasks[milestoneTasks.length - 1];
    }
  }

  return result;
}

/**
 * Main decomposition function
 */
export async function decomposeTRD(trdContent, projectId = null, goalId = null) {
  const sections = parseTRDSections(trdContent);

  if (sections.length === 0) {
    throw new Error('TRD content is empty or has no valid sections');
  }

  const milestones = extractMilestones(sections);
  const prds = milestones.map((m, i) => generatePRD(m, i));
  const tasksByMilestone = prds.map((prd, i) => createTasksFromPRD(prd, i));
  const allTasks = establishDependencies(tasksByMilestone);

  const trdResult = await pool.query(`
    INSERT INTO trd_decompositions (content, project_id, goal_id, status)
    VALUES ($1, $2, $3, 'active')
    RETURNING id
  `, [trdContent, projectId, goalId]);

  const trdId = trdResult.rows[0].id;

  const createdTasks = [];
  for (let i = 0; i < allTasks.length; i++) {
    const task = allTasks[i];

    const dependsOnIds = [];
    for (const depId of task.depends_on) {
      const depTask = createdTasks.find(t => t.tempId === depId);
      if (depTask) {
        dependsOnIds.push(depTask.id);
      }
    }

    const taskResult = await pool.query(`
      INSERT INTO tasks (
        title, priority, status, project_id, goal_id, prd_content, payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      task.title,
      task.priority,
      'pending',
      projectId,
      goalId,
      task.prd_content,
      JSON.stringify({
        depends_on: dependsOnIds,
        prd_title: task.prdTitle,
        milestone_id: task.milestoneId,
        sequence: task.sequence
      })
    ]);

    const createdTask = {
      id: taskResult.rows[0].id,
      tempId: task.id,
      title: task.title,
      priority: task.priority,
      depends_on: dependsOnIds
    };
    createdTasks.push(createdTask);

    await pool.query(`
      INSERT INTO trd_decomposition_tasks (trd_id, task_id, milestone, prd_title, sequence_order)
      VALUES ($1, $2, $3, $4, $5)
    `, [trdId, createdTask.id, task.milestoneId, task.prdTitle, i + 1]);
  }

  const response = {
    trd_id: trdId,
    milestones: milestones.map((m, mIdx) => ({
      id: m.id,
      title: m.title,
      prds: [prds[mIdx]].map(prd => ({
        id: prd.id,
        title: prd.title,
        content: prd.content,
        tasks: createdTasks
          .filter(t => {
            const taskInMilestone = allTasks.find(at => at.id === t.tempId);
            return taskInMilestone?.milestoneId === m.id;
          })
          .map(t => ({
            id: t.id,
            title: t.title,
            priority: t.priority,
            depends_on: t.depends_on
          }))
      }))
    })),
    total_tasks: createdTasks.length
  };

  return response;
}

/**
 * Get TRD progress
 */
export async function getTRDProgress(trdId) {
  const trdResult = await pool.query('SELECT * FROM trd_decompositions WHERE id = $1', [trdId]);
  if (trdResult.rows.length === 0) {
    throw new Error('TRD not found');
  }

  const tasksResult = await pool.query(`
    SELECT t.id, t.title, t.status, t.priority, tt.milestone, tt.prd_title, tt.sequence_order
    FROM tasks t
    JOIN trd_decomposition_tasks tt ON t.id = tt.task_id
    WHERE tt.trd_id = $1
    ORDER BY tt.sequence_order
  `, [trdId]);

  const tasks = tasksResult.rows;
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress');

  const milestoneMap = new Map();
  for (const task of tasks) {
    const key = task.milestone || 'default';
    if (!milestoneMap.has(key)) {
      milestoneMap.set(key, { total: 0, completed: 0 });
    }
    const m = milestoneMap.get(key);
    m.total++;
    if (task.status === 'completed') {
      m.completed++;
    }
  }

  const milestones = [];
  for (const [id, stats] of milestoneMap.entries()) {
    milestones.push({
      id,
      status: stats.completed === stats.total ? 'completed' :
              stats.completed > 0 ? 'in_progress' : 'pending',
      progress: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0
    });
  }

  return {
    trd_id: trdId,
    total_tasks: totalTasks,
    completed_tasks: completedTasks,
    current_task: inProgressTasks.length > 0 ? inProgressTasks[0].id : null,
    current_task_title: inProgressTasks.length > 0 ? inProgressTasks[0].title : null,
    progress_percent: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
    milestones
  };
}

/**
 * List all TRDs
 */
export async function listTRDs(limit = 10) {
  const result = await pool.query(`
    SELECT t.id, t.status, t.project_id, t.goal_id, t.created_at,
           COUNT(tt.id) as total_tasks,
           COUNT(CASE WHEN tasks.status = 'completed' THEN 1 END) as completed_tasks
    FROM trd_decompositions t
    LEFT JOIN trd_decomposition_tasks tt ON t.id = tt.trd_id
    LEFT JOIN tasks ON tt.task_id = tasks.id
    GROUP BY t.id
    ORDER BY t.created_at DESC
    LIMIT $1
  `, [limit]);

  return result.rows.map(row => ({
    id: row.id,
    status: row.status,
    project_id: row.project_id,
    goal_id: row.goal_id,
    created_at: row.created_at,
    total_tasks: parseInt(row.total_tasks) || 0,
    completed_tasks: parseInt(row.completed_tasks) || 0,
    progress_percent: row.total_tasks > 0
      ? Math.round((row.completed_tasks / row.total_tasks) * 100)
      : 0
  }));
}
