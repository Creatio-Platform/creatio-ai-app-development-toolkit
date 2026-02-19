import { z } from 'zod';

export const schemaTypeSchema = z.enum(['AngularSchema', 'Module', 'EntitySchema']);

export const naturalCreatioRequestSchema = z
  .object({
    text: z.string().min(1).optional(),
    threadId: z.string().min(1).optional(),
    templateSelectionId: z.string().uuid().optional(),
    templateUId: z.string().uuid().optional(),
    templateName: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1).max(128).optional(),
  })
  .refine((input) => {
    const hasTemplateResume = (!!input.threadId || !!input.templateSelectionId)
      && (!!input.templateUId || !!input.templateName);
    return !!input.text || !!input.templateSelectionId || hasTemplateResume;
  }, {
    message: 'Provide text, templateSelectionId, or threadId + template selection',
  });

export const structuredCreateRequestSchema = z.object({
  action: z.literal('create'),
  schemaName: z.string().min(1),
  schemaType: z.string().min(1),
  idempotencyKey: z.string().min(1).max(128).optional(),
  packageUId: z.string().uuid().optional(),
  parentSchemaName: z.string().min(1).optional(),
  templateName: z.string().min(1).optional(),
  templateUId: z.string().uuid().optional(),
  description: z.string().optional(),
  userLevelSchema: z.boolean().optional(),
});

export const structuredExtendRequestSchema = z.object({
  action: z.literal('extend'),
  parentSchemaName: z.string().min(1),
  packageUId: z.string().uuid().optional(),
  description: z.string().optional(),
  userLevelSchema: z.boolean().optional(),
});

export const structuredSchemaRequestSchema = z.discriminatedUnion('action', [
  structuredCreateRequestSchema,
  structuredExtendRequestSchema,
]);

export const agentOperationSchema = z.enum([
  'create_schema',
  'extend_schema',
  'get_info',
  'not_supported',
  'awaiting_template_selection',
]);

export type NaturalCreatioRequest = z.infer<typeof naturalCreatioRequestSchema>;
export type StructuredSchemaRequest = z.infer<typeof structuredSchemaRequestSchema>;
