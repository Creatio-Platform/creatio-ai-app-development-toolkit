# Creatio Schema Agent Service

TypeScript/Express service with a LangGraph-powered Creatio schema agent.

## Core Architecture
- `LangGraph` orchestrates the agent flow (intent -> branch -> tools -> response).
- `LangChain` structured output is used for intent parsing.
- `MCP gateway` executes schema operations against Creatio.
- `Checkpointed threads` enable resume/human-in-the-loop template selection.

## Features
- Thread-based NLP flow: `POST /agent/creatio`
- Streaming graph events: `POST /agent/creatio/stream`
- Thread state inspection: `GET /agent/creatio/state?threadId=<id>`
- Structured schema API: `POST /agent/creatio/schema`
- Template discovery: `GET /agent/creatio/templates?schemaType=9`
- Health: `GET /agent/creatio/schema/health`
- Idempotent create operations via `Idempotency-Key` header or `idempotencyKey` field

## Requirements
- Node.js 20+
- Creatio credentials
- OpenAI API key

## Environment Variables
- `PORT`
- `OPENAI_API_KEY`
- `CREATIO_URL`
- `CREATIO_USERNAME`
- `CREATIO_PASSWORD`

## Run
```bash
npm install
npm run build
npm start
```

## API Examples

### 1) Start graph run
```bash
curl -X POST http://localhost:3000/agent/creatio \
  -H "Content-Type: application/json" \
  -d '{"text":"create page AccountPage"}'
```

If template is required, response contains `operation=awaiting_template_selection`, `threadId`, `selectionId`, `templates[]`.

### 2) Resume after template selection
```bash
curl -X POST http://localhost:3000/agent/creatio \
  -H "Content-Type: application/json" \
  -d '{"threadId":"<threadId>","templateUId":"<templateUId>"}'
```

### 3) Stream graph events (SSE)
```bash
curl -N -X POST http://localhost:3000/agent/creatio/stream \
  -H "Content-Type: application/json" \
  -d '{"text":"create page ContactPage","threadId":"demo-thread-1"}'
```

### 4) Structured create
```bash
curl -X POST http://localhost:3000/agent/creatio/schema \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: create-account-page-001" \
  -d '{"action":"create","schemaName":"AccountPage","schemaType":"AngularSchema"}'
```

## Project Notes
- Graph runtime: `src/graph/creatio/runtime.ts`
- Graph state schema: `src/graph/creatio/state.ts`
- Integration gateway: `src/integrations/schema-creation/*`
- Request contracts: `src/domain/schema/contracts.ts`
- Unified API errors: `src/domain/errors/apiError.ts`
