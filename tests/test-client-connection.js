import { getCreatioClient } from './dist/creatio/creatioClient.js';

async function testCreatioConnection() {
  console.log('🧪 Testing Creatio Client...\n');

  try {
    const client = getCreatioClient();
    
    // Test authentication
    console.log('1️⃣ Authenticating...');
    await client.authenticate();
    console.log('✅ Authenticated\n');

    // Test GetDesignPackageUId
    console.log('2️⃣ Getting design package UID...');
    const packageResult = await client.post(
      '/0/ServiceModel/ApplicationPackagesService.svc/GetDesignPackageUId',
      { userLevelSchema: false }
    );
    
    console.log('Package result:', JSON.stringify(packageResult, null, 2));
    
    if (packageResult.success && packageResult.uId) {
      console.log('\n✅ Package UID:', packageResult.uId);
    } else {
      console.log('\n❌ Failed to get package UID');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

testCreatioConnection();
