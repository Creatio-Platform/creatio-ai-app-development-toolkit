import { randomUUID } from 'crypto';
import {
  Command,
  END,
  interrupt,
  isInterrupted,
  MemorySaver,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { config } from '../../config/env.js';
import { badRequest } from '../../domain/errors/apiError.js';
import {
  createSchemaDirectly,
  extendSchemaStructured,
  getSchemaInfoStructured,
  listSchemaTemplates,
  withCreatioUrl,
} from '../../services/creatioSchemaService.js';
import { parseCreatioIntent } from '../../agent/creatioIntentParser.js';
import { CreatioGraphState, type CreatioGraphResponse, type CreatioGraphStateType } from './state.js';

type TemplateResumePayload = {
  templateUId?: string;
  templateName?: string;
};

type CreateTemplateInterrupt = {
  type: 'template_selection';
  message: string;
  schemaName: string;
  schemaType: string;
  templates: Array<Record<string, unknown>>;
};

const checkpointer = new MemorySaver();

function localizedCreateMessage(language: 'uk' | 'en', schemaName?: string): string {
  return language === 'uk'
    ? `Створено схему ${schemaName}`
    : `Schema ${schemaName} has been created`;
}

function localizeNotSupported(language: 'uk' | 'en'): string {
  return language === 'uk'
    ? 'Операція ще не підтримується. Доступні: створення, розширення і перегляд схем.'
    : 'Operation is not supported yet. Supported operations: create, extend and inspect schema.';
}

const parseIntentNode = async (state: CreatioGraphStateType) => {
  const text = state.text?.trim();
  if (!text) {
    throw badRequest('Text is required for run step');
  }

  const intent = await parseCreatioIntent(text);
  return {
    intent,
    operation: intent.operation,
    language: intent.language,
    schemaName: intent.schemaName,
    schemaType: intent.schemaType || 'AngularSchema',
    parentSchemaName: intent.parentSchemaName,
    userLevelSchema: intent.userLevelSchema ?? false,
    templateUId: intent.templateUId,
    templateName: intent.templateName,
  };
};

const unsupportedNode = async (state: CreatioGraphStateType) => ({
  finalResponse: {
    success: false,
    operation: 'not_supported',
    message: localizeNotSupported(state.language),
  } satisfies CreatioGraphResponse,
});

const ensureTemplateNode = async (state: CreatioGraphStateType) => {
  if (!state.schemaName) {
    throw badRequest(state.language === 'uk' ? 'Вкажіть назву схеми для створення.' : 'Provide schema name to create.');
  }

  if (state.templateUId || state.templateName) {
    return {};
  }

  const templatesResult = await listSchemaTemplates(state.schemaType || 'AngularSchema');
  const templates = Array.isArray(templatesResult.templates)
    ? templatesResult.templates as Array<Record<string, unknown>>
    : [];

  if (templates.length === 0) {
    throw badRequest('No templates available for selected schema type');
  }

  const selection = interrupt<CreateTemplateInterrupt, TemplateResumePayload>({
    type: 'template_selection',
    message: state.language === 'uk' ? 'Оберіть шаблон для нової сторінки.' : 'Choose a template for the new page.',
    schemaName: state.schemaName,
    schemaType: state.schemaType || 'AngularSchema',
    templates,
  });

  if (!selection?.templateUId && !selection?.templateName) {
    throw badRequest(state.language === 'uk' ? 'Оберіть шаблон зі списку.' : 'Please choose one of the listed templates.');
  }

  return {
    templateUId: selection.templateUId || null,
    templateName: selection.templateName || null,
    templateOptions: templates,
  };
};

const createSchemaNode = async (state: CreatioGraphStateType) => {
  if (!state.schemaName) {
    throw badRequest(state.language === 'uk' ? 'Вкажіть назву схеми для створення.' : 'Provide schema name to create.');
  }

  const created = await createSchemaDirectly({
    schemaName: state.schemaName,
    schemaType: state.schemaType || 'AngularSchema',
    userLevelSchema: state.userLevelSchema,
    template: {
      templateName: state.templateName || undefined,
      templateUId: state.templateUId || undefined,
    },
  });

  return {
    finalResponse: withCreatioUrl(
      {
        success: true,
        operation: 'create_schema',
        message: localizedCreateMessage(state.language, created.schemaName),
        schemaUId: created.schemaUId,
        schemaName: created.schemaName,
        schemaType: state.schemaType || 'AngularSchema',
        packageUId: created.packageUId,
        template: created.template || null,
      },
      config.creatio.url,
    ),
  };
};

const extendSchemaNode = async (state: CreatioGraphStateType) => {
  if (!state.parentSchemaName) {
    throw badRequest(
      state.language === 'uk' ? 'Вкажіть батьківську схему для розширення.' : 'Provide parent schema to extend.',
    );
  }

  const response = await extendSchemaStructured(
    {
      parentSchemaName: state.parentSchemaName,
      userLevelSchema: state.userLevelSchema,
    },
    state.language,
  );

  return {
    finalResponse: withCreatioUrl(response, config.creatio.url),
  };
};

const getInfoNode = async (state: CreatioGraphStateType) => {
  const response = await getSchemaInfoStructured(
    {
      schemaName: state.schemaName || state.parentSchemaName || undefined,
    },
    state.language,
  );

  return {
    finalResponse: response,
  };
};

const routeAfterIntent = (state: CreatioGraphStateType) => {
  if (state.operation === 'create_schema') {
    return 'ensure_template';
  }
  if (state.operation === 'extend_schema') {
    return 'extend_schema';
  }
  if (state.operation === 'get_info') {
    return 'get_info';
  }
  return 'not_supported';
};

const graph = new StateGraph(CreatioGraphState)
  .addNode('parse_intent', parseIntentNode)
  .addNode('ensure_template', ensureTemplateNode)
  .addNode('create_schema', createSchemaNode)
  .addNode('extend_schema', extendSchemaNode)
  .addNode('get_info', getInfoNode)
  .addNode('not_supported', unsupportedNode)
  .addEdge(START, 'parse_intent')
  .addConditionalEdges('parse_intent', routeAfterIntent)
  .addEdge('ensure_template', 'create_schema')
  .addEdge('create_schema', END)
  .addEdge('extend_schema', END)
  .addEdge('get_info', END)
  .addEdge('not_supported', END)
  .compile({
    checkpointer,
    name: 'creatio-schema-agent-graph',
    description: 'Creatio schema agent runtime with interrupt-based template selection and checkpointed threads.',
  });

function threadConfig(threadId: string) {
  return { configurable: { thread_id: threadId } };
}

function buildInterruptedResponse(threadId: string, interrupted: unknown) {
  const items = Array.isArray(interrupted) ? interrupted : [];
  const firstInterrupt = items[0]?.value as CreateTemplateInterrupt | undefined;
  if (!firstInterrupt || firstInterrupt.type !== 'template_selection') {
    return {
      success: false,
      operation: 'not_supported',
      threadId,
      message: 'Agent execution interrupted',
    };
  }

  return {
    success: true,
    operation: 'awaiting_template_selection',
    message: firstInterrupt.message,
    selectionId: threadId,
    threadId,
    schemaName: firstInterrupt.schemaName,
    schemaType: firstInterrupt.schemaType,
    templates: firstInterrupt.templates,
  };
}

function buildCompletedResponse(threadId: string, state: CreatioGraphStateType) {
  return {
    ...(state.finalResponse || {
      success: false,
      operation: 'not_supported',
      message: 'Agent did not produce a final response',
    }),
    threadId,
  };
}

export async function runCreatioGraph(input: { text: string; threadId?: string }): Promise<Record<string, unknown>> {
  const threadId = input.threadId || randomUUID();
  const result = await graph.invoke(
    {
      text: input.text,
    },
    threadConfig(threadId),
  );

  if (isInterrupted(result)) {
    return buildInterruptedResponse(threadId, result.__interrupt__);
  }

  return buildCompletedResponse(threadId, result as CreatioGraphStateType);
}

export async function resumeCreatioGraph(input: {
  threadId: string;
  templateUId?: string;
  templateName?: string;
}): Promise<Record<string, unknown>> {
  const result = await graph.invoke(
    new Command({
      resume: {
        templateUId: input.templateUId,
        templateName: input.templateName,
      },
    }) as any,
    threadConfig(input.threadId),
  );

  if (isInterrupted(result)) {
    return buildInterruptedResponse(input.threadId, result.__interrupt__);
  }

  return buildCompletedResponse(input.threadId, result as CreatioGraphStateType);
}

export async function getCreatioGraphState(threadId: string): Promise<Record<string, unknown>> {
  const snapshot = await graph.getState(threadConfig(threadId));
  return {
    threadId,
    next: snapshot.next,
    values: snapshot.values,
    tasks: snapshot.tasks,
    createdAt: snapshot.createdAt,
  };
}

export async function streamCreatioGraph(input: {
  threadId: string;
  text?: string;
  resume?: TemplateResumePayload;
}): Promise<any> {
  const graphInput = input.resume
    ? new Command({ resume: input.resume }) as any
    : { text: input.text || '' };

  return graph.stream(graphInput, {
    ...threadConfig(input.threadId),
    streamMode: ['updates', 'messages', 'tasks', 'checkpoints'],
  });
}
