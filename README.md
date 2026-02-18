# LangChain DeepAgent Services

A sophisticated TypeScript service featuring multiple AI-powered agents:
1. **Translation Agent**: Ukrainian to English translation with terminology management
2. **Creatio Schema Agent**: Create ClientUnitSchema entities in Creatio platform using factory pattern

## Features

### Translation Service
- **Deep Agent Translation**: AI-powered translation using LangChain DeepAgents framework
- **Language Detection**: Automatically detects input language
- **Terminology Management**: Persistent terminology database that grows over time
- **Style-Aware Translation**: Support for technical, conversational, and formal styles
- **Context Understanding**: Considers domain context (ML, medical, legal, etc.)
- **Reasoning & Planning**: Agent explains translation choices and plans complex translations
- **Built-in Tools**: File system, planning (write_todos), and subagent capabilities

### Creatio Integration Service
- **Schema Creation**: Create new ClientUnitSchema entities (Pages, Modules, EntitySchemas)
- **Schema Extension**: Extend existing schemas with inheritance
- **Factory Pattern**: Automatic name generation with Usr prefix and initialization
- **Parent Management**: List and apply parent schemas
- **Name Validation**: Check schema name availability before creation
- **Planning**: Multi-step schema operations with agent reasoning

## Prerequisites

- Node.js 18+ (recommended: Node 20+)
- npm
- OpenAI API key (required for both services)
- Creatio instance (optional, only for schema creation service)

## Setup

1. Clone the repository
2. Copy the environment file:
   ```bash
   cp .env.example .env
   ```
3. Add your OpenAI API key to `.env`:
   ```
   OPENAI_API_KEY=your_key_here
   ```
4. (Optional) Add Creatio credentials for schema creation:
   ```
   CREATIO_URL=https://your-instance.creatio.com
   CREATIO_USERNAME=Supervisor
   CREATIO_PASSWORD=your_password
   ```
5. Install dependencies:
   ```bash
   npm install
   ```
6. Build the project:
   ```bash
   npm run build
   ```
7. Start the server:
   ```bash
   npm start
   ```

The server will start on the port specified in your `.env` file (default: 3000).

## API Endpoints

### Health Check

Check if the service is running:

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "ok": true
}
```

### DeepAgent Translation

Translate Ukrainian text to English with full agent capabilities:

**Simple translation:**
```bash
curl -X POST http://localhost:3000/agent/translate \
  -H "Content-Type: application/json" \
  -d '{"input": "привіт світ"}'
```

**Technical translation with terminology saving:**
```bash
curl -X POST http://localhost:3000/agent/translate \
  -H "Content-Type: application/json" \
  -d '{
    "input": "нейронна мережа використовує backpropagation",
    "style": "technical",
    "save_terms": true
  }'
```

**Translation with context:**
```bash
curl -X POST http://localhost:3000/agent/translate \
  -H "Content-Type: application/json" \
  -d '{
    "input": "модель навчання",
    "context": "machine learning domain",
    "style": "technical"
  }'
```

#### Request Parameters

- `input` (required): Text to translate
- `style` (optional): Translation style - `"technical"`, `"conversational"`, or `"formal"`
- `save_terms` (optional): Boolean - Save important terms to terminology database
- `context` (optional): Additional context to guide translation (e.g., "medical", "ML")

#### Response Format

```json
{
  "output": "Detailed translation with reasoning and explanations...",
  "agent_type": "deepagent"
}
```

The agent provides:
- The translation
- Detected language
- Style applied
- Terminology used (if any)
- Reasoning about translation choices
- Plan (for complex translations)

### Creatio Schema Creation

Create or extend ClientUnitSchema entities in Creatio platform using AI agent:

**Check Creatio connection:**
```bash
curl http://localhost:3000/agent/creatio/schema/health
```

Response:
```json
{
  "success": true,
  "creatio_configured": true,
  "creatio_url": "https://your-instance.creatio.com",
  "authenticated": false,
  "message": "Creatio client configured but not authenticated yet"
}
```

**Create a new page schema:**
```bash
curl -X POST http://localhost:3000/agent/creatio/schema \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "schemaName": "ContactDetailPage",
    "schemaType": "AngularSchema",
    "packageUId": "your-package-guid-here",
    "description": "Custom contact detail page"
  }'
