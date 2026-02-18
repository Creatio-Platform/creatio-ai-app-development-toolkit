import { Router, Request, Response } from 'express';
import { creatioSchemaAgent } from '../agent/creatioSchemaAgent.js';
import { config } from '../config/env.js';

const router = Router();

/**
 * POST /agent/creatio-schema
 * Create or extend Creatio ClientUnitSchema using DeepAgent
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
