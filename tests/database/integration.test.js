/**
 * Integration tests for publishing system
 * Tests full workflow from task creation to record keeping
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import publishingTasksDAO from '../../brain/src/dao/publishingTasksDAO.js';
import publishingRecordsDAO from '../../brain/src/dao/publishingRecordsDAO.js';
import publishingCredentialsDAO from '../../brain/src/dao/publishingCredentialsDAO.js';

describe('Publishing System Integration', () => {
  let testTaskId;
  let testCredId;
  const testPlatform = 'integration_test_platform';

  beforeAll(async () => {
    // Set up test credential
    const credential = await publishingCredentialsDAO.create({
      platform: testPlatform,
      account_name: 'integration_test_account',
      credentials: {
        api_key: 'test_key',
        api_secret: 'test_secret'
      },
      is_active: true
    });
    testCredId = credential.id;
  });

  afterAll(async () => {
    // Clean up
    if (testTaskId) {
      await publishingTasksDAO.delete(testTaskId);
    }
    if (testCredId) {
      await publishingCredentialsDAO.delete(testCredId);
    }
  });

  it('should complete full publishing workflow', async () => {
    // Step 1: Create a publishing task
    const task = await publishingTasksDAO.create({
      platform: testPlatform,
      content_type: 'text',
      content: {
        title: 'Integration Test Post',
        text: 'This is a test post for integration testing',
        tags: ['test', 'integration']
      },
      status: 'pending'
    });

    testTaskId = task.id;

    expect(task).toBeDefined();
    expect(task.id).toBeDefined();
    expect(task.status).toBe('pending');

    // Step 2: Update task to scheduled
    const scheduledTask = await publishingTasksDAO.updateStatus(
      task.id,
      'scheduled',
      null
    );

    expect(scheduledTask.status).toBe('scheduled');

    // Step 3: Simulate publishing process - update to publishing
    const publishingTask = await publishingTasksDAO.updateStatus(
      task.id,
      'publishing',
      null
    );

    expect(publishingTask.status).toBe('publishing');

    // Step 4: Simulate successful publish - create record
    const publishTime = new Date();
    const record = await publishingRecordsDAO.create({
      task_id: task.id,
      platform: testPlatform,
      success: true,
      platform_response: {
        post_id: 'test_post_123',
        url: 'https://example.com/posts/test_post_123',
        created_at: publishTime.toISOString()
      }
    });

    expect(record).toBeDefined();
    expect(record.task_id).toBe(task.id);
    expect(record.success).toBe(true);

    // Step 5: Update task to completed
    const completedTask = await publishingTasksDAO.updateStatus(
      task.id,
      'completed',
      publishTime
    );

    expect(completedTask.status).toBe('completed');
    expect(completedTask.published_at).toBeDefined();

    // Step 6: Verify we can retrieve the complete workflow
    const retrievedTask = await publishingTasksDAO.getById(task.id);
    const taskRecords = await publishingRecordsDAO.getByTaskId(task.id);

    expect(retrievedTask.status).toBe('completed');
    expect(taskRecords.length).toBeGreaterThan(0);
    expect(taskRecords[0].success).toBe(true);
  });

  it('should handle failed publishing workflow', async () => {
    // Create a task
    const task = await publishingTasksDAO.create({
      platform: testPlatform,
      content_type: 'text',
      content: { text: 'Test failure' },
      status: 'pending'
    });

    // Update to publishing
    await publishingTasksDAO.updateStatus(task.id, 'publishing', null);

    // Create failed record
    const record = await publishingRecordsDAO.create({
      task_id: task.id,
      platform: testPlatform,
      success: false,
      error_message: 'Rate limit exceeded',
      platform_response: {
        error_code: 429,
        message: 'Too many requests'
      }
    });

    expect(record.success).toBe(false);
    expect(record.error_message).toBe('Rate limit exceeded');

    // Update task to failed
    const failedTask = await publishingTasksDAO.updateStatus(task.id, 'failed', null);

    expect(failedTask.status).toBe('failed');

    // Clean up
    await publishingTasksDAO.delete(task.id);
  });

  it('should retrieve credentials for publishing', async () => {
    // Verify credentials are available for the platform
    const credentials = await publishingCredentialsDAO.getByPlatform(
      testPlatform,
      true,
      true
    );

    expect(credentials.length).toBeGreaterThan(0);

    const cred = credentials[0];
    expect(cred.platform).toBe(testPlatform);
    expect(cred.is_active).toBe(true);
    expect(cred.credentials).toBeDefined();
    expect(cred.credentials.api_key).toBe('test_key');
  });

  it('should support multiple publishing attempts', async () => {
    // Create a task
    const task = await publishingTasksDAO.create({
      platform: testPlatform,
      content_type: 'text',
      content: { text: 'Retry test' },
      status: 'pending'
    });

    // First attempt - fail
    await publishingRecordsDAO.create({
      task_id: task.id,
      platform: testPlatform,
      success: false,
      error_message: 'Network error'
    });

    // Second attempt - fail
    await publishingRecordsDAO.create({
      task_id: task.id,
      platform: testPlatform,
      success: false,
      error_message: 'Timeout'
    });

    // Third attempt - success
    await publishingRecordsDAO.create({
      task_id: task.id,
      platform: testPlatform,
      success: true,
      platform_response: { post_id: 'success_123' }
    });

    // Verify all attempts are recorded
    const records = await publishingRecordsDAO.getByTaskId(task.id);

    expect(records.length).toBe(3);
    expect(records[0].success).toBe(true); // Most recent first
    expect(records[1].success).toBe(false);
    expect(records[2].success).toBe(false);

    // Clean up
    await publishingTasksDAO.delete(task.id);
  });

  it('should handle scheduled tasks correctly', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1); // Tomorrow

    // Create scheduled task
    const task = await publishingTasksDAO.create({
      platform: testPlatform,
      content_type: 'text',
      content: { text: 'Scheduled post' },
      status: 'scheduled',
      scheduled_at: futureDate
    });

    // Verify it's not in the ready queue
    const readyTasks = await publishingTasksDAO.getScheduledReady();
    const isInReady = readyTasks.some(t => t.id === task.id);

    expect(isInReady).toBe(false);

    // Update to past date
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1); // Yesterday

    await publishingTasksDAO.update(task.id, {
      scheduled_at: pastDate
    });

    // Now it should be in the ready queue
    const readyTasksNow = await publishingTasksDAO.getScheduledReady();
    const isNowInReady = readyTasksNow.some(t => t.id === task.id);

    expect(isNowInReady).toBe(true);

    // Clean up
    await publishingTasksDAO.delete(task.id);
  });

  it('should cascade delete records when task is deleted', async () => {
    // Create task and record
    const task = await publishingTasksDAO.create({
      platform: testPlatform,
      content_type: 'text',
      content: { text: 'Delete test' },
      status: 'pending'
    });

    const record = await publishingRecordsDAO.create({
      task_id: task.id,
      platform: testPlatform,
      success: true
    });

    // Delete task
    await publishingTasksDAO.delete(task.id);

    // Verify record is also deleted (cascade)
    const records = await publishingRecordsDAO.getByTaskId(task.id);

    expect(records.length).toBe(0);
  });

  it('should generate statistics correctly', async () => {
    // Create multiple tasks with different statuses
    const tasks = [];

    tasks.push(await publishingTasksDAO.create({
      platform: testPlatform,
      content_type: 'text',
      content: { text: 'Stats test 1' },
      status: 'pending'
    }));

    tasks.push(await publishingTasksDAO.create({
      platform: testPlatform,
      content_type: 'text',
      content: { text: 'Stats test 2' },
      status: 'completed'
    }));

    tasks.push(await publishingTasksDAO.create({
      platform: testPlatform,
      content_type: 'text',
      content: { text: 'Stats test 3' },
      status: 'failed'
    }));

    // Get statistics
    const stats = await publishingTasksDAO.getStatistics();

    expect(stats.pending).toBeGreaterThan(0);
    expect(stats.completed).toBeGreaterThan(0);
    expect(stats.failed).toBeGreaterThan(0);

    // Clean up
    for (const task of tasks) {
      await publishingTasksDAO.delete(task.id);
    }
  });
});