```

**Create schema with parent inheritance:**
```bash
curl -X POST http://localhost:3000/agent/creatio/schema \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "schemaName": "CustomAccountPage",
    "schemaType": "AngularSchema",
    "packageUId": "your-package-guid-here",
    "parentSchemaName": "AccountPageV2",
    "description": "Extended account page with custom fields"
  }'
```

**Extend existing schema:**
```bash
curl -X POST http://localhost:3000/agent/creatio/schema \
  -H "Content-Type: application/json" \
  -d '{
    "action": "extend",
    "parentSchemaName": "AccountPageV2",
    "packageUId": "your-package-guid-here",
    "description": "Extended account page"
  }'
```

#### Creatio Request Parameters

- `action` (required): `"create"` or `"extend"`
- `packageUId` (required): Package GUID where schema will be created
- `schemaName` (required for create): Base name for the schema
- `schemaType` (required for create): `"AngularSchema"` (Page), `"Module"`, `"EntitySchema"`, etc.
- `parentSchemaName` (optional for create, required for extend): Parent schema to extend
- `description` (optional): Purpose of the schema
- `userLevelSchema` (optional): User-level (true) or system-level (false), default: false

#### Creatio Response Format

```json
{
  "success": true,
  "agent_response": "Agent response with reasoning and schema details...",
  "creatio_url": "https://your-instance.creatio.com",
  "action": "create",
  "package": "package-guid"
}
```

The agent provides:
- Created schema GUID and name (with Usr prefix)
- Schema type and parent information
- Execution plan (validation → creation → verification)
- Reasoning about decisions made
- Link to Creatio instance

#### Creatio Schema Types

- **AngularSchema**: Frontend page schemas (UI pages)
- **Module**: Business logic modules  
- **EntitySchema**: Data model schemas
- **BusinessProcess**: Process schemas

#### Creatio Naming Conventions

- User schemas automatically get **Usr** prefix (e.g., `UsrContactDetailPage`)
- Extended schemas inherit parent name
- Names are made unique with numbers if needed (e.g., `UsrContactDetailPage1`)

### How Creatio Agent Works

1. **Name Validation**: Checks if schema name is available using `validate_schema_name` tool
2. **Parent Search**: Lists available parents using `list_available_parents` (if inheritance needed)
3. **Schema Creation**: Uses factory pattern via `create_new_schema` or `extend_schema` tool
4. **Verification**: Gets schema info to confirm creation
5. **Planning**: For complex operations, uses `write_todos` to plan steps
6. **Reasoning**: Explains decisions and provides structured response

### Creatio Factory Pattern

The agent uses Creatio's factory pattern which automatically:
- Generates unique schema GUID
- Applies Usr prefix to user schemas
- Generates unique name with number suffix if needed
- Initializes default schema body structure
- Applies parent inheritance correctly
- Sets up package relationships

### How DeepAgent Works (Translation)

1. **Language Detection**: Uses MCP `detect_language` tool to identify input language
2. **Terminology Check**: Searches terminology database using `load_terminology` tool
3. **Planning**: For complex texts, uses built-in `write_todos` to plan approach
4. **Translation**: Translates using MCP `translate_ukrainian_to_english` tool
5. **Term Storage**: Saves new terms using `save_terminology` tool if requested
6. **Reasoning**: Explains translation decisions

### DeepAgent Capabilities

- **Automatic Planning**: Breaks down complex translations into steps
- **File System**: Can store large contexts in files using built-in tools
- **Terminology Database**: Persistent storage in `data/terminology.json`
- **Subagents**: Can spawn specialized agents for complex subtasks
- **Context Management**: Uses file system to handle large translation contexts
- **Learning**: Terminology database grows with use, improving consistency

## Environment Variables

- `PORT` (optional): Port number for the HTTP server (default: 3000)
- `OPENAI_API_KEY` (required): OpenAI API key for DeepAgent and MCP tools
- `CREATIO_URL` (optional): Creatio instance URL (e.g., https://your-instance.creatio.com)
- `CREATIO_USERNAME` (optional): Creatio username (default: Supervisor)
- `CREATIO_PASSWORD` (optional): Creatio password

## Architecture

### Translation Service
```
HTTP Request → /agent/translate
                     ↓
         DeepAgent (createDeepAgent)
                     ↓
          ┌──────────┴──────────┐
          ↓                     ↓
    Built-in Tools        Custom Tools
    - write_todos         - detect_language (MCP)
    - write_file          - translate (MCP)
    - read_file           - save_terminology
    - spawn_subagent      - load_terminology
          ↓                     ↓
    Planning & File Mgmt   Translation Logic
                     ↓
         Structured Response
         (with reasoning)
