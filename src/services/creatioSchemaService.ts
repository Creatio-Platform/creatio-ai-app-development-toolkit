import { getCreatioServer } from '../mcp/creatioMcpServer.js';

type ToolResponse = {
  content?: Array<{ type?: string; text?: string }>;
};

export type TemplateRef = {
  templateName?: string;
  templateUId?: string;
};

export type SchemaLocale = 'uk' | 'en';

export type CreateSchemaInput = {
  schemaName: string;
  schemaType: string;
  userLevelSchema: boolean;
  template?: TemplateRef;
};

export type DirectCreateResult = Record<string, any> & {
  packageUId: string;
  schemaUId?: string;
  schemaName?: string;
  template?: {
    uId?: string;
    name?: string;
    title?: string;
  } | null;
};

export type StructuredCreateInput = {
  schemaName: string;
  schemaType: string;
  packageUId?: string;
  parentSchemaName?: string;
  templateName?: string;
  templateUId?: string;
  description?: string;
  userLevelSchema?: boolean;
};

export type StructuredExtendInput = {
  parentSchemaName: string;
  packageUId?: string;
  description?: string;
  userLevelSchema?: boolean;
};

function parseToolResponse(response: ToolResponse): Record<string, any> {
  const text = response.content?.[0]?.text;
  if (!text) {
    throw new Error('Empty tool response');
  }
  return JSON.parse(text);
}

async function resolvePackageUId(userLevelSchema: boolean, packageUId?: string): Promise<string> {
  if (packageUId) {
    return packageUId;
  }

  const server = getCreatioServer();
  const packageResult = parseToolResponse(await server.getPackageUId({ userLevelSchema }));
  if (!packageResult.success || !packageResult.packageUId) {
    throw new Error(packageResult.error || 'Failed to get design package UID');
  }

  return String(packageResult.packageUId);
}

async function resolveParentSchemaUId(parentSchemaName?: string): Promise<string | undefined> {
  if (!parentSchemaName) {
    return undefined;
  }

  const server = getCreatioServer();
  const parentInfo = parseToolResponse(await server.getSchema({ schemaName: parentSchemaName }));
  const parentSchemaUId = parentInfo?.schemaInfo?.schemaUId;
  if (!parentSchemaUId) {
    throw new Error(`Parent schema not found: ${parentSchemaName}`);
  }

  return parentSchemaUId;
}

function localizedCreateMessage(locale: SchemaLocale, schemaName?: string): string {
  return locale === 'uk'
    ? `Створено схему ${schemaName}`
    : `Schema ${schemaName} has been created`;
}

function localizedExtendMessage(locale: SchemaLocale, parentSchemaName: string): string {
  return locale === 'uk'
    ? `Схему ${parentSchemaName} розширено`
    : `Schema ${parentSchemaName} has been extended`;
}

export async function createSchemaDirectly(input: CreateSchemaInput): Promise<DirectCreateResult> {
  const server = getCreatioServer();
  const packageUId = await resolvePackageUId(input.userLevelSchema);

  const createResult = parseToolResponse(
    await server.createSchema({
      schemaType: input.schemaType,
      packageUId,
      customName: input.schemaName,
      userLevelSchema: input.userLevelSchema,
      templateName: input.template?.templateName,
      templateUId: input.template?.templateUId,
    }),
  );

  if (!createResult.success) {
    throw new Error(createResult.error || 'Failed to create schema');
  }

  return {
    ...createResult,
    packageUId,
  } as DirectCreateResult;
}

export async function listSchemaTemplates(schemaType: string): Promise<Record<string, any>> {
  const server = getCreatioServer();
  const result = parseToolResponse(await server.listTemplates({ schemaType }));
  if (!result.success) {
    throw new Error(result.error || 'Failed to load schema templates');
  }
  return result;
}

export async function createSchemaStructured(input: StructuredCreateInput, locale: SchemaLocale): Promise<Record<string, any>> {
  const server = getCreatioServer();
  const userLevelSchema = input.userLevelSchema ?? false;
  const packageUId = await resolvePackageUId(userLevelSchema, input.packageUId);
  const parentSchemaUId = await resolveParentSchemaUId(input.parentSchemaName);

  const createResult = parseToolResponse(
    await server.createSchema({
      schemaType: String(input.schemaType),
      packageUId,
      customName: input.schemaName,
      parentSchemaUId,
      templateName: input.templateName,
      templateUId: input.templateUId,
      userLevelSchema,
    }),
  );

  if (!createResult.success) {
    throw new Error(createResult.error || 'Failed to create schema');
  }

  return {
    success: true,
    operation: 'create_schema',
    message: localizedCreateMessage(locale, createResult.schemaName),
    schemaUId: createResult.schemaUId,
    schemaName: createResult.schemaName,
    schemaType: String(input.schemaType),
    packageUId,
    parentSchemaUId: parentSchemaUId || null,
    template: createResult.template || null,
    description: input.description || null,
  };
}

export async function extendSchemaStructured(input: StructuredExtendInput, locale: SchemaLocale): Promise<Record<string, any>> {
  const server = getCreatioServer();
  const userLevelSchema = input.userLevelSchema ?? false;
  const packageUId = await resolvePackageUId(userLevelSchema, input.packageUId);
  const parentSchemaUId = await resolveParentSchemaUId(input.parentSchemaName);

  if (!parentSchemaUId) {
    throw new Error(`Parent schema not found: ${input.parentSchemaName}`);
  }

  const extendResult = parseToolResponse(
    await server.extendSchemaMethod({
      parentSchemaUId,
      packageUId,
      userLevelSchema,
    }),
  );

  if (!extendResult.success) {
    throw new Error(extendResult.error || 'Failed to extend schema');
  }

  return {
    success: true,
    operation: 'extend_schema',
    message: localizedExtendMessage(locale, input.parentSchemaName),
    schemaUId: extendResult.schemaUId,
    schemaName: extendResult.schemaName,
    schemaType: extendResult.schemaType,
    packageUId,
    parentSchemaUId,
    description: input.description || null,
  };
}

export function withCreatioUrl(response: Record<string, any>, creatioUrl: string): Record<string, any> {
  if (!response.schemaUId || !creatioUrl) {
    return response;
  }

  return {
    ...response,
    creatio_url: `${creatioUrl}/0/ClientApp/#/PageDesigner/${response.schemaUId}`,
  };
}

