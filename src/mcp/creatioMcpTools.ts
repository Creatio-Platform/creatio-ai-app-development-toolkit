import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getCreatioServer } from './creatioMcpServer.js';

/**
 * LangChain tool for creating new Creatio schema
 */
export const createNewSchemaTool = () =>
  tool(
    async (args) => {
      try {
        const server = getCreatioServer();
        const result = await server.createSchema(args);
        return result.content[0].text;
      } catch (error: any) {
        return JSON.stringify({ success: false, error: error.message });
      }
    },
    {
      name: 'create_new_schema',
      description: `Create a new ClientUnitSchema in Creatio with custom name. 
Adds Usr prefix to customName parameter (e.g., "AccountPage" becomes "UsrAccountPage").
Returns: schemaUId, schemaName, schemaType, parent, customName.`,
      schema: z.object({
        schemaType: z.string().describe('Schema type: AngularSchema, Module, EntitySchema, etc.'),
        packageUId: z.string().describe('Package GUID where schema will be created'),
        customName: z.string().optional().describe('Desired schema name (Usr prefix will be added). Example: "AccountPage" becomes "UsrAccountPage"'),
        parentSchemaUId: z.string().optional().describe('Optional parent schema GUID for inheritance'),
        userLevelSchema: z.boolean().optional().describe('User-level (true) or system-level (false), default: false'),
      }),
    },
  );

/**
 * LangChain tool for extending existing Creatio schema
 */
export const extendSchemaTool = () =>
  tool(
    async (args) => {
      try {
        const server = getCreatioServer();
        const result = await server.extendSchemaMethod(args);
        return result.content[0].text;
      } catch (error: any) {
        return JSON.stringify({ success: false, error: error.message });
      }
    },
    {
      name: 'extend_schema',
      description: `Extend an existing Creatio schema by creating a child schema with inheritance.
Preserves parent name and applies factory initialization. Used for customizing existing pages/modules.
Returns: schemaUId, schemaName, schemaType, parentSchemaUId.`,
      schema: z.object({
        parentSchemaUId: z.string().describe('Parent schema GUID to extend from'),
        packageUId: z.string().describe('Package GUID for new schema'),
        userLevelSchema: z.boolean().optional().describe('User-level (true) or system-level (false), default: false'),
      }),
    },
  );

/**
 * LangChain tool for getting Creatio schema information
 */
export const getSchemaInfoTool = () =>
  tool(
    async (args) => {
      try {
        const server = getCreatioServer();
        const result = await server.getSchema(args);
        return result.content[0].text;
      } catch (error: any) {
        return JSON.stringify({ success: false, error: error.message });
      }
    },
    {
      name: 'get_schema_info',
      description: `Get detailed information about a Creatio schema by its GUID or name.
Returns schema metadata including type, package, parent, and body structure.
Returns: schemaInfo object with full metadata.`,
      schema: z.object({
        schemaUId: z.string().optional().describe('Schema GUID (use either schemaUId or schemaName)'),
        schemaName: z.string().optional().describe('Schema name (use either schemaUId or schemaName)'),
      }),
    },
  );

/**
 * LangChain tool for listing available parent schemas
 */
export const listAvailableParentsTool = () =>
  tool(
    async (args) => {
      try {
        const server = getCreatioServer();
        const result = await server.listParents(args);
        return result.content[0].text;
      } catch (error: any) {
        return JSON.stringify({ success: false, error: error.message });
      }
    },
    {
      name: 'list_available_parents',
      description: `List all Creatio schemas that can be used as parents for inheritance.
Filtered by package and schema type. Useful for finding base schemas to extend (e.g., BasePageV2, AccountPageV2).
Returns: array of parent schemas with name, uId, caption.`,
      schema: z.object({
        packageUId: z.string().describe('Package GUID to search in'),
        schemaType: z.string().describe('Filter by schema type (AngularSchema, Module, etc.)'),
        allowExtended: z.boolean().optional().describe('Include already extended schemas. Default: true'),
      }),
    },
  );

/**
 * LangChain tool for getting design package GUID
 */
export const getDesignPackageUIdTool = () =>
  tool(
    async (args) => {
      try {
        const server = getCreatioServer();
        const result = await server.getPackageUId(args);
        return result.content[0].text;
      } catch (error: any) {
        return JSON.stringify({ success: false, error: error.message });
      }
    },
    {
      name: 'get_design_package_uid',
      description: `Get the design package GUID where new schemas should be created.
This determines the target package for schema creation. If schemaUId is provided, returns the package of that schema.
Otherwise, returns the default design package.
Returns: packageUId (string), success (boolean), message.`,
      schema: z.object({
        schemaUId: z.string().optional().describe('Optional: Existing schema GUID to determine its package'),
        userLevelSchema: z.boolean().optional().describe('User-level (true) or system-level (false), default: false'),
      }),
    },
  );

/**
 * LangChain tool for validating Creatio schema name
 */
export const validateSchemaNameTool = () =>
  tool(
    async (args) => {
      try {
        const server = getCreatioServer();
        const result = await server.validateName(args);
        return result.content[0].text;
      } catch (error: any) {
        return JSON.stringify({ success: false, error: error.message });
      }
    },
    {
      name: 'validate_schema_name',
      description: `Check if a Creatio schema name is available (not already used).
Returns availability status. Use before creating schemas to avoid conflicts.
Returns: available (boolean), message.`,
      schema: z.object({
        schemaName: z.string().describe('Schema name to validate'),
      }),
    },
  );
