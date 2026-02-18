import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { getCreatioClient } from '../creatio/creatioClient.js';
import { NameGenerator } from '../tools/nameGenerator.js';

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
  if (/^\d+$/.test(schemaType)) {
    return Number(schemaType);
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
          'Create a new ClientUnitSchema with custom name. Adds Usr prefix to customName and can apply selected page template. Returns schemaUId and schemaName.',
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
            customName: {
              type: 'string',
              description: 'Desired schema name (Usr prefix will be added). Example: "AccountPage" becomes "UsrAccountPage"',
            },
            parentSchemaUId: {
              type: 'string',
              description: 'Optional parent schema GUID for inheritance',
            },
            templateUId: {
              type: 'string',
              description: 'Optional page template GUID from schema.template.api (used when creating pages)',
            },
            templateName: {
              type: 'string',
              description: 'Optional page template name/title from schema.template.api (e.g., BlankPageTemplate)',
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
      {
        name: 'list_schema_templates',
        description:
          'List available schema templates from schema.template.api. Use schemaType 9 (AngularSchema) for page templates.',
        inputSchema: {
          type: 'object',
          properties: {
            schemaType: {
              type: 'string',
              description: 'Schema type: AngularSchema, Module, EntitySchema, etc. Default: AngularSchema',
            },
          },
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
        case 'list_schema_templates':
          return await this.listSchemaTemplates(args);
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
   * Generate default schema body code for ClientUnitSchema
   */
  private generateSchemaBody(schemaName: string): string {
    return `define("${schemaName}", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, function/**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/ {
\treturn {
\t\tviewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[]/**SCHEMA_VIEW_CONFIG_DIFF*/,
\t\tviewModelConfigDiff: /**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/[]/**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/,
\t\tmodelConfigDiff: /**SCHEMA_MODEL_CONFIG_DIFF*/[
\t\t\t{
\t\t\t\t"operation": "merge",
\t\t\t\t"path": [],
\t\t\t\t"values": {
\t\t\t\t\t"dataSources": {}
\t\t\t\t}
\t\t\t}
\t\t]/**SCHEMA_MODEL_CONFIG_DIFF*/,
\t\thandlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
\t\tconverters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/,
\t\tvalidators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/
\t};
});`;
  }

  /**
   * Factory method: Create new schema with auto-naming and initialization
   */
  private async createNewSchema(args: any) {
    const { schemaType, packageUId, parentSchemaUId, customName, templateUId, templateName, userLevelSchema = false } = args;

    console.log('[createNewSchema] Starting schema creation...');
    console.log('[createNewSchema] Args:', JSON.stringify(args, null, 2));

    // Convert schema type string to numeric code
    const schemaTypeCode = getSchemaTypeCode(schemaType);
    console.log('[createNewSchema] Schema type code:', schemaTypeCode);

    // Step 1: Create schema via API using CreateNewSchema (correct method name)
    console.log('[createNewSchema] Calling CreateNewSchema API...');
    const createResponse = await this.client.post('CreateNewSchema', {
      packageUId,
      schemaType: schemaTypeCode,
      userLevelSchema,
    });
    console.log('[createNewSchema] CreateNewSchema response:', JSON.stringify(createResponse, null, 2));

    let schema = createResponse.schema;
    console.log('[createNewSchema] Schema created with auto name:', schema?.name, schema?.uId);

    // Step 2: Resolve template selection into parent schema UID (if provided)
    let resolvedParentSchemaUId = parentSchemaUId;
    let selectedTemplate: any = null;

    if (!resolvedParentSchemaUId && (templateUId || templateName)) {
      const templatesResponse = await this.client.get('/0/rest/schema.template.api/templates', {
        schemaType: schemaTypeCode,
      });
      const templates = templatesResponse?.items || [];

      selectedTemplate = templates.find((tpl: any) =>
        (templateUId && String(tpl.uId).toLowerCase() === String(templateUId).toLowerCase()) ||
        (templateName && String(tpl.name).toLowerCase() === String(templateName).toLowerCase()) ||
        (templateName && String(tpl.title).toLowerCase() === String(templateName).toLowerCase()),
      );

      if (!selectedTemplate) {
        throw new Error(`Template not found: ${templateName || templateUId}`);
      }

      resolvedParentSchemaUId = selectedTemplate.uId;
      console.log('[createNewSchema] Template selected:', selectedTemplate);
    }

    // Step 3: Apply parent/template if specified
    if (resolvedParentSchemaUId) {
      const applyParentResponse = await this.client.post('ApplyParent', {
        newParentUid: resolvedParentSchemaUId,
        clientUnitSchema: schema,
        userLevelSchema,
      });
      schema = applyParentResponse.schema;
      console.log('[createNewSchema] Parent applied');
    }

    // Step 4: Generate custom name if provided (just add Usr prefix, no unique suffix)
    if (customName) {
      const schemaName = NameGenerator.generate(customName, 'Usr', false);
      console.log('[createNewSchema] Using custom name:', schemaName);
      schema.name = schemaName;
    }

    // Step 5: Generate schema body code (required for SaveSchema)
    console.log('[createNewSchema] Generating body...');
    schema.body = this.generateSchemaBody(schema.name);
    
    // Add caption with custom name
    const displayName = customName || schema.name;
    schema.caption = [{ cultureName: 'en-US', value: `${displayName} Auto-generated` }];
    console.log('[createNewSchema] Body and caption set, preparing to save...');

    // Step 6: Save schema to persist it in database with new name
    console.log('[createNewSchema] Calling SaveSchema...');
    console.log('[createNewSchema] Schema to save:', JSON.stringify({
      uId: schema.uId,
      name: schema.name,
      schemaType: schema.schemaType,
      packageUId: schema.packageUId,
      hasBody: !!schema.body,
      bodyLength: schema.body?.length
    }, null, 2));
    // SaveSchema expects the schema object directly, not wrapped
    const saveResponse = await this.client.post('SaveSchema', schema);
    console.log('[createNewSchema] SaveSchema response:', JSON.stringify(saveResponse, null, 2));
    
    // Check if save was successful
    if (!saveResponse.success) {
      throw new Error(`SaveSchema failed: ${saveResponse.errorInfo?.message || 'Unknown error'}`);
    }
    
    schema = saveResponse.schema || schema;
    console.log('[createNewSchema] Schema saved successfully with name:', schema.name);

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
            template: selectedTemplate
              ? {
                  uId: selectedTemplate.uId,
                  name: selectedTemplate.name,
                  title: selectedTemplate.title,
                }
              : null,
            saved: true,
            customName: customName || null,
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

    // Generate schema body and caption
    schema.body = this.generateSchemaBody(schema.name);
    schema.caption = [{ cultureName: 'en-US', value: `${schema.name} Extended` }];

    // Save schema to persist it
    // SaveSchema expects the schema object directly, not wrapped
    const saveResponse = await this.client.post('SaveSchema', schema);
    
    if (!saveResponse.success) {
      throw new Error(`SaveSchema failed: ${saveResponse.errorInfo?.message || 'Unknown error'}`);
    }
    
    schema = saveResponse.schema || schema;

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
            saved: true,
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

  /**
   * List available schema templates from schema.template.api
   */
  private async listSchemaTemplates(args: any) {
    const schemaTypeCode = getSchemaTypeCode(args?.schemaType ?? 'AngularSchema');
    const response = await this.client.get('/0/rest/schema.template.api/templates', {
      schemaType: schemaTypeCode,
    });

    const templates = (response?.items || []).map((item: any) => ({
      uId: item.uId,
      name: item.name,
      title: item.title,
      groupName: item.groupName,
      imageId: item.imageId,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            schemaType: schemaTypeCode,
            count: templates.length,
            templates,
          }),
        },
      ],
    };
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

  public async listTemplates(args: any) {
    return this.listSchemaTemplates(args);
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
