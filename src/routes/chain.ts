import { Router, Request, Response } from 'express';
import { createHelloChain } from '../chain/helloChain.js';

const router = Router();

router.post('/hello', async (req: Request, res: Response) => {
  try {
    const { input } = req.body;

    // Validate input
    if (!input || typeof input !== 'string') {
      res.status(400).json({ error: 'Invalid input. Expected a string field named "input".' });
      return;
    }

    // Create and invoke the chain
    const chain = createHelloChain();
    const output = await chain.invoke(input);

    res.json({ output });
  } catch (error) {
    console.error('Error processing chain request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
