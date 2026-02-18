import { Router, Request, Response } from 'express';
import { creatioSchemaAgent } from '../agent/creatioSchemaAgent.js';
import { parseCreatioIntent } from '../agent/creatioIntentParser.js';
import { config } from '../config/env.js';
import {
  createSchemaDirectly,
  createSchemaStructured,
  extendSchemaStructured,
  listSchemaTemplates,
  withCreatioUrl,
  type SchemaLocale,
} from '../services/creatioSchemaService.js';
import { TemplateSelectionStore } from '../services/templateSelectionStore.js';

const router = Router();
const templateSelectionStore = new TemplateSelectionStore();

function isUkrainianText(text: string): boolean {
  return /[А-Яа-яІіЇїЄєҐґ]/.test(text);
}

function parseAgentResponse(agentResponse: unknown): Record<string, any> {
  try {
    let jsonStr = typeof agentResponse === 'string' ? agentResponse : JSON.stringify(agentResponse);
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }
    return JSON.parse(jsonStr);
  } catch {
    const responseText = String(agentResponse);
    const isUnsupported =
      responseText.includes('не підтримується') ||
      responseText.includes('not supported') ||
      responseText.includes('cannot');

    return {
      success: !isUnsupported,
      operation: isUnsupported ? 'not_supported' : 'unknown',
      message: responseText,
      raw_response: responseText,
    };
  }
}

function localeFromText(text: string): SchemaLocale {
  return isUkrainianText(text) ? 'uk' : 'en';
}

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { text, templateSelectionId, templateUId, templateName } = req.body;

    if (
      (!templateSelectionId && (!text || typeof text !== 'string' || text.trim().length === 0)) ||
      (templateSelectionId && typeof templateSelectionId !== 'string')
    ) {
      res.status(400).json({
        success: false,
        error: 'Invalid input. Provide text command or valid templateSelectionId.',
      });
      return;
    }

    if (templateSelectionId) {
      const pending = templateSelectionStore.get(templateSelectionId);
      if (!pending) {
        res.status(400).json({
          success: false,
          operation: 'template_selection_expired',
          message: 'Template selection is expired or not found. Please repeat your create request.',
        });
        return;
      }

      if (!templateUId && !templateName) {
        res.status(400).json({
          success: false,
          operation: 'template_selection_required',
          message: pending.language === 'uk'
            ? 'Оберіть шаблон зі списку.'
            : 'Please choose one of the listed templates.',
        });
        return;
      }

      const created = await createSchemaDirectly({
        schemaName: pending.schemaName,
        schemaType: pending.schemaType,
        userLevelSchema: pending.userLevelSchema,
        template: { templateUId, templateName },
      });

      templateSelectionStore.delete(templateSelectionId);

      const response = withCreatioUrl(
        {
          success: true,
          operation: 'create_schema',
          message: pending.language === 'uk'
            ? `Створено схему ${created.schemaName}`
            : `Schema ${created.schemaName} has been created`,
          schemaUId: created.schemaUId,
          schemaName: created.schemaName,
          schemaType: pending.schemaType,
          packageUId: created.packageUId,
          template: created.template || null,
          reasoning: pending.language === 'uk'
            ? 'Схему створено після вибору шаблону.'
            : 'Schema was created after template selection.',
        },
        config.creatio.url,
      );

      res.json(response);
      return;
    }

    console.log('[Creatio Agent] Processing command:', text);
    console.log('[Creatio Agent] Request timestamp:', new Date().toISOString());

    const intent = await parseCreatioIntent(text);
    const isUk = intent.language === 'uk';

    if (intent.operation === 'not_supported') {
      res.json({
        success: false,
        operation: 'not_supported',
        message: isUk
          ? 'Операція ще не підтримується. Доступні: створення та розширення схем.'
          : 'Operation is not supported yet. Supported operations: create and extend schema.',
      });
      return;
    }

    if (intent.operation === 'create_schema' && intent.schemaName) {
      if (!intent.templateName && !intent.templateUId) {
        const templatesResult = await listSchemaTemplates(intent.schemaType || 'AngularSchema');
        const templates = Array.isArray(templatesResult.templates) ? templatesResult.templates : [];

        if (templates.length === 0) {
          throw new Error('No templates available for selected schema type');
        }

        const selectionId = templateSelectionStore.create({
          schemaName: intent.schemaName,
          schemaType: intent.schemaType || 'AngularSchema',
          userLevelSchema: intent.userLevelSchema ?? false,
          language: intent.language,
        });

        res.json({
          success: true,
          operation: 'awaiting_template_selection',
          message: isUk
            ? 'Оберіть шаблон для нової сторінки.'
            : 'Choose a template for the new page.',
          selectionId,
          schemaName: intent.schemaName,
          schemaType: intent.schemaType || 'AngularSchema',
          templates,
        });
        return;
      }

      const created = await createSchemaDirectly({
        schemaName: intent.schemaName,
        schemaType: intent.schemaType || 'AngularSchema',
        userLevelSchema: intent.userLevelSchema ?? false,
        template: {
          templateName: intent.templateName || undefined,
          templateUId: intent.templateUId || undefined,
        },
      });

      const response = withCreatioUrl(
        {
          success: true,
          operation: 'create_schema',
          message: isUk
            ? `Створено схему ${created.schemaName}`
            : `Schema ${created.schemaName} has been created`,
          schemaUId: created.schemaUId,
          schemaName: created.schemaName,
          schemaType: intent.schemaType || 'AngularSchema',
          packageUId: created.packageUId,
          template: created.template || null,
          reasoning: isUk
            ? 'Команда розпізнана LLM як створення схеми і виконана напряму через MCP-інструменти.'
            : 'LLM detected schema creation and it was executed directly via MCP tools.',
        },
        config.creatio.url,
      );

      res.json(response);
      return;
    }

    const agentResult = await creatioSchemaAgent.invoke({
      messages: [{ role: 'user', content: text }],
    });

    console.log('[Creatio Agent] Agent invocation completed');
    console.log('[Creatio Agent] Messages count:', agentResult.messages.length);

    const lastMessage = agentResult.messages[agentResult.messages.length - 1];
    const parsed = parseAgentResponse(lastMessage.content);
    res.json(withCreatioUrl(parsed, config.creatio.url));
  } catch (error: any) {
    console.error('[Creatio Agent] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process command',
      details: error.stack,
    });
  }
});

