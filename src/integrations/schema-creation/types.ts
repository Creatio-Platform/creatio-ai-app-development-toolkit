export type TemplateRef = {
  templateName?: string;
  templateUId?: string;
};

export type SchemaTemplate = {
  uId: string;
  name: string;
  title?: string;
  groupName?: string;
  imageId?: string;
};

export type CreateSchemaArgs = {
  schemaType: string;
  packageUId: string;
  customName: string;
  parentSchemaUId?: string;
  templateName?: string;
  templateUId?: string;
  userLevelSchema: boolean;
};

export type CreateSchemaResult = {
  success: boolean;
  schemaUId?: string;
  schemaName?: string;
  schemaType?: string | number;
  parent?: string;
  template?: {
    uId?: string;
    name?: string;
    title?: string;
  } | null;
  error?: string;
};

export type ExtendSchemaArgs = {
  parentSchemaUId: string;
  packageUId: string;
  userLevelSchema: boolean;
};

export type ExtendSchemaResult = {
  success: boolean;
  schemaUId?: string;
  schemaName?: string;
  schemaType?: string | number;
  parentSchemaUId?: string;
  error?: string;
};

export type GetSchemaInfoArgs = {
  schemaUId?: string;
  schemaName?: string;
};

export type GetSchemaInfoResult = {
  success: boolean;
  schemaInfo?: Record<string, unknown>;
  error?: string;
};

export type GetPackageUIdArgs = {
  schemaUId?: string;
  userLevelSchema: boolean;
};

export type GetPackageUIdResult = {
  success: boolean;
  packageUId?: string;
  packageName?: string;
  error?: string;
};

export type ListSchemaTemplatesResult = {
  success: boolean;
  schemaType?: number;
  count?: number;
  templates?: SchemaTemplate[];
  error?: string;
};

export interface SchemaCreationGateway {
  getSourceLabel(): string;
  getDesignPackageUId(args: GetPackageUIdArgs): Promise<GetPackageUIdResult>;
  createSchema(args: CreateSchemaArgs): Promise<CreateSchemaResult>;
  extendSchema(args: ExtendSchemaArgs): Promise<ExtendSchemaResult>;
  getSchemaInfo(args: GetSchemaInfoArgs): Promise<GetSchemaInfoResult>;
  listSchemaTemplates(args: { schemaType?: string }): Promise<ListSchemaTemplatesResult>;
}