```

### Creatio Schema Service
```
HTTP Request → /agent/creatio/schema
                     ↓
         DeepAgent (Creatio Expert)
                     ↓
          ┌──────────┴──────────┐
          ↓                     ↓
    Built-in Tools        Creatio MCP Tools
    - write_todos         - create_new_schema (Factory)
    - write_file          - extend_schema (Factory)
    - read_file           - get_schema_info
                          - list_available_parents
                          - validate_schema_name
          ↓                     ↓
    Planning              Creatio REST API
                               ↓
                    Factory Pattern Execution:
                    1. Create (API)
                    2. Name (Generator)
                    3. Initialize (Initializer)
                               ↓
                          Creatio Instance
                               ↓
                          New Schema Created
```

## Build

To build the TypeScript code for production:

```bash
npm run build
```

To run the production build:

```bash
npm start
```

## Technology Stack

- **DeepAgents**: LangChain framework for autonomous agents
- **LangChain**: Core building blocks for LLM applications
- **OpenAI GPT-4o-mini**: Language model for translation and reasoning
- **MCP (Model Context Protocol)**: Standardized tool protocol
- **TypeScript**: Type-safe development
- **Express**: HTTP server

## Data Storage

- `data/terminology.json`: Persistent terminology database
  - Grows automatically as agent saves terms
  - Improves translation consistency over time
  - Can be manually edited or backed up

---

## How It Works - Technical Overview

### Architecture Deep Dive

This translation service is built on **LangChain DeepAgents**, a sophisticated agent framework that provides autonomous AI agents with planning, tool use, and file system capabilities. Here's how the system works under the hood:

### 1. Core Components

#### **DeepAgent (`src/agent/translationAgent.ts`)**
The heart of the system. A DeepAgent is an autonomous AI agent that:
- **Plans its own actions** using the built-in `write_todos` tool for complex tasks
- **Makes decisions** about which tools to call and in what order
- **Manages context** using file system tools to offload large data
- **Reasons about outcomes** and explains its decisions

Configuration:
```typescript
createDeepAgent({
  model: 'gpt-4o-mini',           // GPT-4o-mini for cost efficiency
  systemPrompt: DETAILED_PROMPT,   // Expert translator persona
  tools: [                         // Available tools
    detectLanguageTool,            // From MCP
    translateTool,                 // From MCP
    loadTerminologyTool,           // Custom
    saveTerminologyTool,           // Custom
    // Built-in: write_todos, write_file, read_file, spawn_subagent
  ]
})
```

#### **MCP Server (`src/mcp/translationServer.ts`)**
Implements the Model Context Protocol - a standardized way to expose tools to AI agents:

**Two MCP Tools:**
1. **`mcp_detect_language`**: Detects input language using GPT-4o-mini
   - Input: `{ text: string }`
   - Output: `{ language: string, confidence: string }`
   - Uses a specialized prompt for language identification

2. **`mcp_translate`**: Translates Ukrainian to English
   - Input: `{ text: string }`
   - Output: `{ translation: string }`
   - Uses GPT-4o-mini with translation-specific prompt

The MCP server runs **in-process** (not as a separate service) for simplicity.

#### **MCP Tools Bridge (`src/mcp/mcpTools.ts`)**
Converts MCP tools into LangChain Tool format so the DeepAgent can use them:

```typescript
class MCPDetectLanguageTool extends Tool {
  name = 'detect_language'
  async _call(input: string) {
    const server = getTranslationServer()
    return await server.detectLanguageDirect(input)
  }
}
```

This creates a seamless bridge between MCP protocol and LangChain's tool system.

#### **Terminology Tools (`src/tools/terminologyTool.ts`)**
Custom LangChain tools for persistent terminology management:

**`save_terminology`**: Saves Ukrainian-English term pairs
- Stores in `data/terminology.json`
- Tracks context (e.g., "machine learning")
- Tracks style (technical, conversational, formal)
- Updates existing entries or creates new ones

**`load_terminology`**: Searches for relevant terms
- Searches by substring match in input text
- Returns matching terms with context and style
- Agent uses this BEFORE translating to maintain consistency

### 2. Request Flow

Here's what happens when you send a translation request:

```
1. HTTP POST /agent/translate
   └─> Express route handler (src/routes/agent.ts)

