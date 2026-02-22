import axios, { AxiosInstance } from 'axios';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import {
  BrainConfig,
  BrainStatus,
  Task,
  Decision,
  Project,
  TraceEvent,
  AnalysisResult,
  SuggestionResult,
} from './types.js';

export class BrainClient extends EventEmitter {
  private api: AxiosInstance;
  private ws?: WebSocket;
  private config: BrainConfig;
  private reconnectTimer?: NodeJS.Timeout;
  private isConnected: boolean = false;

  constructor(brainUrl: string = 'http://localhost:5221', config?: Partial<BrainConfig>) {
    super();

    this.config = {
      url: brainUrl,
      timeout: config?.timeout || 30000,
      retryAttempts: config?.retryAttempts || 3,
      retryDelay: config?.retryDelay || 1000,
      enableWebSocket: config?.enableWebSocket !== false,
      ...config,
    };

    this.api = axios.create({
      baseURL: this.config.url,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (this.config.enableWebSocket) {
      this.connectWebSocket();
    }
  }

  // WebSocket connection for real-time updates
  private connectWebSocket() {
    const wsUrl = this.config.url.replace(/^http/, 'ws') + '/ws';

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.isConnected = true;
        this.emit('connected');
        console.log('Connected to Brain WebSocket');
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      });

      this.ws.on('close', () => {
        this.isConnected = false;
        this.emit('disconnected');
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.emit('error', error);
      });
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      console.log('Attempting to reconnect to Brain...');
      this.connectWebSocket();
    }, this.config.retryDelay);
  }

  private handleWebSocketMessage(message: any) {
    switch (message.type) {
      case 'task-update':
        this.emit('task-update', message.data);
        break;
      case 'brain-status':
        this.emit('brain-status', message.data);
        break;
      case 'alert':
        this.emit('alert', message.data);
        break;
      case 'suggestion':
        this.emit('suggestion', message.data);
        break;
      default:
        this.emit('message', message);
    }
  }

  // Core API Methods

  async getStatus(): Promise<BrainStatus> {
    const response = await this.api.get('/api/brain/status/full');
    return response.data;
  }

  async getHealth(): Promise<any> {
    const response = await this.api.get('/api/brain/health');
    return response.data;
  }

  // Task Management

  async getTasks(filters?: {
    status?: string;
    priority?: string;
    skill?: string;
  }): Promise<Task[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.priority) params.append('priority', filters.priority);
    if (filters?.skill) params.append('skill', filters.skill);

    const response = await this.api.get(`/api/brain/tasks?${params}`);
    return response.data;
  }

  async createTask(task: Partial<Task>): Promise<Task> {
    const response = await this.api.post('/api/brain/tasks', task);
    return response.data;
  }

  async updateTask(taskId: number, updates: Partial<Task>): Promise<Task> {
    const response = await this.api.patch(`/api/brain/tasks/${taskId}`, updates);
    return response.data;
  }

  async deleteTask(taskId: number): Promise<void> {
    await this.api.delete(`/api/brain/tasks/${taskId}`);
  }

  // Decision Support

  async requestDecision(context: any): Promise<Decision> {
    const response = await this.api.post('/api/brain/decide', context);
    return response.data;
  }

  async analyzeIntent(text: string): Promise<any> {
    const response = await this.api.post('/api/brain/intent/parse', { text });
    return response.data;
  }

  // Project Management

  async registerProject(project: Partial<Project>): Promise<Project> {
    const response = await this.api.post('/api/brain/projects', project);
    return response.data;
  }

  async getProjects(): Promise<Project[]> {
    const response = await this.api.get('/api/brain/projects');
    return response.data;
  }

  // Development Assistance

  async analyzeCode(options: {
    file?: string;
    content?: string;
    type?: 'quality' | 'security' | 'performance';
  }): Promise<AnalysisResult> {
    const response = await this.api.post('/api/brain/analyze', options);
    return response.data;
  }

  async getSuggestions(context: {
    file?: string;
    error?: string;
    description?: string;
  }): Promise<SuggestionResult> {
    const response = await this.api.post('/api/brain/suggest', context);
    return response.data;
  }

  // Tracing and Monitoring

  async sendTrace(event: TraceEvent): Promise<void> {
    await this.api.post('/api/brain/trace', event);
  }

  async getTraces(filters?: {
    sessionId?: string;
    startTime?: Date;
    endTime?: Date;
  }): Promise<TraceEvent[]> {
    const params = new URLSearchParams();
    if (filters?.sessionId) params.append('sessionId', filters.sessionId);
    if (filters?.startTime) params.append('startTime', filters.startTime.toISOString());
    if (filters?.endTime) params.append('endTime', filters.endTime.toISOString());

    const response = await this.api.get(`/api/brain/traces?${params}`);
    return response.data;
  }

  // Feedback and Learning

  async submitFeedback(feedback: {
    type: 'success' | 'failure' | 'improvement';
    context: any;
    message: string;
  }): Promise<void> {
    await this.api.post('/api/brain/feedback', feedback);
  }

  // Tick and Execution

  async triggerTick(): Promise<any> {
    const response = await this.api.post('/api/brain/tick');
    return response.data;
  }

  async getTickStatus(): Promise<any> {
    const response = await this.api.get('/api/brain/tick/status');
    return response.data;
  }

  // Utility Methods

  async executeCommand(command: string, args?: any): Promise<any> {
    const response = await this.api.post('/api/brain/execute', {
      command,
      args,
    });
    return response.data;
  }

  async getMetrics(type?: string): Promise<any> {
    const response = await this.api.get(`/api/brain/metrics${type ? `?type=${type}` : ''}`);
    return response.data;
  }

  // Connection Management

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  isConnectedToBrain(): boolean {
    return this.isConnected;
  }

  // Event subscription helpers

  onTaskUpdate(callback: (task: Task) => void) {
    this.on('task-update', callback);
  }

  onBrainStatus(callback: (status: BrainStatus) => void) {
    this.on('brain-status', callback);
  }

  onAlert(callback: (alert: any) => void) {
    this.on('alert', callback);
  }

  onSuggestion(callback: (suggestion: any) => void) {
    this.on('suggestion', callback);
  }
}