import { getCreatioServer } from './dist/mcp/creatioMcpServer.js';

async function testMcpServer() {
  console.log('🧪 Testing MCP Server methods...\n');

  try {
    const server = getCreatioServer();
    
    // Test 1: Get package UID
    console.log('1️⃣ Getting design package UID...');
    const packageResult = await server.getPackageUId({ userLevelSchema: false });
    console.log('Result:', packageResult.content[0].text);
    const packageData = JSON.parse(packageResult.content[0].text);
    
    if (!packageData.success) {
      console.error('❌ Failed to get package UID');
      return;
    }
    
    console.log('✅ Package UID:', packageData.packageUId, '\n');

    // Test 2: Create new schema
    console.log('2️⃣ Creating new schema...');
    const createResult = await server.createSchema({
      packageUId: packageData.packageUId,
      schemaType: 'AngularSchema',
      userLevelSchema: false,
    });
    
    console.log('Result:', createResult.content[0].text);
    const createData = JSON.parse(createResult.content[0].text);
    
    if (createData.success) {
      console.log('\n✅ Schema created!');
      console.log('   Schema UID:', createData.schemaUId);
      console.log('   Schema Name:', createData.schemaName);
    } else {
      console.log('\n❌ Schema creation failed:', createData.error);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

testMcpServer();
