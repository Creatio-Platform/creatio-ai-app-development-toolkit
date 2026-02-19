import { getCreatioServer } from '../../mcp/creatioMcpServer.js';
import type {
  CreateSchemaArgs,
  CreateSchemaResult,
  ExtendSchemaArgs,
  ExtendSchemaResult,
  GetPackageUIdArgs,
  GetPackageUIdResult,
  GetSchemaInfoArgs,
  GetSchemaInfoResult,
  ListSchemaTemplatesResult,
  SchemaCreationGateway,
} from './types.js';

type ToolResponse = {
  content?: Array<{ type?: string; text?: string }>;
};

function parseToolResponse<T>(response: ToolResponse): T {
  const text = response.content?.[0]?.text;
  if (!text) {
    throw new Error('Empty tool response');
  }
  return JSON.parse(text) as T;
}

export class McpSchemaCreationGateway implements SchemaCreationGateway {
  private readonly server = getCreatioServer();

  getSourceLabel(): string {
    return 'mcp';
  }

  async getDesignPackageUId(args: GetPackageUIdArgs): Promise<GetPackageUIdResult> {
    return parseToolResponse<GetPackageUIdResult>(await this.server.getPackageUId(args));
  }

  async createSchema(args: CreateSchemaArgs): Promise<CreateSchemaResult> {
    return parseToolResponse<CreateSchemaResult>(await this.server.createSchema(args));
  }

  async extendSchema(args: ExtendSchemaArgs): Promise<ExtendSchemaResult> {
    return parseToolResponse<ExtendSchemaResult>(await this.server.extendSchemaMethod(args));
  }

  async getSchemaInfo(args: GetSchemaInfoArgs): Promise<GetSchemaInfoResult> {
    return parseToolResponse<GetSchemaInfoResult>(await this.server.getSchema(args));
  }

  async listSchemaTemplates(args: { schemaType?: string }): Promise<ListSchemaTemplatesResult> {
    return parseToolResponse<ListSchemaTemplatesResult>(await this.server.listTemplates(args));
  }
}