2. Build user message with parameters
   - "Translate: {input}"
   - "Style: {style}" (if provided)
   - "Context: {context}" (if provided)
   - "Please save terms..." (if save_terms=true)

3. Invoke DeepAgent
   └─> DeepAgent.invoke({ messages: [...] })

4. Agent Decision Making Process:
   
   Step A: Agent analyzes the task
   └─> "I need to translate Ukrainian to English"
   
   Step B: Agent calls detect_language tool
   └─> MCP Server → GPT-4o-mini
       └─> Returns: { language: "Ukrainian", confidence: "high" }
   
   Step C: Agent calls load_terminology tool
   └─> Searches data/terminology.json
       └─> Returns: relevant terms (if any)
   
   Step D: Agent calls translate tool
   └─> MCP Server → GPT-4o-mini with translation prompt
       └─> Returns: English translation
   
   Step E: Agent decides if terms should be saved
   └─> (If save_terms=true OR important technical term)
       └─> Calls save_terminology tool
           └─> Updates data/terminology.json
   
   Step F: Agent formulates response
   └─> Includes: translation, language, style, reasoning

5. Response sent to client
   └─> JSON with agent's full response
```

### 3. Built-in DeepAgent Capabilities

The DeepAgent framework provides several powerful built-in tools:

#### **Planning System (`write_todos`)**
For complex translations, the agent can create a todo list:
```
Example for translating a paragraph:
1. Detect language
2. Check terminology for technical terms
3. Translate sentence by sentence
4. Review for consistency
5. Save new technical terms
```

#### **File System Tools**
- **`write_file`**: Store large contexts or intermediate results
- **`read_file`**: Load previously stored data
- **`list_files`**: Browse available files

Use case: If translating a large document, the agent can:
1. Write chunks to files
2. Translate each chunk
3. Read and combine results

#### **Subagent Spawning**
For complex subtasks, the agent can spawn specialized subagents:
```
Main Agent: "I need to translate this medical text"
  └─> Spawns Medical Translation Subagent
      └─> Specialized for medical terminology
```

#### **Context Management**
DeepAgents automatically:
- Summarize long conversations when approaching token limits
- Cache system prompts (with Anthropic models)
- Manage message history efficiently

### 4. Key Design Decisions

#### **Why MCP?**
- **Standardization**: MCP is a protocol, not a library-specific API
- **Tool Discovery**: Tools are self-describing with schemas
- **Reusability**: Same MCP tools can be used by different agents
- **Future-proof**: Can extract MCP server to standalone service later

#### **Why DeepAgents?**
- **Autonomy**: Agent decides tool calling strategy
- **Planning**: Built-in planning for complex tasks
- **File System**: Essential for managing large contexts
- **Production-Ready**: Built on LangGraph for reliable execution

#### **Why GPT-4o-mini?**
- **Cost-effective**: ~20x cheaper than GPT-4
- **Fast**: Low latency responses
- **Capable**: Strong performance for translation tasks
- **Multilingual**: Excellent language understanding

### 5. Terminology Database Structure

`data/terminology.json`:
```json
[
  {
    "ukrainian": "нейронна мережа",
    "english": "neural network",
    "context": "machine learning",
    "style": "technical",
    "timestamp": "2026-02-18T14:38:14.734Z"
  }
]
```

Benefits:
- **Consistency**: Same terms always translate the same way
- **Context-aware**: Different translations for different domains
- **Growing**: Database improves over time
- **Portable**: JSON format, easy to backup/share

### 6. Error Handling

The system handles various error scenarios:

1. **Missing API Key**: Returns clear error message
2. **Invalid Input**: Validates before calling agent
3. **Tool Failures**: Agent handles gracefully and retries or reports
4. **Non-Ukrainian Input**: Agent detects and informs user
5. **File System Errors**: Built-in error recovery

### 7. Performance Considerations

- **Streaming**: DeepAgents support streaming (not yet implemented in HTTP endpoint)
- **Caching**: Terminology lookups are fast (JSON file read)
- **Concurrent Requests**: Express handles multiple requests
- **Token Usage**: Agent optimized to minimize unnecessary tool calls

### 8. Extension Points

Easy to extend the system:

**Add New Tools:**
```typescript
const spellCheckTool = tool(
  async ({ text }) => { /* ... */ },
  { name: 'spell_check', ... }
)