router.post('/schema', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      action,
      schemaName,
      schemaType,
      packageUId,
      parentSchemaName,
      templateName,
      templateUId,
      description,
      userLevelSchema,
    } = req.body;

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

      const locale = localeFromText(String(description || schemaName));
      const response = await createSchemaStructured(
        {
          schemaName,
          schemaType: String(schemaType),
          packageUId,
          parentSchemaName,
          templateName,
          templateUId,
          description,
          userLevelSchema,
        },
        locale,
      );

      res.json(response);
      return;
    }

    if (action === 'extend') {
      if (!parentSchemaName) {
        res.status(400).json({
          success: false,
          error: 'For extend action: parentSchemaName is required',
        });
        return;
      }

      const locale = localeFromText(String(description || parentSchemaName));
      const response = await extendSchemaStructured(
        {
          parentSchemaName,
          packageUId,
          description,
          userLevelSchema,
        },
        locale,
      );

      res.json(response);
      return;
    }

    res.status(400).json({
      success: false,
      error: 'Invalid action. Supported: "create" or "extend"',
    });
  } catch (error: any) {
    console.error('Creatio schema agent error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process schema request',
    });
  }
});

router.get('/templates', async (req: Request, res: Response) => {
  try {
    const schemaType = String(req.query.schemaType || 'AngularSchema');
    const result = await listSchemaTemplates(schemaType);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to load schema templates',
    });
  }
});

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
