import type { SchemaCreationGateway } from './types.js';
import { McpSchemaCreationGateway } from './mcpSchemaCreationGateway.js';

let gateway: SchemaCreationGateway | null = null;

export async function getSchemaCreationGateway(): Promise<SchemaCreationGateway> {
  if (!gateway) {
    gateway = new McpSchemaCreationGateway();
  }
  return gateway;
}
