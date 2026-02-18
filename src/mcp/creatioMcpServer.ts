import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { getCreatioClient } from '../creatio/creatioClient.js';

/**
 * Schema type mapping: string names to Creatio numeric codes
 */
const SCHEMA_TYPE_MAP: Record<string, number> = {
  AngularSchema: 9,
  Module: 3,
  EntitySchema: 0,
  BusinessProcess: 13,
  SourceCodeSchema: 6,
};

/**
 * Convert schema type string to numeric code
 */
function getSchemaTypeCode(schemaType: string | number): number {
  if (typeof schemaType === 'number') {
    return schemaType;
  }
  const code = SCHEMA_TYPE_MAP[schemaType];
  if (code === undefined) {
    throw new Error(`Unknown schema type: ${schemaType}. Valid types: ${Object.keys(SCHEMA_TYPE_MAP).join(', ')}`);
  }
  return code;
}

/**
 * MCP Server for Creatio schema operations
 * Implements factory pattern for ClientUnitSchema creation
 */
export class CreatioMCPServer {
  private server: Server;
  private client = getCreatioClient();

  constructor() {
    this.server = new Server(
      {
        name: 'creatio-schema-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) =>
      this.handleToolCall(request.params.name, request.params.arguments),
    );
  }

  private getTools(): Tool[] {
    return [
      {
        name: 'create_new_schema',
        description:
          'Create a new ClientUnitSchema using factory pattern. Automatically generates unique name with Usr prefix, applies parent if specified, and initializes schema body. Returns schemaUId and schemaName.',
        inputSchema: {
          type: 'object',
          properties: {
            schemaType: {
              type: 'string',
              description: 'Schema type: AngularSchema (Page), Module, EntitySchema, etc.',
            },
            packageUId: {
              type: 'string',
              description: 'Package GUID where schema will be created',
            },
            parentSchemaUId: {
              type: 'string',
              description: 'Optional parent schema GUID for inheritance',
            },
            userLevelSchema: {
              type: 'boolean',
              description: 'User-level (true) or system-level (false) schema. Default: false',
              default: false,
            },
          },
          required: ['schemaType', 'packageUId'],
        },
      },
      {
        name: 'extend_schema',
        description:
          'Extend an existing schema by creating a child schema with inheritance. Preserves parent name and applies factory initialization. Used for customizing existing pages/modules.',
        inputSchema: {
          type: 'object',
          properties: {
            parentSchemaUId: {
              type: 'string',
              description: 'Parent schema GUID to extend from',
            },
            packageUId: {
              type: 'string',
              description: 'Package GUID for new schema',
            },
            userLevelSchema: {
              type: 'boolean',
              description: 'User-level (true) or system-level (false) schema. Default: false',
              default: false,
            },
          },
          required: ['parentSchemaUId', 'packageUId'],
        },
      },
      {
        name: 'get_schema_info',
        description:
          'Get detailed information about a schema by its GUID or name. Returns schema metadata including type, package, parent, and body structure.',
        inputSchema: {
          type: 'object',
          properties: {
            schemaUId: {
              type: 'string',
              description: 'Schema GUID (use either schemaUId or schemaName)',
            },
            schemaName: {
              type: 'string',
              description: 'Schema name (use either schemaUId or schemaName)',
            },
          },
        },
      },
      {
        name: 'list_available_parents',
        description:
          'List all schemas that can be used as parents for inheritance. Filtered by package and schema type. Useful for finding base schemas to extend.',
        inputSchema: {
          type: 'object',
          properties: {
            packageUId: {
              type: 'string',
              description: 'Package GUID to search in',
            },
            schemaType: {
              type: 'string',
              description: 'Filter by schema type (AngularSchema, Module, etc.)',
            },
            allowExtended: {
              type: 'boolean',
              description: 'Include already extended schemas. Default: true',
              default: true,
            },
          },
          required: ['packageUId', 'schemaType'],
        },
      },
      {
        name: 'get_design_package_uid',
        description:
          'Get the design package GUID where new schemas should be created. This determines the target package for schema creation based on existing schema or returns the default design package.',
        inputSchema: {
          type: 'object',
          properties: {
            schemaUId: {
              type: 'string',
              description: 'Optional: Existing schema GUID to determine its package',
            },
            userLevelSchema: {
              type: 'boolean',
              description: 'User-level (true) or system-level (false) schema. Default: false',
              default: false,
            },
          },
        },
      },
      {
        name: 'validate_schema_name',
        description:
          'Check if a schema name is available (not already used). Returns availability status. Use before creating schemas to avoid conflicts.',
        inputSchema: {
          type: 'object',
          properties: {
            schemaName: {
              type: 'string',
              description: 'Schema name to validate',
            },
          },
          required: ['schemaName'],
        },
      },
    ];
  }

  private async handleToolCall(name: string, args: any): Promise<any> {
    try {
      switch (name) {
        case 'create_new_schema':
          return await this.createNewSchema(args);
        case 'extend_schema':
          return await this.extendSchema(args);
        case 'get_schema_info':
          return await this.getSchemaInfo(args);
        case 'list_available_parents':
          return await this.listAvailableParents(args);
        case 'get_design_package_uid':
          return await this.getDesignPackageUId(args);
        case 'validate_schema_name':
          return await this.validateSchemaName(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
            }),
          },
        ],
      };
    }
  }

  /**
   * Factory method: Create new schema with auto-naming and initialization
   */
  private async createNewSchema(args: any) {
    const { schemaType, packageUId, parentSchemaUId, userLevelSchema = false } = args;

    // Convert schema type string to numeric code
    const schemaTypeCode = getSchemaTypeCode(schemaType);

    // Step 1: Create schema via API using CreateNewSchema (correct method name)
    const createResponse = await this.client.post('CreateNewSchema', {
      packageUId,
      schemaType: schemaTypeCode,
      userLevelSchema,
    });

    let schema = createResponse.schema;

    // Step 2: Apply parent if specified
    if (parentSchemaUId) {
      const applyParentResponse = await this.client.post('ApplyParent', {
        newParentUid: parentSchemaUId,
        clientUnitSchema: schema,
        userLevelSchema,
      });
      schema = applyParentResponse.schema;
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            schemaUId: schema.uId,
            schemaName: schema.name,
            schemaType: schema.schemaType,
            parent: schema.parent?.uId,
          }),
        },
      ],
    };
  }

  /**
   * Factory method: Extend existing schema
   */
  private async extendSchema(args: any) {
    const { parentSchemaUId, packageUId, userLevelSchema = false } = args;

    // Get parent schema info first
    const parentInfo = await this.client.post('GetSchemaInfo', {
      schemaUId: parentSchemaUId,
    });

    const parentSchema = parentInfo.schemaInfo;

    // Create new schema with CreateNewSchema
    const createResponse = await this.client.post('CreateNewSchema', {
      packageUId,
      schemaType: parentSchema.schemaType,
      userLevelSchema,
    });

    let schema = createResponse.schema;
    schema.extendParent = true;

    // Apply parent
    const newParentUid = parentSchema.extendParent ? parentSchema.parent?.uId : parentSchema.uId;
    const applyResponse = await this.client.post('ApplyParent', {
      newParentUid,
      clientUnitSchema: schema,
      userLevelSchema,
    });

    schema = applyResponse.schema;
    schema.extendParent = true;
    schema.name = parentSchema.name;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            schemaUId: schema.uId,
            schemaName: schema.name,
            schemaType: schema.schemaType,
            parentSchemaUId: newParentUid,
          }),
        },
      ],
    };
  }

  /**
   * Get schema information by GUID or name
   */
  private async getSchemaInfo(args: any) {
    const { schemaUId, schemaName } = args;

    let response;
    if (schemaUId) {
      response = await this.client.post('GetSchemaInfo', { schemaUId });
    } else if (schemaName) {
      response = await this.client.post('GetSchemaInfoByName', { schemaName });
    } else {
      throw new Error('Either schemaUId or schemaName must be provided');
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            schemaInfo: response.schemaInfo,
          }),
        },
      ],
    };
  }

  /**
   * List available parent schemas
   */
  private async listAvailableParents(args: any) {
    const { packageUId, schemaType, allowExtended = true } = args;

    const response = await this.client.post('GetAvailableParentSchemas', {
      packageUId,
      schemaType,
      allowExtended,
      useFullHierarchy: true,
      userLevelSchema: false,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            parents: response.items || [],
            count: response.items?.length || 0,
          }),
        },
      ],
    };
  }

  /**
   * Validate if schema name is available
   */
  private async validateSchemaName(args: any) {
    const { schemaName } = args;

    try {
      const response = await this.client.post('GetSchemaInfoByName', { schemaName });

      // If schema exists, name is not available
      const available = !response.schemaInfo;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              schemaName,
              available,
              message: available ? 'Schema name is available' : 'Schema name already exists',
            }),
          },
        ],
      };
    } catch (error) {
      // If error (schema not found), name is available
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              schemaName,
              available: true,
              message: 'Schema name is available',
            }),
          },
        ],
      };
    }
  }

  /**
   * Get design package GUID for schema creation
   */
  private async getDesignPackageUId(args: any) {
    const { schemaUId, userLevelSchema = false } = args;

    try {
      // Use full URL with /0/ prefix - ApplicationPackagesService needs this
      const response = await this.client.post(
        '/0/ServiceModel/ApplicationPackagesService.svc/GetDesignPackageUId',
        {
          schemaUId,
          userLevelSchema,
        },
      );

      // Response format: { success: boolean, uId: string, name: string | null, errorInfo: any }
      const packageUId = response?.uId;

      if (!packageUId || !response?.success) {
        throw new Error(response?.errorInfo?.message || 'No package GUID returned from Creatio');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              packageUId: packageUId,
              packageName: response.name,
              message: 'Design package retrieved successfully',
            }),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
              message: 'Failed to get design package',
            }),
          },
        ],
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Creatio MCP server running on stdio');
  }

  // Public methods for direct invocation (in-process)
  public async createSchema(args: any) {
    return this.createNewSchema(args);
  }

  public async extendSchemaMethod(args: any) {
    return this.extendSchema(args);
  }

  public async getSchema(args: any) {
    return this.getSchemaInfo(args);
  }

  public async listParents(args: any) {
    return this.listAvailableParents(args);
  }

  public async getPackageUId(args: any) {
    return this.getDesignPackageUId(args);
  }

  public async validateName(args: any) {
    return this.validateSchemaName(args);
  }
}

// Singleton instance
let creatioServerInstance: CreatioMCPServer | null = null;

export function getCreatioServer(): CreatioMCPServer {
  if (!creatioServerInstance) {
    creatioServerInstance = new CreatioMCPServer();
  }
  return creatioServerInstance;
}
