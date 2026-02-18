import axios from 'axios';

const CREATIO_URL = 'http://ts1-infr-web01:88/studioenu_14225044_0218';
const USERNAME = 'Supervisor';
const PASSWORD = 'Supervisor';

async function testSchemaDesignerMethods() {
  console.log('🧪 Testing ClientUnitSchemaDesignerService methods...\n');

  let cookies = [];
  let csrfToken = '';

  try {
    // Login
    console.log('1️⃣ Authenticating...');
    const loginResponse = await axios.post(
      `${CREATIO_URL}/ServiceModel/AuthService.svc/Login`,
      { UserName: USERNAME, UserPassword: PASSWORD },
      { headers: { 'Content-Type': 'application/json' }, withCredentials: true }
    );

    if (loginResponse.data.Code !== 0) {
      console.error('❌ Authentication failed');
      return;
    }

    console.log('✅ Authenticated\n');
    cookies = loginResponse.headers['set-cookie'];
    const csrfCookie = cookies?.find((c) => c.includes('BPMCSRF='));
    csrfToken = csrfCookie?.split(';')[0].split('=')[1] || '';

    // Get package UID
    console.log('2️⃣ Getting package UID...');
    const packageResponse = await axios.post(
      `${CREATIO_URL}/0/ServiceModel/ApplicationPackagesService.svc/GetDesignPackageUId`,
      { userLevelSchema: false },
      {
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookies.join('; '),
          BPMCSRF: csrfToken,
        },
      }
    );

    const packageUId = packageResponse.data.uId;
    console.log('✅ Package UID:', packageUId, '\n');

    // Test different method variations
    const testMethods = [
      {
        name: 'CreateSchema (no /0/)',
        url: `${CREATIO_URL}/ServiceModel/ClientUnitSchemaDesignerService.svc/CreateSchema`,
      },
      {
        name: 'CreateSchema (with /0/)',
        url: `${CREATIO_URL}/0/ServiceModel/ClientUnitSchemaDesignerService.svc/CreateSchema`,
      },
      {
        name: 'GetSchemaInfo (with test)',
        url: `${CREATIO_URL}/ServiceModel/ClientUnitSchemaDesignerService.svc/GetSchemaInfo`,
        data: { schemaName: 'AccountPageV2' }, // Try with known schema
      },
    ];

    console.log('3️⃣ Testing methods:\n');

    for (const test of testMethods) {
      console.log(`Testing: ${test.name}`);
      console.log(`URL: ${test.url}`);
      
      try {
        const response = await axios.post(
          test.url,
          test.data || {
            packageUId: packageUId,
            schemaType: 'AngularSchema',
            userLevelSchema: false,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Cookie: cookies.join('; '),
              BPMCSRF: csrfToken,
            },
            validateStatus: () => true, // Accept all status
          }
        );

        console.log(`Status: ${response.status}`);
        console.log(`Response:`, JSON.stringify(response.data, null, 2));
        console.log('---\n');
      } catch (error) {
        console.log(`❌ Error: ${error.message}\n`);
      }
    }

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
  }
}

testSchemaDesignerMethods();
