import winston from 'winston';
import chalk from 'chalk';
import { BrainClient } from '@cecelia/sdk';

const { combine, timestamp, printf, colorize } = winston.format;

// Custom format for console output
const consoleFormat = printf(({ level, message, timestamp, ...meta }) => {
  const ts = new Date(timestamp).toISOString().split('T')[1].split('.')[0];
  let output = `${chalk.gray(ts)} ${level}: ${message}`;

  if (Object.keys(meta).length > 0) {
    output += `\\n${chalk.gray(JSON.stringify(meta, null, 2))}`;
  }

  return output;
});

export class Logger {
  private winston: winston.Logger;
  private brainClient?: BrainClient;
  private sessionId: string;

  constructor(options?: {
    level?: string;
    brainUrl?: string;
    sessionId?: string;
  }) {
    this.sessionId = options?.sessionId || `session-${Date.now()}`;

    this.winston = winston.createLogger({
      level: options?.level || process.env.LOG_LEVEL || 'info',
      format: combine(
        timestamp(),
        winston.format.errors({ stack: true }),
      ),
      transports: [
        new winston.transports.Console({
          format: combine(
            colorize({ all: true }),
            consoleFormat
          ),
        }),
      ],
    });

    // Add file transport in production
    if (process.env.NODE_ENV === 'production') {
      this.winston.add(new winston.transports.File({
        filename: 'cecelia-engine.log',
        format: combine(
          timestamp(),
          winston.format.json()
        ),
      }));
    }

    // Connect to Brain for centralized logging
    if (options?.brainUrl) {
      this.connectBrain(options.brainUrl);
    }
  }

  private connectBrain(brainUrl: string) {
    try {
      this.brainClient = new BrainClient(brainUrl);
      this.winston.info('Connected to Brain for centralized logging');
    } catch (error) {
      this.winston.warn('Failed to connect to Brain for logging', error);
    }
  }

  private async sendToBrain(level: string, message: string, meta?: any) {
    if (!this.brainClient) return;

    try {
      await this.brainClient.sendTrace({
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        type: level as any,
        component: 'cecelia-engine',
        action: 'log',
        data: { message, ...meta },
      });
    } catch (error) {
      // Silently fail if Brain is not available
    }
  }

  setLevel(level: string) {
    this.winston.level = level;
  }

  debug(message: string, meta?: any) {
    this.winston.debug(message, meta);
    this.sendToBrain('info', message, meta);
  }

  info(message: string, meta?: any) {
    this.winston.info(message, meta);
    this.sendToBrain('info', message, meta);
  }

  warn(message: string, meta?: any) {
    this.winston.warn(message, meta);
    this.sendToBrain('warning', message, meta);
  }

  error(message: string, error?: Error | any, meta?: any) {
    if (error instanceof Error) {
      this.winston.error(message, {
        error: error.message,
        stack: error.stack,
        ...meta,
      });
      this.sendToBrain('error', message, {
        error: error.message,
        stack: error.stack,
        ...meta,
      });
    } else {
      this.winston.error(message, { error, ...meta });
      this.sendToBrain('error', message, { error, ...meta });
    }
  }

  success(message: string, meta?: any) {
    this.winston.info(chalk.green(message), meta);
    this.sendToBrain('info', message, { type: 'success', ...meta });
  }

  startSpinner(message: string): { stop: (success?: boolean) => void } {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    let intervalId: NodeJS.Timer;

    process.stdout.write(`${message} ${frames[0]}`);

    intervalId = setInterval(() => {
      process.stdout.write(`\\r${message} ${frames[++i % frames.length]}`);
    }, 100);

    return {
      stop: (success = true) => {
        clearInterval(intervalId);
        process.stdout.write('\\r');
        if (success) {
          this.success(message);
        } else {
          this.error(message);
        }
      },
    };
  }
}

// Default logger instance
export const logger = new Logger({
  brainUrl: process.env.BRAIN_URL,
});