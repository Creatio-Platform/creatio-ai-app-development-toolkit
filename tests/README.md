# Test Scripts

This directory contains test scripts for Creatio integration.

## Test Scripts

### Schema Creation Tests

- **test-schema-creation-fixed.js** - Complete working example of schema creation
  - Authenticates with Creatio
  - Gets design package UID
  - Creates new schema
  - Applies parent schema (BasePageFreedomTemplate)
  - Saves schema with body code

- **test-mcp-server.js** - Tests MCP server methods directly
  - Tests getPackageUId
  - Tests createSchema with type mapping

- **test-client-connection.js** - Tests CreatioClient authentication
  - Tests login
  - Tests package UID retrieval

### Discovery Scripts

- **discover-services.js** - Discovers available Creatio services
  - Tests different service endpoints
  - Checks which services are available

### Legacy Tests

- **test-creatio.js** - Original connection test
- **test-schema-creation.js** - Early schema creation attempt
- **test-methods.js** - Tests different method variations

## Running Tests

All tests can be run directly with Node.js:

```bash
# Test complete schema creation
node tests/test-schema-creation-fixed.js

# Test MCP server
node tests/test-mcp-server.js

# Test client connection
node tests/test-client-connection.js

# Discover services
node tests/discover-services.js
```

## Configuration

Tests read configuration from `.env` file in the project root:

```
CREATIO_URL=http://your-instance:port/instance-name
CREATIO_USERNAME=Supervisor
CREATIO_PASSWORD=your-password
```

## Test Results

All tests log to console with emoji indicators:
- ✅ Success
- ❌ Error
- ⚠️ Warning
- 🔑 Security info
- 📦 Data output
