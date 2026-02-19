# PR Description

## Summary
This branch focuses on Creatio schema automation.

## Included
1. Schema creation/extension flows (`/agent/creatio`, `/agent/creatio/schema`)
2. Template selection flow for page schemas
3. Gateway-based integration layer for schema operations
4. Contract-first validation and normalized API errors
5. Idempotency support for create operations

## Main Endpoints
- `POST /agent/creatio`
- `POST /agent/creatio/schema`
- `GET /agent/creatio/templates?schemaType=9`
- `GET /agent/creatio/schema/health`
