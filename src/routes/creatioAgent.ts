import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import { ZodError } from 'zod';
import { config } from '../config/env.js';
import {
  naturalCreatioRequestSchema,
  structuredSchemaRequestSchema,
} from '../domain/schema/contracts.js';
import { toApiError, validationError } from '../domain/errors/apiError.js';
import {
  createSchemaStructured,
  extendSchemaStructured,
  listSchemaTemplates,
  withCreatioUrl,
  type SchemaLocale,
} from '../services/creatioSchemaService.js';
import { IdempotencyStore } from '../services/idempotencyStore.js';
import { getSchemaCreationGateway } from '../integrations/schema-creation/gateway.js';
import {
  getCreatioGraphState,
  resumeCreatioGraph,
  runCreatioGraph,
  streamCreatioGraph,
} from '../graph/creatio/runtime.js';

const router = Router();
const idempotencyStore = new IdempotencyStore();

function isUkrainianText(text: string): boolean {
  return /[А-Яа-яІіЇїЄєҐґ]/.test(text);
}

function localeFromText(text: string): SchemaLocale {
  return isUkrainianText(text) ? 'uk' : 'en';
}

function toValidationMessage(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

function getIdempotencyKey(req: Request, bodyKey?: string): string | undefined {
  const headerValue = req.header('Idempotency-Key');
  if (headerValue && headerValue.trim().length > 0) {
    return headerValue.trim();
  }

  if (bodyKey && bodyKey.trim().length > 0) {
    return bodyKey.trim();
  }

  return undefined;
}

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const input = naturalCreatioRequestSchema.parse(req.body);
    const idempotencyKey = getIdempotencyKey(req, input.idempotencyKey);
    const threadId = input.threadId || input.templateSelectionId || randomUUID();

    const isResume = (!!input.threadId || !!input.templateSelectionId)
      && (!!input.templateUId || !!input.templateName);

    if (isResume) {
      if (idempotencyKey) {
        const cached = idempotencyStore.get(`graph:resume:${threadId}`, idempotencyKey);
        if (cached) {
          res.json(cached);
          return;
        }
      }

      const result = await resumeCreatioGraph({
        threadId,
        templateUId: input.templateUId,
        templateName: input.templateName,
      });

      if (idempotencyKey) {
        idempotencyStore.set(`graph:resume:${threadId}`, idempotencyKey, result);
      }

      res.json(result);
      return;
    }

    if (!input.text) {
      res.status(400).json({
        success: false,
        code: 'BAD_REQUEST',
        error: 'Text is required for run step',
      });
      return;
    }

    if (idempotencyKey) {
      const cached = idempotencyStore.get(`graph:run:${threadId}`, idempotencyKey);
      if (cached) {
        res.json(cached);
        return;
      }
    }

    const result = await runCreatioGraph({
      text: input.text,
      threadId,
    });

    if (idempotencyKey) {
      idempotencyStore.set(`graph:run:${threadId}`, idempotencyKey, result);
    }

    res.json(result);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      const apiError = validationError(toValidationMessage(error));
      res.status(apiError.statusCode).json({
        success: false,
        code: apiError.code,
        error: apiError.message,
      });
      return;
    }

    const apiError = toApiError(error);
    console.error('[Creatio Agent] Error:', error);
    res.status(apiError.statusCode).json({
      success: false,
      code: apiError.code,
      error: apiError.message,
      meta: apiError.meta,
    });
  }
});

router.post('/stream', async (req: Request, res: Response): Promise<void> => {
  try {
    const input = naturalCreatioRequestSchema.parse(req.body);
    const threadId = input.threadId || input.templateSelectionId || randomUUID();

    const isResume = (!!input.threadId || !!input.templateSelectionId)
      && (!!input.templateUId || !!input.templateName);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const stream = await streamCreatioGraph({
      threadId,
      text: input.text,
      resume: isResume
        ? {
            templateUId: input.templateUId,
            templateName: input.templateName,
          }
        : undefined,
    });

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify({ threadId, chunk })}\n\n`);
    }

    res.write('event: done\ndata: {}\n\n');
    res.end();
  } catch (error: unknown) {
    const apiError = toApiError(error);
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({
        success: false,
        code: apiError.code,
        error: apiError.message,
        meta: apiError.meta,
      })}\n\n`);
      res.end();
      return;
    }

    res.status(apiError.statusCode).json({
      success: false,
      code: apiError.code,
      error: apiError.message,
      meta: apiError.meta,
    });
  }
});