createDeepAgent({
  tools: [...existingTools, spellCheckTool]
})
```

**Add New Languages:**
- Update MCP translate tool to handle multiple target languages
- Modify system prompt to specify language pairs

**Add Memory:**
```typescript
createDeepAgent({
  tools: [...],
  memory: new InMemoryStore()  // Long-term memory across sessions
})
```

**Add Subagents:**
```typescript
createDeepAgent({
  tools: [...],
  subagents: [
    {
      name: 'technical-translator',
      description: 'Specialized for technical translations',
      tools: [technicalGlossaryTool]
    }
  ]
})
```

### 9. Development vs Production

**Development Mode:**
```bash
npm run dev
# Uses tsx for hot reload
# Logs all agent decisions
```

**Production Mode:**
```bash
npm run build
npm start
# Compiled TypeScript
# Optimized for performance
```

### 10. Monitoring & Debugging

**Agent Decisions:** The agent's output includes reasoning, making it easy to understand:
- Why it chose to call specific tools
- What terminology it found/saved
- How it arrived at the translation

**Console Logs:** Server logs tool calls and errors

**Terminology Inspection:** Simply check `data/terminology.json`

---

## Creatio Integration - Technical Deep Dive

### Architecture Components

#### **Creatio API Client (`src/creatio/creatioClient.ts`)**
HTTP client with authentication and session management for Creatio REST API:

**Features:**
- Basic authentication (username/password)
- Cookie-based session management
- Automatic re-authentication on session expiry
- CSRF token handling
- Centralized error handling

```typescript
class CreatioClient {
  authenticate()              // Login and establish session
  post(endpoint, data)        // Authenticated POST request
  get(endpoint, params)       // Authenticated GET request
  isConnected()              // Check authentication status
}
```

**Singleton Pattern:** Use `getCreatioClient()` for single instance across application.

#### **Creatio MCP Server (`src/mcp/creatioMcpServer.ts`)**
MCP server exposing Creatio operations as standardized tools:

**Five MCP Tools:**

1. **`create_new_schema`**: Factory method for new ClientUnitSchema
   - Creates schema via API (`CreateSchema` endpoint)
   - Applies parent if specified (`ApplyParent` endpoint)
   - Auto-generates unique name with Usr prefix
   - Returns: schemaUId, schemaName, schemaType, parent

2. **`extend_schema`**: Factory method for schema extension
   - Gets parent schema info first
   - Creates child schema with inheritance flag
   - Preserves parent name
   - Returns: schemaUId, schemaName, parentSchemaUId

3. **`get_schema_info`**: Retrieve schema metadata
   - Accepts schemaUId or schemaName
   - Returns full schema structure
   - Used for validation and planning

4. **`list_available_parents`**: Find extendable schemas
   - Filters by packageUId and schemaType
   - Returns array of parent options
   - Used for discovering base schemas (e.g., BasePageV2)

5. **`validate_schema_name`**: Check name availability
   - Attempts to get schema by name
   - Returns availability boolean
   - Prevents naming conflicts

#### **Creatio DeepAgent (`src/agent/creatioSchemaAgent.ts`)**
Specialized DeepAgent configured as Creatio development expert:

**Agent Capabilities:**
- **Schema Type Knowledge**: Understands AngularSchema, Module, EntitySchema, BusinessProcess
- **Factory Pattern Expertise**: Knows proper creation sequence
- **Naming Conventions**: Enforces Usr prefix for user schemas
- **Inheritance Planning**: Determines when to use create vs extend
- **Multi-step Operations**: Uses `write_todos` for complex scenarios

**System Prompt Highlights:**
```
- User schemas MUST have "Usr" prefix
- Extended schemas inherit parent name
- Validate names before creation
- List parents when inheritance needed
- Plan complex operations
```

### Creatio Request Flow

```
1. HTTP POST /agent/creatio/schema
   └─> Request body parsed
       └─> action: "create" or "extend"
       └─> schemaName, schemaType, packageUId, etc.

