import express, { Express } from 'express';
import { config } from './config/env.js';
import healthRouter from './routes/health.js';
import agentRouter from './routes/agent.js';
import creatioAgentRouter from './routes/creatioAgent.js';

export const createServer = (): Express => {
  const app = express();

  // Middleware
  app.use(express.json({ limit: '1mb' }));

  // Routes
  app.use('/health', healthRouter);
  app.use('/agent', agentRouter);
  app.use('/agent/creatio', creatioAgentRouter);

  return app;
};

export const startServer = (app: Express): void => {
  const port = config.port;

  app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log(`Health check: http://localhost:${port}/health`);
    console.log(`DeepAgent Translation: http://localhost:${port}/agent/translate`);
    console.log(`DeepAgent Creatio Schema: http://localhost:${port}/agent/creatio/schema`);
  });
};
