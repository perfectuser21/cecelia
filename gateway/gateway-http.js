#!/usr/bin/env node
/**
 * Gateway HTTP Server - Unified Input Gateway for Cecelia System
 * Provides HTTP API for task enqueueing and status checking
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Configuration
const PORT = process.env.GATEWAY_PORT || 5680;
const HOST = process.env.GATEWAY_HOST || '0.0.0.0';
const GATEWAY_CLI = path.join(__dirname, 'gateway.sh');

// Helper: Read request body
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      resolve(body);
    });
    req.on('error', reject);
  });
}

// Helper: Execute gateway CLI command
function executeGateway(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('bash', [GATEWAY_CLI, ...args]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => {
      stdout += data.toString();
    });

    proc.stderr.on('data', data => {
      stderr += data.toString();
    });

    proc.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr, exitCode: code });
      } else {
        reject(new Error(`Gateway CLI failed: ${stderr}`));
      }
    });

    proc.on('error', reject);
  });
}

// Helper: Send JSON response
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

// Helper: Send error response
function sendError(res, statusCode, message) {
  sendJSON(res, statusCode, {
    error: true,
    message,
    timestamp: new Date().toISOString()
  });
}

// Route: POST /enqueue
async function handleEnqueue(req, res) {
  try {
    const body = await readBody(req);

    // Validate JSON
    let task;
    try {
      task = JSON.parse(body);
    } catch (err) {
      return sendError(res, 400, 'Invalid JSON format');
    }

    // Validate required fields
    const required = ['taskId', 'source', 'intent', 'priority', 'payload'];
    for (const field of required) {
      if (!task[field]) {
        return sendError(res, 400, `Missing required field: ${field}`);
      }
    }

    // Call gateway CLI (enqueue mode)
    const result = await executeGateway(['enqueue', JSON.stringify(task)]);

    sendJSON(res, 200, {
      success: true,
      taskId: task.taskId,
      message: 'Task enqueued successfully',
      output: result.stdout
    });
  } catch (err) {
    console.error('Error in /enqueue:', err);
    sendError(res, 500, err.message);
  }
}

// Route: GET /status
async function handleStatus(req, res) {
  try {
    const result = await executeGateway(['status']);

    // Parse status output
    const lines = result.stdout.split('\n');
    const queueLength = lines.find(l => l.includes('Total tasks:'))?.split(':')[1]?.trim() || '0';
    const p0 = lines.find(l => l.includes('P0'))?.split(':')[1]?.trim() || '0';
    const p1 = lines.find(l => l.includes('P1'))?.split(':')[1]?.trim() || '0';
    const p2 = lines.find(l => l.includes('P2'))?.split(':')[1]?.trim() || '0';

    sendJSON(res, 200, {
      queueLength: parseInt(queueLength),
      byPriority: {
        P0: parseInt(p0),
        P1: parseInt(p1),
        P2: parseInt(p2)
      },
      rawOutput: result.stdout
    });
  } catch (err) {
    console.error('Error in /status:', err);
    sendError(res, 500, err.message);
  }
}

// Route: GET /health
async function handleHealth(req, res) {
  try {
    // Check if gateway.sh is executable
    const gatewayExists = fs.existsSync(GATEWAY_CLI);
    const gatewayStats = gatewayExists ? fs.statSync(GATEWAY_CLI) : null;
    const gatewayExecutable = gatewayStats && (gatewayStats.mode & 0o111);

    if (!gatewayExists) {
      return sendError(res, 503, 'Gateway CLI not found');
    }

    if (!gatewayExecutable) {
      return sendError(res, 503, 'Gateway CLI not executable');
    }

    // Try to get status (basic health check)
    try {
      await executeGateway(['status']);
    } catch (err) {
      return sendError(res, 503, `Gateway CLI error: ${err.message}`);
    }

    sendJSON(res, 200, {
      status: 'healthy',
      service: 'cecelia-gateway-http',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in /health:', err);
    sendError(res, 500, err.message);
  }
}

// Route: POST /add (Simplified CLI-style API)
async function handleAdd(req, res) {
  try {
    const body = await readBody(req);

    // Parse simplified payload
    let params;
    try {
      params = JSON.parse(body);
    } catch (err) {
      return sendError(res, 400, 'Invalid JSON format');
    }

    // Validate required fields
    if (!params.source || !params.intent) {
      return sendError(res, 400, 'Missing required fields: source, intent');
    }

    const { source, intent, priority = 'P2', payload = {} } = params;

    // Call gateway CLI (add mode)
    const result = await executeGateway([
      'add',
      source,
      intent,
      priority,
      JSON.stringify(payload)
    ]);

    sendJSON(res, 200, {
      success: true,
      message: 'Task added successfully',
      output: result.stdout
    });
  } catch (err) {
    console.error('Error in /add:', err);
    sendError(res, 500, err.message);
  }
}

// Request handler
async function handleRequest(req, res) {
  const { method, url } = req;

  console.log(`[${new Date().toISOString()}] ${method} ${url}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle OPTIONS (CORS preflight)
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Route dispatcher
  try {
    if (method === 'POST' && url === '/enqueue') {
      await handleEnqueue(req, res);
    } else if (method === 'POST' && url === '/add') {
      await handleAdd(req, res);
    } else if (method === 'GET' && url === '/status') {
      await handleStatus(req, res);
    } else if (method === 'GET' && url === '/health') {
      await handleHealth(req, res);
    } else if (method === 'GET' && url === '/') {
      // Root path - show API documentation
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`Cecelia Gateway HTTP Server

Available endpoints:

POST /enqueue
  - Enqueue a task with full JSON payload
  - Body: {"taskId":"uuid","source":"...","intent":"...","priority":"...","payload":{...}}

POST /add
  - Add a task with simplified parameters
  - Body: {"source":"cloudcode","intent":"runQA","priority":"P0","payload":{...}}

GET /status
  - Get current queue status

GET /health
  - Health check

Example:
  curl -X POST http://localhost:${PORT}/add \\
    -H "Content-Type: application/json" \\
    -d '{"source":"cloudcode","intent":"runQA","priority":"P0","payload":{"project":"cecelia-quality"}}'
`);
    } else {
      sendError(res, 404, 'Not found');
    }
  } catch (err) {
    console.error('Unexpected error:', err);
    sendError(res, 500, 'Internal server error');
  }
}

// Start server
const server = http.createServer(handleRequest);

server.listen(PORT, HOST, () => {
  console.log(`✅ Cecelia Gateway HTTP Server running on http://${HOST}:${PORT}`);
  console.log('');
  console.log('Available endpoints:');
  console.log(`  POST http://${HOST}:${PORT}/enqueue  - Enqueue task (full JSON)`);
  console.log(`  POST http://${HOST}:${PORT}/add      - Add task (simplified)`);
  console.log(`  GET  http://${HOST}:${PORT}/status   - Queue status`);
  console.log(`  GET  http://${HOST}:${PORT}/health   - Health check`);
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