2. Agent input construction
   └─> Structured prompt with:
       - Schema details
       - Step-by-step instructions
       - Validation requirements

3. DeepAgent invoked
   └─> Agent reasoning begins
       
   Step A: Name validation (if create)
   └─> Calls validate_schema_name tool
       └─> CreatioMCPServer → CreatioClient → Creatio API
           └─> Returns: { available: boolean }
   
   Step B: Parent search (if inheritance)
   └─> Calls list_available_parents tool
       └─> CreatioMCPServer → API: GetAvailableParentSchemas
           └─> Returns: parent options array
   
   Step C: Schema creation
   └─> Calls create_new_schema OR extend_schema
       └─> CreatioMCPServer executes factory pattern:
           1. POST CreateSchema
           2. POST ApplyParent (if parent specified)
           3. Auto-naming on Creatio side
           └─> Returns: { schemaUId, schemaName }
   
   Step D: Verification (optional)
   └─> Calls get_schema_info to confirm
       └─> POST GetSchemaInfo with schemaUId
           └─> Returns: full schema metadata
   
   Step E: Planning (complex operations)
   └─> Uses write_todos built-in tool
       └─> Creates action plan
           └─> Executes steps sequentially

4. Agent formulates response
   └─> Structured output with:
       - success status
       - schemaUId and schemaName
       - execution plan
       - reasoning
       - Creatio URL

5. Response sent to client
   └─> JSON with agent response and metadata
```

### Creatio Factory Pattern

The factory pattern ensures proper schema initialization following Creatio's architecture:

**Factory Sequence:**
```
1. CreateSchema API Call
   └─> Generates new schema GUID
   └─> Creates basic structure
   └─> Assigns to package

2. Name Generation (Creatio-side or via SysSettings)
   └─> Gets SchemaNamePrefix from SysSettings
   └─> Applies Usr prefix for user schemas
   └─> Adds number suffix for uniqueness (e.g., UsrPage1)

3. Parent Application (if inheritance)
   └─> ApplyParent API call
   └─> Copies parent structure
   └─> Sets up inheritance chain
   └─> Preserves parent name for extended schemas

4. Schema Initialization
   └─> Sets default body structure
   └─> Initializes localizableStrings
   └─> Configures dependencies
```

**Equivalent to Angular Service:**
```typescript
// ClientUnitSchemaCreatorService.createNewSchema()
API.CreateSchema(config)
  .pipe(
    switchMap(schema => 
      parentUId ? API.ApplyParent(schema, parentUId) : of(schema)
    ),
    switchMap(schema => NameGenerator.applySchemaName(schema)),
    tap(schema => Initializer.initializeSchema(schema))
  )
```

### Creatio API Endpoints

**Base URL:** `{CREATIO_URL}/0/ServiceModel/ClientUnitSchemaDesignerService.svc/`

**Authentication:**
```
POST /ServiceModel/AuthService.svc/Login
Body: { UserName, UserPassword }
Response: Session cookies (BPMCSRF, .ASPXAUTH)
```

**Schema Operations:**
```
POST CreateSchema
Body: { packageUId, schemaType, userLevelSchema, extendParent }
Response: { success, schema: ClientUnitSchema }

POST GetSchemaInfo
Body: { schemaUId: Guid }
Response: { success, schemaInfo: ClientUnitSchemaInfo }

POST GetSchemaInfoByName
Body: { schemaName: string }
Response: { success, schemaInfo }

POST GetAvailableParentSchemas
Body: { packageUId, schemaType, allowExtended, useFullHierarchy }
Response: { success, items: ParentSchema[] }

POST ApplyParent
Body: { schema, newParentUid, userLevelSchema }
Response: { success, schema: ClientUnitSchema }

