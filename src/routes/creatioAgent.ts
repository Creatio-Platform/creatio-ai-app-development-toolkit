import { Router, Request, Response } from 'express';
import { creatioSchemaAgent } from '../agent/creatioSchemaAgent.js';
import { config } from '../config/env.js';

const router = Router();

/**
 * POST /agent/creatio
 * Process natural language commands for Creatio operations
 * Body: { text: string } - Natural language command in Ukrainian or English
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: text is required (natural language command)',
      });
      return;
    }

    console.log('[Creatio Agent] Processing command:', text);

    // Invoke DeepAgent with natural language input
    const agentResult = await creatioSchemaAgent.invoke({
      messages: [{ role: 'user', content: text }],
    });

    // Parse agent response
    const lastMessage = agentResult.messages[agentResult.messages.length - 1];
    let agentResponse = lastMessage.content;

    // Try to parse as JSON if agent returned structured response
    let parsedResponse;
    try {
      // Strip markdown code blocks if present (```json ... ```)
      let jsonStr = typeof agentResponse === 'string' ? agentResponse : JSON.stringify(agentResponse);
      const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
      }
      
      parsedResponse = JSON.parse(jsonStr);
    } catch {
      // If not JSON, wrap in response object
      const responseText = String(agentResponse);
      const isUnsupported = 
        responseText.includes('не підтримується') || 
        responseText.includes('not supported') ||
        responseText.includes('cannot');
        
      parsedResponse = {
        success: !isUnsupported,
        operation: isUnsupported ? 'not_supported' : 'unknown',
        message: responseText,
        raw_response: responseText,
      };
    }

    // Add Creatio URL if schema was created
    if (parsedResponse.schemaUId && config.creatio.url) {
      parsedResponse.creatio_url = `${config.creatio.url}/0/ClientApp/#/PageDesigner/${parsedResponse.schemaUId}`;
    }

    console.log('[Creatio Agent] Response:', JSON.stringify(parsedResponse, null, 2));

    res.json(parsedResponse);
  } catch (error: any) {
    console.error('[Creatio Agent] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process command',
      details: error.stack,
    });
  }
});

/**
 * POST /agent/creatio/schema
 * Create or extend Creatio ClientUnitSchema using structured input (legacy)
 */
router.post('/schema', async (req: Request, res: Response): Promise<void> => {
  try {
    const { action, schemaName, schemaType, packageUId, parentSchemaName, description, userLevelSchema } = req.body;

    if (!action) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: action is required',
      });
      return;
    }

    // Build agent input based on action type
    let agentInput = '';

    if (action === 'create') {
      if (!schemaName || !schemaType) {
        res.status(400).json({
          success: false,
          error: 'For create action: schemaName and schemaType are required',
        });
        return;
      }

      agentInput = `Create a new Creatio schema with the following details:
- Schema Name: ${schemaName}
- Schema Type: ${schemaType}
${packageUId ? `- Package GUID: ${packageUId}` : '- Package GUID: (get design package automatically)'}
- User Level: ${userLevelSchema ?? false}
${parentSchemaName ? `- Parent Schema: ${parentSchemaName} (apply inheritance)` : ''}
${description ? `- Purpose: ${description}` : ''}

Steps:
${packageUId ? '' : '1. Get design package GUID using get_design_package_uid\n'}
${packageUId ? '1' : '2'}. Validate that schema name "${schemaName}" is available
${parentSchemaName ? `${packageUId ? '2' : '3'}. Find parent schema "${parentSchemaName}" in available parents` : ''}
${parentSchemaName ? `${packageUId ? '3' : '4'}. Create schema with parent inheritance` : `${packageUId ? '2' : '3'}. Create new schema`}
${parentSchemaName ? `${packageUId ? '4' : '5'}. Verify schema was created successfully` : `${packageUId ? '3' : '4'}. Verify schema was created successfully`}

Return the created schema details including GUID and final name.`;
    } else if (action === 'extend') {
      if (!parentSchemaName) {
        res.status(400).json({
          success: false,
          error: 'For extend action: parentSchemaName is required',
        });
        return;
      }

      agentInput = `Extend an existing Creatio schema:
- Parent Schema Name: ${parentSchemaName}
${packageUId ? `- Package GUID: ${packageUId}` : '- Package GUID: (get design package automatically)'}
- User Level: ${userLevelSchema ?? false}
${description ? `- Purpose: ${description}` : ''}

Steps:
${packageUId ? '' : '1. Get design package GUID using get_design_package_uid\n'}
${packageUId ? '1' : '2'}. Find parent schema "${parentSchemaName}" using get_schema_info
${packageUId ? '2' : '3'}. Use extend_schema to create child schema
${packageUId ? '3' : '4'}. Verify inheritance was applied correctly
${packageUId ? '4' : '5'}. Return extended schema details

The extended schema will inherit the parent's name and configuration.`;
    } else {
      res.status(400).json({
        success: false,
        error: 'Invalid action. Supported: "create" or "extend"',
      });
      return;
    }

    // Invoke DeepAgent
    const agentResult = await creatioSchemaAgent.invoke({
      messages: [{ role: 'user', content: agentInput }],
    });

    // Parse agent response
    const lastMessage = agentResult.messages[agentResult.messages.length - 1];
    const agentResponse = lastMessage.content;

    const response = {
      success: true,
      agent_response: agentResponse,
      creatio_url: config.creatio.url,
      action,
      package: packageUId,
    };

    res.json(response);
  } catch (error: any) {
    console.error('Creatio schema agent error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process schema request',
    });
  }
});

/**
 * GET /agent/creatio-schema/health
 * Check Creatio connection status
 */
router.get('/schema/health', async (_req: Request, res: Response) => {
  try {
    const { getCreatioClient } = await import('../creatio/creatioClient.js');
    const client = getCreatioClient();

    const isConnected = client.isConnected();
    const hasConfig = !!(config.creatio.url && config.creatio.username && config.creatio.password);

    res.json({
      success: true,
      creatio_configured: hasConfig,
      creatio_url: config.creatio.url || 'not configured',
      authenticated: isConnected,
      message: hasConfig
        ? isConnected
          ? 'Creatio client authenticated'
          : 'Creatio client configured but not authenticated yet'
        : 'Creatio configuration missing (set CREATIO_URL, CREATIO_USERNAME, CREATIO_PASSWORD)',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
