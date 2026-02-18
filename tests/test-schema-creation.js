import axios from 'axios';

const CREATIO_URL = 'http://ts1-infr-web01:88/studioenu_14225044_0218';
const USERNAME = 'Supervisor';
const PASSWORD = 'Supervisor';

async function testSchemaCreation() {
  console.log('🧪 Testing Creatio Schema Creation\n');
  console.log('URL:', CREATIO_URL);
  console.log('User:', USERNAME, '\n');

  let cookies = [];
  let csrfToken = '';

  try {
    // Step 1: Login
    console.log('1️⃣ Authenticating...');
    const loginResponse = await axios.post(
      `${CREATIO_URL}/ServiceModel/AuthService.svc/Login`,
      {
        UserName: USERNAME,
        UserPassword: PASSWORD,
      },
      {
        headers: { 'Content-Type': 'application/json' },
        withCredentials: true,
      }
    );

    if (!loginResponse.data || loginResponse.data.Code !== 0) {
      console.error('❌ Authentication failed');
      console.error('Response:', loginResponse.data);
      return;
    }
    
    console.log('✅ Authenticated successfully\n');

    // Extract cookies and CSRF token
    cookies = loginResponse.headers['set-cookie'];
    const csrfCookie = cookies?.find((c) => c.includes('BPMCSRF='));
    csrfToken = csrfCookie?.split(';')[0].split('=')[1] || '';
    console.log('🔑 CSRF Token:', csrfToken ? 'Found' : 'Not found');

    // Step 2: Get Design Package UID
    console.log('\n2️⃣ Getting design package UID...');
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

    if (!packageResponse.data?.success || !packageResponse.data?.uId) {
      console.error('❌ Failed to get package UID');
      console.error('Response:', packageResponse.data);
      return;
    }

    const packageUId = packageResponse.data.uId;
    console.log('✅ Package UID:', packageUId);

    // Step 3: Validate schema name (optional - skipping if fails)
    console.log('\n3️⃣ Validating schema name "UsrTestSchema"...');
    try {
      const validateResponse = await axios.post(
        `${CREATIO_URL}/0/rest/ClientUnitSchemaDesignerService/ValidateName`,
        {
          schemaName: 'UsrTestSchema',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookies.join('; '),
            BPMCSRF: csrfToken,
          },
        }
      );

      console.log('Validation result:', validateResponse.data);
      const isAvailable = validateResponse.data?.success && validateResponse.data?.isValid;
      
      if (isAvailable) {
        console.log('✅ Schema name is available');
      } else {
        console.log('⚠️ Schema name is already in use (this is OK for testing)');
      }
    } catch (validationError) {
      console.log('⚠️ Validation endpoint not available, continuing anyway...');
    }

    // Step 4: Create new schema (using correct endpoint without /0/ prefix)
    console.log('\n4️⃣ Creating new AngularSchema...');
    
    const createResponse = await axios.post(
      `${CREATIO_URL}/ServiceModel/ClientUnitSchemaDesignerService.svc/CreateSchema`,
      {
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
        validateStatus: (status) => status < 500, // Accept responses < 500
      }
    );

    console.log('\n📦 Create Schema Response:');
    console.log('Status:', createResponse.status);
    console.log('Headers:', createResponse.headers);
    console.log('Data type:', typeof createResponse.data);
    console.log('Data:', JSON.stringify(createResponse.data, null, 2));

    if (createResponse.data && typeof createResponse.data === 'object' && createResponse.data.schema) {
      const schema = createResponse.data.schema;
      console.log('\n✅ Schema created successfully!');
      console.log('   Schema UID:', schema.uId);
      console.log('   Schema Name:', schema.name);
      console.log('   Schema Type:', schema.schemaType);
      console.log('   Package UID:', schema.packageUId);
      
      // Step 5: Get schema info to verify
      console.log('\n5️⃣ Verifying created schema...');
      const infoResponse = await axios.post(
        `${CREATIO_URL}/ServiceModel/ClientUnitSchemaDesignerService.svc/GetSchemaInfo`,
        {
          schemaUId: schema.uId,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookies.join('; '),
            BPMCSRF: csrfToken,
          },
        }
      );

      if (infoResponse.data?.schemaInfo) {
        console.log('✅ Schema verified:');
        console.log('   Caption:', infoResponse.data.schemaInfo.caption);
        console.log('   Has Body:', !!infoResponse.data.schemaInfo.body);
      }

      console.log('\n🎉 Schema creation test completed successfully!');
      console.log(`\n🔗 View in Creatio: ${CREATIO_URL}/ClientApp/#/SchemaDesigner/${schema.uId}`);
    } else {
      console.error('❌ Schema creation failed');
      console.error('Response:', createResponse.data);
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testSchemaCreation();
