import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { config } from '../config/env.js';

const intentSchema = z.object({
  operation: z.enum(['create_schema', 'extend_schema', 'get_info', 'not_supported', 'unknown']),
  schemaName: z.string().nullable(),
  schemaType: z.enum(['AngularSchema', 'Module', 'EntitySchema']).nullable(),
  parentSchemaName: z.string().nullable(),
  templateName: z.string().nullable(),
  templateUId: z.string().nullable(),
  userLevelSchema: z.boolean().nullable(),
  language: z.enum(['uk', 'en']),
});

export type ParsedCreatioIntent = z.infer<typeof intentSchema>;

export async function parseCreatioIntent(text: string): Promise<ParsedCreatioIntent> {
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const model = new ChatOpenAI({
    apiKey: config.openaiApiKey,
    model: 'gpt-4o-mini',
    temperature: 0,
  });

  const parser = model.withStructuredOutput(intentSchema);

  const result = await parser.invoke([
    {
      role: 'system',
      content: `You parse user intent for Creatio schema operations.
Return strict JSON using the schema.

Rules:
- operation=create_schema only when user asks to create/make/build a new schema/page/module/entity.
- operation=extend_schema only when user asks to extend/inherit existing schema.
- operation=get_info only when user asks to inspect/read schema info.
- operation=not_supported for delete/modify code/deploy/compile requests.
- schemaName: desired name for the new schema if provided.
- schemaType mapping: page/сторінка -> AngularSchema, module/модуль -> Module, entity/сутність -> EntitySchema.
- templateName/templateUId: extract only if user explicitly mentions template selection.
- language: uk for Ukrainian, en otherwise.
- If a field is unknown, set it to null.`,
    },
    {
      role: 'user',
      content: text,
    },
  ]);

  return result;
}
