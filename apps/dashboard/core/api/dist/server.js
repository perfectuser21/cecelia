"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Main server application
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const connection_1 = require("./shared/db/connection");
const config_1 = __importDefault(require("./shared/utils/config"));
const logger_1 = __importDefault(require("./shared/utils/logger"));
const error_middleware_1 = require("./shared/middleware/error.middleware");
const logger_middleware_1 = require("./shared/middleware/logger.middleware");
const bootstrap_1 = require("./bootstrap");
class Server {
    constructor() {
        this.app = (0, express_1.default)();
    }
    async initialize() {
        this.setupMiddleware();
        await this.setupApiModules();
        this.setupErrorHandling();
    }
    setupMiddleware() {
        // Security
        this.app.use((0, helmet_1.default)());
        // CORS
        this.app.use((0, cors_1.default)({
            origin: config_1.default.cors.origin,
            credentials: true,
        }));
        // Body parsing
        this.app.use(express_1.default.json({ limit: '10mb' }));
        this.app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
        // Request logging
        this.app.use(logger_middleware_1.requestLogger);
        // Health check (no auth required)
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                database: connection_1.db.getStatus(),
            });
        });
        // Public media files (for zenithjoyai.com to access uploaded images)
        this.app.use('/media', (req, res, next) => {
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            res.setHeader('Access-Control-Allow-Origin', '*');
            next();
        }, express_1.default.static('/app/data/uploads'));
    }
    async setupApiModules() {
        // Auto-load all API modules from modules/ directory
        await (0, bootstrap_1.loadApiModules)(this.app);
    }
    setupErrorHandling() {
        this.app.use(error_middleware_1.notFoundHandler);
        this.app.use(error_middleware_1.errorHandler);
    }
    async start() {
        try {
            await connection_1.db.connect();
            logger_1.default.info('Database connected successfully');
            await this.initialize();
            // VPS metrics collection disabled (moved to zenithjoy-core)
            const port = config_1.default.port;
            this.app.listen(port, '0.0.0.0', () => {
                logger_1.default.info(`Server started on port ${port}`, {
                    nodeEnv: config_1.default.nodeEnv,
                    port,
                });
            });
        }
        catch (error) {
            logger_1.default.error('Failed to start server', {
                error: error.message,
                stack: error.stack,
            });
            process.exit(1);
        }
    }
    async stop() {
        try {
            // VPS metrics collection disabled (moved to zenithjoy-core)
            await connection_1.db.close();
            logger_1.default.info('Server stopped');
        }
        catch (error) {
            logger_1.default.error('Error stopping server', { error: error.message });
        }
    }
}
// Handle uncaught errors
process.on('uncaughtException', (error) => {
    logger_1.default.error('Uncaught exception', {
        error: error.message,
        stack: error.stack,
    });
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    logger_1.default.error('Unhandled rejection', { reason, promise });
    process.exit(1);
});
// Graceful shutdown
process.on('SIGTERM', async () => {
    logger_1.default.info('SIGTERM received, shutting down gracefully');
    await server.stop();
    process.exit(0);
});
process.on('SIGINT', async () => {
    logger_1.default.info('SIGINT received, shutting down gracefully');
    await server.stop();
    process.exit(0);
});
// Start server
const server = new Server();
server.start();
exports.default = Server;
//# sourceMappingURL=server.js.map