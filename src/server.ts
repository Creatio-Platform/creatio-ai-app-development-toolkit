import express, { Express } from 'express';
import { config } from './config/env.js';
import healthRouter from './routes/health.js';
import chainRouter from './routes/chain.js';

export const createServer = (): Express => {
  const app = express();

  // Middleware
  app.use(express.json({ limit: '1mb' }));

  // Routes
  app.use('/health', healthRouter);
  app.use('/chain', chainRouter);

  return app;
};

export const startServer = (app: Express): void => {
  const port = config.port;

  app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log(`Health check: http://localhost:${port}/health`);
    console.log(`Chain endpoint: http://localhost:${port}/chain/hello`);
  });
};
