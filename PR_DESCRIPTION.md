# Add Creatio Schema Creation and Translation Services

## Overview
This PR adds two major AI-powered services to the application:
1. **Translation Service** - Ukrainian to English translation with terminology management
2. **Creatio Schema Creation Service** - Create and manage ClientUnitSchema entities in Creatio platform

## Key Features

### Translation Service
- ✅ DeepAgent-powered translation using LangChain framework
- ✅ Automatic language detection
- ✅ Persistent terminology database
- ✅ Style-aware translation (technical, conversational, formal)
- ✅ Context understanding (ML, medical, legal domains)
- ✅ Agent reasoning and planning capabilities

### Creatio Integration Service
- ✅ Schema creation with factory pattern
- ✅ Auto-generated schema names with Usr prefix
- ✅ Parent schema support (inheritance)
- ✅ Schema type mapping (AngularSchema, Module, EntitySchema, etc.)
- ✅ Name validation before creation
- ✅ Multi-step operations with agent planning

## Technical Improvements
- ✅ Automatic authentication retry on 401 errors
- ✅ Session management with cookie persistence
- ✅ CSRF token handling
- ✅ Type-safe schema type conversion
- ✅ Comprehensive error handling

## Code Organization
- Moved all test files to `tests/` directory
- Added test documentation
- Removed deprecated chain endpoints
- Updated project documentation

## Testing
All endpoints have been tested and verified:
- ✅ Health check endpoint
- ✅ Translation service with terminology
- ✅ Schema creation with authentication retry
- ✅ Build passes without errors

## API Endpoints

### Translation
```
POST /agent/translate
Body: {
  "input": "Ukrainian text",
  "style": "technical",
  "save_terms": true
}
```

### Schema Creation
```
POST /agent/creatio/schema
Body: {
  "action": "create",
  "schemaName": "TestPage",
  "schemaType": "AngularSchema",
  "description": "Description"
}
```

## Files Changed
- 30 files changed, 5015 insertions(+), 113 deletions(-)
- Added: 22 files
- Modified: 8 files
- Deleted: 2 deprecated files

## Dependencies
- No new production dependencies
- Uses existing LangChain and DeepAgents packages

## Documentation
- Updated README with usage examples
- Added SCHEMA_CREATION_ANALYSIS.md with technical details
- Added tests/README.md with test documentation

## Breaking Changes
None - Only additions to the API

## Migration Guide
1. Update `.env` file with new variables:
   ```
   CREATIO_URL=https://your-instance.creatio.com
   CREATIO_USERNAME=Supervisor
   CREATIO_PASSWORD=your-password
   ```
2. Run `npm install` (no new dependencies, but package-lock updated)
3. Run `npm run build`
4. Start server with `npm start`

## Related Issues
N/A - Initial implementation

## Checklist
- [x] Code builds successfully
- [x] All endpoints tested and working
- [x] Documentation updated
- [x] Tests organized in separate directory
- [x] No breaking changes
- [x] Git trailer added to commit