router.get('/state', async (req: Request, res: Response): Promise<void> => {
  try {
    const threadId = String(req.query.threadId || '').trim();
    if (!threadId) {
      res.status(400).json({
        success: false,
        code: 'BAD_REQUEST',
        error: 'threadId is required',
      });
      return;
    }

    const state = await getCreatioGraphState(threadId);
    res.json({ success: true, ...state });
  } catch (error: unknown) {
    const apiError = toApiError(error);
    res.status(apiError.statusCode).json({
      success: false,
      code: apiError.code,
      error: apiError.message,
      meta: apiError.meta,
    });
  }
});

router.post('/schema', async (req: Request, res: Response): Promise<void> => {
  try {
    const input = structuredSchemaRequestSchema.parse(req.body);

    if (input.action === 'create') {
      const idempotencyKey = getIdempotencyKey(req, input.idempotencyKey);
      if (idempotencyKey) {
        const cached = idempotencyStore.get('api:create', idempotencyKey);
        if (cached) {
          res.json(cached);
          return;
        }
      }

      const locale = localeFromText(String(input.description || input.schemaName));
      const response = await createSchemaStructured(
        {
          schemaName: input.schemaName,
          schemaType: input.schemaType,
          packageUId: input.packageUId,
          parentSchemaName: input.parentSchemaName,
          templateName: input.templateName,
          templateUId: input.templateUId,
          description: input.description,
          userLevelSchema: input.userLevelSchema,
        },
        locale,
      );

      const createResponse = withCreatioUrl(response, config.creatio.url);
      if (idempotencyKey) {
        idempotencyStore.set('api:create', idempotencyKey, createResponse);
      }
      res.json(createResponse);
      return;
    }

    const locale = localeFromText(String(input.description || input.parentSchemaName));
    const response = await extendSchemaStructured(
      {
        parentSchemaName: input.parentSchemaName,
        packageUId: input.packageUId,
        description: input.description,
        userLevelSchema: input.userLevelSchema,
      },
      locale,
    );

    res.json(withCreatioUrl(response, config.creatio.url));
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      const apiError = validationError(toValidationMessage(error));
      res.status(apiError.statusCode).json({
        success: false,
        code: apiError.code,
        error: apiError.message,
      });
      return;
    }

    const apiError = toApiError(error);
    res.status(apiError.statusCode).json({
      success: false,
      code: apiError.code,
      error: apiError.message,
      meta: apiError.meta,
    });
  }
});

router.get('/templates', async (req: Request, res: Response) => {
  try {
    const schemaType = String(req.query.schemaType || 'AngularSchema');
    const result = await listSchemaTemplates(schemaType);
    res.json(result);
  } catch (error: unknown) {
    const apiError = toApiError(error);
    res.status(apiError.statusCode).json({
      success: false,
      code: apiError.code,
      error: apiError.message,
      meta: apiError.meta,
    });
  }
});

router.get('/schema/health', async (_req: Request, res: Response) => {
  try {
    const { getCreatioClient } = await import('../creatio/creatioClient.js');
    const client = getCreatioClient();
    const schemaGateway = await getSchemaCreationGateway();

    const isConnected = client.isConnected();
    const hasConfig = !!(config.creatio.url && config.creatio.username && config.creatio.password);

    res.json({
      success: true,
      creatio_configured: hasConfig,
      creatio_url: config.creatio.url || 'not configured',
      authenticated: isConnected,
      schema_creation_gateway: schemaGateway.getSourceLabel(),
      langgraph: {
        enabled: true,
        endpoints: ['/agent/creatio', '/agent/creatio/stream', '/agent/creatio/state'],
      },
      message: hasConfig
        ? isConnected
          ? 'Creatio client authenticated'
          : 'Creatio client configured but not authenticated yet'
        : 'Creatio configuration missing (set CREATIO_URL, CREATIO_USERNAME, CREATIO_PASSWORD)',
    });
  } catch (error: unknown) {
    const apiError = toApiError(error);
    res.status(apiError.statusCode).json({
      success: false,
      code: apiError.code,
      error: apiError.message,
      meta: apiError.meta,
    });
  }
});

export default router;
