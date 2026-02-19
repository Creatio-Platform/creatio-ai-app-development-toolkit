import { notFound, upstreamError } from '../domain/errors/apiError.js';
import { getSchemaCreationGateway } from '../integrations/schema-creation/gateway.js';
import type { TemplateRef } from '../integrations/schema-creation/types.js';

export type { TemplateRef };

export type SchemaLocale = 'uk' | 'en';

export type CreateSchemaInput = {
  schemaName: string;
  schemaType: string;
  userLevelSchema: boolean;
  template?: TemplateRef;
};

export type DirectCreateResult = {
  packageUId: string;
  schemaUId?: string;
  schemaName?: string;
  schemaType?: string | number;
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

export type StructuredGetInfoInput = {
  schemaName?: string;
  schemaUId?: string;
};

async function resolvePackageUId(userLevelSchema: boolean, packageUId?: string): Promise<string> {
  if (packageUId) {
    return packageUId;
  }

  const gateway = await getSchemaCreationGateway();
  const packageResult = await gateway.getDesignPackageUId({ userLevelSchema });
  if (!packageResult.success || !packageResult.packageUId) {
    throw upstreamError(packageResult.error || 'Failed to get design package UID');
  }

  return String(packageResult.packageUId);
}

async function resolveParentSchemaUId(parentSchemaName?: string): Promise<string | undefined> {
  if (!parentSchemaName) {
    return undefined;
  }

  const gateway = await getSchemaCreationGateway();
  const parentInfo = await gateway.getSchemaInfo({ schemaName: parentSchemaName });
  const parentSchemaUId = parentInfo?.schemaInfo?.schemaUId;
  if (!parentSchemaUId || typeof parentSchemaUId !== 'string') {
    throw notFound(`Parent schema not found: ${parentSchemaName}`);
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

function localizedInfoMessage(locale: SchemaLocale): string {
  return locale === 'uk' ? 'Інформацію про схему отримано' : 'Schema information loaded';
}

export async function createSchemaDirectly(input: CreateSchemaInput): Promise<DirectCreateResult> {
  const gateway = await getSchemaCreationGateway();
  const packageUId = await resolvePackageUId(input.userLevelSchema);

  const createResult = await gateway.createSchema({
    schemaType: input.schemaType,
    packageUId,
    customName: input.schemaName,
    userLevelSchema: input.userLevelSchema,
    templateName: input.template?.templateName,
    templateUId: input.template?.templateUId,
  });

  if (!createResult.success) {
    throw upstreamError(createResult.error || 'Failed to create schema');
  }

  return {
    packageUId,
    schemaUId: createResult.schemaUId,
    schemaName: createResult.schemaName,
    schemaType: createResult.schemaType,
    template: createResult.template || null,
  };
}

export async function listSchemaTemplates(schemaType: string): Promise<Record<string, unknown>> {
  const gateway = await getSchemaCreationGateway();
  const result = await gateway.listSchemaTemplates({ schemaType });
  if (!result.success) {
    throw upstreamError(result.error || 'Failed to load schema templates');
  }
  return result;
}

export async function createSchemaStructured(input: StructuredCreateInput, locale: SchemaLocale): Promise<Record<string, unknown>> {
  const gateway = await getSchemaCreationGateway();
  const userLevelSchema = input.userLevelSchema ?? false;
  const packageUId = await resolvePackageUId(userLevelSchema, input.packageUId);
  const parentSchemaUId = await resolveParentSchemaUId(input.parentSchemaName);

  const createResult = await gateway.createSchema({
    schemaType: String(input.schemaType),
    packageUId,
    customName: input.schemaName,
    parentSchemaUId,
    templateName: input.templateName,
    templateUId: input.templateUId,
    userLevelSchema,
  });

  if (!createResult.success) {
    throw upstreamError(createResult.error || 'Failed to create schema');
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

export async function extendSchemaStructured(input: StructuredExtendInput, locale: SchemaLocale): Promise<Record<string, unknown>> {
  const gateway = await getSchemaCreationGateway();
  const userLevelSchema = input.userLevelSchema ?? false;
  const packageUId = await resolvePackageUId(userLevelSchema, input.packageUId);
  const parentSchemaUId = await resolveParentSchemaUId(input.parentSchemaName);

  if (!parentSchemaUId) {
    throw notFound(`Parent schema not found: ${input.parentSchemaName}`);
  }

  const extendResult = await gateway.extendSchema({
    parentSchemaUId,
    packageUId,
    userLevelSchema,
  });

  if (!extendResult.success) {
    throw upstreamError(extendResult.error || 'Failed to extend schema');
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

export async function getSchemaInfoStructured(
  input: StructuredGetInfoInput,
  locale: SchemaLocale,
): Promise<Record<string, unknown>> {
  const gateway = await getSchemaCreationGateway();
  const schemaInfoResult = await gateway.getSchemaInfo({
    schemaName: input.schemaName,
    schemaUId: input.schemaUId,
  });

  if (!schemaInfoResult.success) {
    throw upstreamError(schemaInfoResult.error || 'Failed to load schema info');
  }

  if (!schemaInfoResult.schemaInfo) {
    throw notFound('Schema not found');
  }

  return {
    success: true,
    operation: 'get_info',
    message: localizedInfoMessage(locale),
    schemaInfo: schemaInfoResult.schemaInfo,
  };
}

export function withCreatioUrl(response: Record<string, unknown>, creatioUrl: string): Record<string, unknown> {
  if (!response.schemaUId || !creatioUrl) {
    return response;
  }

  return {
    ...response,
    creatio_url: `${creatioUrl}/0/ClientApp/#/PageDesigner/${response.schemaUId}`,
  };
}
