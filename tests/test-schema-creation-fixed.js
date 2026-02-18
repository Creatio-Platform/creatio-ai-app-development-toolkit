import axios from 'axios';

const CREATIO_URL = 'http://ts1-infr-web01:88/studioenu_14225044_0218';
const USERNAME = 'Supervisor';
const PASSWORD = 'Supervisor';

async function testSchemaCreation() {
  console.log('🧪 Testing Creatio Schema Creation (FIXED)\n');
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

    // Step 3: Create new schema using CORRECT endpoint (without /0/)
    console.log('\n3️⃣ Creating new schema with CreateNewSchema...');
    const createResponse = await axios.post(
      `${CREATIO_URL}/0/ServiceModel/ClientUnitSchemaDesignerService.svc/CreateNewSchema`,
      {
        packageUId: packageUId,
        schemaType: 9, // 9 = AngularSchema (ClientUnit)
        userLevelSchema: false,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookies.join('; '),
          BPMCSRF: csrfToken,
        },
      }
    );

    console.log('\n📦 CreateNewSchema Response:');
    console.log('Success:', createResponse.data?.success);
    
    if (!createResponse.data?.success || !createResponse.data?.schema) {
      console.error('❌ Schema creation failed');
      console.error('Response:', JSON.stringify(createResponse.data, null, 2));
      return;
    }

    const schema = createResponse.data.schema;
    console.log('✅ Schema created!');
    console.log('   Schema UID:', schema.uId);
    console.log('   Schema Name:', schema.name);
    console.log('   Schema Type:', schema.schemaType);

    // Step 4: Apply parent schema (BasePageFreedomTemplate)
    console.log('\n4️⃣ Applying parent schema (BasePageFreedomTemplate)...');
    const parentUId = 'ec5fd902-66ce-4139-a241-10ebd8addc40'; // BasePageFreedomTemplate

    const applyParentResponse = await axios.post(
      `${CREATIO_URL}/0/ServiceModel/ClientUnitSchemaDesignerService.svc/ApplyParent`,
      {
        newParentUid: parentUId,
        clientUnitSchema: schema,
        userLevelSchema: false,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookies.join('; '),
          BPMCSRF: csrfToken,
        },
      }
    );

    console.log('Apply Parent Success:', applyParentResponse.data?.success);
    
    if (!applyParentResponse.data?.success) {
      console.error('❌ Failed to apply parent');
      console.error('Response:', applyParentResponse.data);
      return;
    }

    const schemaWithParent = applyParentResponse.data.schema;
    console.log('✅ Parent applied successfully!');
    console.log('   Parent Name:', schemaWithParent.parent?.name);
    console.log('   Parent UID:', schemaWithParent.parent?.uId);

    // Step 5: Check unique name
    console.log('\n5️⃣ Checking schema name uniqueness...');
    const checkNameResponse = await axios.post(
      `${CREATIO_URL}/0/ServiceModel/ClientUnitSchemaDesignerService.svc/CheckUniqueSchemaName`,
      {
        schemaName: schemaWithParent.name,
        packageUId: packageUId,
        schemaUId: schemaWithParent.uId,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookies.join('; '),
          BPMCSRF: csrfToken,
        },
      }
    );

    console.log('Name check:', checkNameResponse.data?.success ? '✅ Unique' : '⚠️ Not unique');

    // Step 6: Save schema
    console.log('\n6️⃣ Saving schema...');
    
    // Generate simple schema body
    schemaWithParent.body = `define("${schemaWithParent.name}", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, function/**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/ {
\treturn {
\t\tviewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[]/**SCHEMA_VIEW_CONFIG_DIFF*/,
\t\tviewModelConfigDiff: /**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/[]/**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/,
\t\tmodelConfigDiff: /**SCHEMA_MODEL_CONFIG_DIFF*/[
\t\t\t{
\t\t\t\t"operation": "merge",
\t\t\t\t"path": [],
\t\t\t\t"values": {
\t\t\t\t\t"dataSources": {}
\t\t\t\t}
\t\t\t}
\t\t]/**SCHEMA_MODEL_CONFIG_DIFF*/,
\t\thandlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
\t\tconverters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/,
\t\tvalidators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/
\t};
});`;

    schemaWithParent.caption = [{ cultureName: 'en-US', value: 'Test Page Created by API' }];

    const saveResponse = await axios.post(
      `${CREATIO_URL}/0/ServiceModel/ClientUnitSchemaDesignerService.svc/SaveSchema`,
      schemaWithParent,
      {
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookies.join('; '),
          BPMCSRF: csrfToken,
        },
      }
    );

    console.log('Save result:', saveResponse.data?.success ? '✅ Saved' : '❌ Failed');
    
    if (saveResponse.data?.success) {
      console.log('\n🎉 Schema creation completed successfully!');
      console.log('\n📋 Summary:');
      console.log('   Schema UID:', schemaWithParent.uId);
      console.log('   Schema Name:', schemaWithParent.name);
      console.log('   Schema Type:', schemaWithParent.schemaType);
      console.log('   Parent:', schemaWithParent.parent?.name);
      console.log('   Package:', schemaWithParent.package?.name);
      console.log(`\n🔗 View in Creatio: ${CREATIO_URL}/0/ClientApp/#/SchemaDesigner/${schemaWithParent.uId}`);
    } else {
      console.error('❌ Save failed');
      console.error('Errors:', saveResponse.data?.errors);
      console.error('Validation errors:', saveResponse.data?.validationErrors);
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
