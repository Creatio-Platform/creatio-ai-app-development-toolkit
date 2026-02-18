# LangChain API Service

A minimal TypeScript + LangChain HTTP API service for running LangChain workflows locally.

## Prerequisites

- Node.js 18+ (recommended: Node 20+)
- npm

## Setup

1. Clone the repository
2. Copy the environment file:
   ```bash
   cp .env.example .env
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the development server:
   ```bash
   npm run dev
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

### Hello Chain

Execute a simple LangChain workflow:

```bash
curl -X POST http://localhost:3000/chain/hello \
  -H "Content-Type: application/json" \
  -d '{"input": "World"}'
```

Response:
```json
{
  "output": "Hello, World!"
}
```

## Environment Variables

- `PORT` (optional): Port number for the HTTP server (default: 3000)
- `OPENAI_API_KEY` (optional): OpenAI API key for LangChain. If not provided, the service will use a simple fallback mode.

## Build

To build the TypeScript code for production:

```bash
npm run build
```

To run the production build:

```bash
npm start
```