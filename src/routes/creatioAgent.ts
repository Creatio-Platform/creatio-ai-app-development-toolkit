import { Router, Request, Response } from 'express';
import { creatioSchemaAgent } from '../agent/creatioSchemaAgent.js';
import { config } from '../config/env.js';
import { getCreatioServer } from '../mcp/creatioMcpServer.js';

const router = Router();

type ToolResponse = {
  content?: Array<{ type?: string; text?: string }>;
};

type ParsedToolResponse = Record<string, any>;
type DirectCreateResult = ParsedToolResponse & {
  packageUId: string;
  schemaUId?: string;
  schemaName?: string;
};

function parseToolResponse(response: ToolResponse): ParsedToolResponse {
  const text = response.content?.[0]?.text;
  if (!text) {
    throw new Error('Empty tool response');
  }
  return JSON.parse(text);
}

function isUkrainianText(text: string): boolean {
  return /[А-Яа-яІіЇїЄєҐґ]/.test(text);
}

function detectSchemaType(text: string): string {
  const lower = text.toLowerCase();
  if (/\bmodule\b|модул/.test(lower)) {
    return 'Module';
  }
  if (/\bentity\b|сутніст/.test(lower)) {
    return 'EntitySchema';
  }
  return 'AngularSchema';
}

function extractSchemaName(text: string): string | null {
  const patterns = [
    /(?:з\s+назвою|іменем|named|name)\s*["']?([A-Za-z][A-Za-z0-9_]*)["']?/i,
    /(?:схем(?:у|а|и)?|schema|page|сторінк(?:у|а|и)?|module|entity)\s+["']?([A-Za-z][A-Za-z0-9_]*)["']?$/i,
    /^(?:створи|зроби|create|make|build)\s+["']?([A-Za-z][A-Za-z0-9_]*)["']?$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function isCreateIntent(text: string): boolean {
  return /(створи|зроби|create|make|build|нова\s+схема|new\s+schema|нова\s+сторінка|new\s+page)/i.test(text);
}

function isUnsupportedIntent(text: string): boolean {
  return /(видали|delete|remove|зміни\s+код|modify\s+code|update\s+code|компіляц|compile|deploy|деплой)/i.test(text);
}

async function createSchemaDirectly(
  customName: string,
  schemaType: string,
  userLevelSchema: boolean,
): Promise<DirectCreateResult> {
  const server = getCreatioServer();
  const packageResult = parseToolResponse(await server.getPackageUId({ userLevelSchema }));

  if (!packageResult.success || !packageResult.packageUId) {
    throw new Error(packageResult.error || 'Failed to resolve design package');
  }

  const createResult = parseToolResponse(
    await server.createSchema({
      schemaType,
      packageUId: packageResult.packageUId,
      customName,
      userLevelSchema,
    }),
  );

  if (!createResult.success) {
    throw new Error(createResult.error || 'Failed to create schema');
  }

  return {
    ...createResult,
    packageUId: String(packageResult.packageUId),
  } as DirectCreateResult;
}

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
    console.log('[Creatio Agent] Request timestamp:', new Date().toISOString());

    const isUk = isUkrainianText(text);

    if (isUnsupportedIntent(text)) {
      res.json({
        success: false,
        operation: 'not_supported',
        message: isUk
          ? 'Операція ще не підтримується. Доступні: створення та розширення схем.'
          : 'Operation is not supported yet. Supported operations: create and extend schema.',
      });
      return;
    }

    if (isCreateIntent(text)) {
      const customName = extractSchemaName(text);

      if (customName) {
        const schemaType = detectSchemaType(text);
        const directResult = await createSchemaDirectly(customName, schemaType, false);

        const response = {
          success: true,
          operation: 'create_schema',
          message: isUk
            ? `Створено схему ${directResult.schemaName}`
            : `Schema ${directResult.schemaName} has been created`,
          schemaUId: directResult.schemaUId,
          schemaName: directResult.schemaName,
          schemaType: schemaType,
          packageUId: directResult.packageUId,
          reasoning: isUk
            ? 'Команда розпізнана як створення схеми і виконана напряму через MCP-інструменти.'
            : 'Command was detected as schema creation and executed directly via MCP tools.',
        };

        if (config.creatio.url) {
          (response as any).creatio_url = `${config.creatio.url}/0/ClientApp/#/PageDesigner/${directResult.schemaUId}`;
        }

        res.json(response);
        return;
      }
    }

    // Invoke DeepAgent with natural language input
    const agentResult = await creatioSchemaAgent.invoke({
      messages: [{ role: 'user', content: text }],
    });
    
    console.log('[Creatio Agent] Agent invocation completed');
    console.log('[Creatio Agent] Messages count:', agentResult.messages.length);

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

    if (action === 'create') {
      if (!schemaName || !schemaType) {
        res.status(400).json({
          success: false,
          error: 'For create action: schemaName and schemaType are required',
        });
        return;
      }

      const server = getCreatioServer();
      const type = String(schemaType);
      const isUk = isUkrainianText(String(description || schemaName));

      let resolvedPackageUId = packageUId;
      if (!resolvedPackageUId) {
        const packageResult = parseToolResponse(await server.getPackageUId({ userLevelSchema: userLevelSchema ?? false }));
        if (!packageResult.success || !packageResult.packageUId) {
          throw new Error(packageResult.error || 'Failed to get design package UID');
        }
        resolvedPackageUId = packageResult.packageUId;
      }

      let parentSchemaUId: string | undefined;
      if (parentSchemaName) {
        const parentInfo = parseToolResponse(await server.getSchema({ schemaName: parentSchemaName }));
        parentSchemaUId = parentInfo?.schemaInfo?.schemaUId;
        if (!parentSchemaUId) {
          throw new Error(`Parent schema not found: ${parentSchemaName}`);
        }
      }

      const createResult = parseToolResponse(
        await server.createSchema({
          schemaType: type,
          packageUId: resolvedPackageUId,
          customName: schemaName,
          parentSchemaUId,
          userLevelSchema: userLevelSchema ?? false,
        }),
      );

      if (!createResult.success) {
        throw new Error(createResult.error || 'Failed to create schema');
      }

      const response = {
        success: true,
        operation: 'create_schema',
        message: isUk
          ? `Створено схему ${createResult.schemaName}`
          : `Schema ${createResult.schemaName} has been created`,
        schemaUId: createResult.schemaUId,
        schemaName: createResult.schemaName,
        schemaType: type,
        packageUId: resolvedPackageUId,
        parentSchemaUId: parentSchemaUId || null,
        description: description || null,
      };

      res.json(response);
      return;
    } else if (action === 'extend') {
      if (!parentSchemaName) {
        res.status(400).json({
          success: false,
          error: 'For extend action: parentSchemaName is required',
        });
        return;
      }

      const server = getCreatioServer();
      const isUk = isUkrainianText(String(description || parentSchemaName));

      let resolvedPackageUId = packageUId;
      if (!resolvedPackageUId) {
        const packageResult = parseToolResponse(await server.getPackageUId({ userLevelSchema: userLevelSchema ?? false }));
        if (!packageResult.success || !packageResult.packageUId) {
          throw new Error(packageResult.error || 'Failed to get design package UID');
        }
        resolvedPackageUId = packageResult.packageUId;
      }

      const parentInfo = parseToolResponse(await server.getSchema({ schemaName: parentSchemaName }));
      const parentSchemaUId = parentInfo?.schemaInfo?.schemaUId;
      if (!parentSchemaUId) {
        throw new Error(`Parent schema not found: ${parentSchemaName}`);
      }

      const extendResult = parseToolResponse(
        await server.extendSchemaMethod({
          parentSchemaUId,
          packageUId: resolvedPackageUId,
          userLevelSchema: userLevelSchema ?? false,
        }),
      );

      if (!extendResult.success) {
        throw new Error(extendResult.error || 'Failed to extend schema');
      }

      const response = {
        success: true,
        operation: 'extend_schema',
        message: isUk
          ? `Схему ${parentSchemaName} розширено`
          : `Schema ${parentSchemaName} has been extended`,
        schemaUId: extendResult.schemaUId,
        schemaName: extendResult.schemaName,
        schemaType: extendResult.schemaType,
        packageUId: resolvedPackageUId,
        parentSchemaUId,
        description: description || null,
      };

      res.json(response);
      return;
    } else {
      res.status(400).json({
        success: false,
        error: 'Invalid action. Supported: "create" or "extend"',
      });
      return;
    }
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