POST SaveSchema
Body: { schema, images }
Response: { success, schemaUId }
```

### Creatio Data Models

**ClientUnitSchema Structure:**
```typescript
interface ClientUnitSchema {
  uId: string;                    // Schema GUID
  name: string;                   // Schema name (e.g., UsrContactPage1)
  caption: LocalizableString;     // Display name
  schemaType: ClientUnitSchemaType; // AngularSchema, Module, etc.
  packageUId: string;             // Package GUID
  parent?: ClientUnitSchema;      // Parent schema (for inheritance)
  extendParent: boolean;          // Inheritance flag
  body: string;                   // Schema body (JavaScript/TypeScript)
  localizableStrings: object;     // UI strings
  images: object;                 // Icon/image resources
  dependencies: string[];         // Required schemas
}
```

**ClientUnitSchemaType Enum:**
- `AngularSchema`: Frontend pages (UI)
- `Module`: Business logic modules
- `EntitySchema`: Data model definitions
- `BusinessProcess`: Workflow processes
- `Case`: Case management schemas
- `SourceCodeSchema`: Source code files

### Design Decisions

**Why Factory Pattern?**
- **Automatic Naming**: Usr prefix and uniqueness handled by Creatio
- **Proper Initialization**: Ensures valid schema structure
- **Inheritance Support**: Correctly sets up parent-child relationships
- **Package Integration**: Manages package dependencies

**Why MCP Tools?**
- **Standardization**: Same protocol as translation service
- **Reusability**: Tools can be used by other agents
- **Discoverability**: Self-documenting via MCP schema
- **Extensibility**: Easy to add more Creatio operations

**Why DeepAgent?**
- **Planning**: Complex schema operations need multi-step planning
- **Decision Making**: Agent determines create vs extend
- **Reasoning**: Explains why specific parents or types chosen
- **Error Handling**: Agent can retry with different approaches

### Extension Points

**Add More Schema Operations:**
```typescript
// In creatioMcpServer.ts
{
  name: 'delete_schema',
  description: 'Delete a ClientUnitSchema',
  inputSchema: { schemaUId: 'string' }
}
```

**Add Package Management:**
```typescript
{
  name: 'list_packages',
  description: 'List available packages',
  inputSchema: {}
}
```

**Add Schema Validation:**
```typescript
{
  name: 'validate_schema_structure',
  description: 'Validate schema body syntax',
  inputSchema: { schemaBody: 'string' }
}
```

### Troubleshooting Creatio Integration

**Authentication fails?**
- Check `CREATIO_URL`, `CREATIO_USERNAME`, `CREATIO_PASSWORD` in `.env`
- Verify Creatio instance is accessible
- Check if user has schema creation permissions
- Inspect cookies in CreatioClient logs

**Schema creation fails?**
- Verify `packageUId` exists in Creatio
- Check if parent schema exists (use list_available_parents)
- Ensure schemaType is valid
- Check Creatio logs for server-side errors

**Agent doesn't find parent schema?**
- Parent must be in same package or system package
- Use exact parent name (case-sensitive)
- Check if parent allows inheritance
- Use list_available_parents to see options

**Name conflicts?**
- Creatio should auto-increment (UsrPage1, UsrPage2)
- If manual naming fails, let factory generate name
- Check validate_schema_name first

**Session expires?**
- CreatioClient auto-reauthenticates
- Check if credentials are still valid
- Inspect session timeout settings in Creatio

---

## Troubleshooting

**Agent not working?**
- Check `OPENAI_API_KEY` is set in `.env`
- Verify API key has sufficient credits
- Check console logs for errors

**Terminology not persisting?**
- Verify `data/` directory exists and is writable
- Check file permissions
- Inspect `data/terminology.json` content

**Translations inconsistent?**
- Build up terminology database by using `save_terms: true`
- Check if relevant terms exist in database
- Consider adding more context in requests

**Slow responses?**
- Normal: First request is slower (model loading)
- Agent planning adds overhead for complex tasks
- Consider caching frequently used translations

---

## Contributing

This is a demonstration project showing DeepAgents capabilities. Feel free to:
- Add more translation language pairs
- Implement streaming responses
- Add more sophisticated terminology matching
- Integrate with translation memory systems
- Add support for document translation