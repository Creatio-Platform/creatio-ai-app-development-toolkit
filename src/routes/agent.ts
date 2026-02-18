import { Router, Request, Response } from 'express';
import { createTranslationAgent } from '../agent/translationAgent.js';

const router = Router();

router.post('/translate', async (req: Request, res: Response) => {
  try {
    const { input, style, save_terms, context } = req.body;

    // Validate input
    if (!input || typeof input !== 'string' || input.trim() === '') {
      res.status(400).json({
        error: 'Invalid input. Expected a non-empty string field named "input".',
      });
      return;
    }

    // Build the user message with options
    let userMessage = `Translate: "${input}"`;

    if (style) {
      userMessage += `\nStyle: ${style}`;
    }

    if (context) {
      userMessage += `\nContext: ${context}`;
    }

    if (save_terms) {
      userMessage += '\nPlease save important technical terms to the terminology database.';
    }

    // Create and invoke the translation agent
    const agent = createTranslationAgent();
    const result = await agent.invoke({
      messages: [{ role: 'user', content: userMessage }],
    });

    // Extract the final message from agent response
    const messages = result.messages || [];
    const lastMessage = messages[messages.length - 1];
    const agentResponse = lastMessage?.content || 'No response from agent';

    // Try to parse structured information from response
    const response: any = {
      output: agentResponse,
      agent_type: 'deepagent',
    };

    // Check if agent provided structured data in its response
    // For now, return the full agent response
    // In a production app, you might parse the agent's response more carefully

    res.json(response);
  } catch (error) {
    console.error('Error processing agent translation request:', error);

    // Check if error is about missing API key
    if (error instanceof Error && error.message.includes('OPENAI_API_KEY')) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
