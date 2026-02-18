import axios from 'axios';

const CREATIO_URL = 'http://ts1-infr-web01:88/studioenu_14225044_0218';
const USERNAME = 'Supervisor';
const PASSWORD = 'Supervisor';

async function discoverCreatioServices() {
  console.log('🔍 Discovering Creatio services...\n');

  let cookies = [];
  let csrfToken = '';

  try {
    // Login first
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
      return;
    }
    
    console.log('✅ Authenticated\n');

    cookies = loginResponse.headers['set-cookie'];
    const csrfCookie = cookies?.find((c) => c.includes('BPMCSRF='));
    csrfToken = csrfCookie?.split(';')[0].split('=')[1] || '';

    // Try different service endpoints
    const serviceEndpoints = [
      '/0/ServiceModel/ClientUnitSchemaDesignerService.svc',
      '/ServiceModel/ClientUnitSchemaDesignerService.svc',
      '/0/ServiceModel/SchemaDesignerService.svc',
      '/0/ServiceModel/WorkspaceConsoleService.svc',
      '/0/ServiceModel/ConfigurationService.svc',
      '/0/ServiceModel/PackageService.svc',
      '/0/rest/ClientUnitSchemaDesignerService',
      '/0/DataService/json/reply/SelectQuery',
    ];

    console.log('Testing endpoints:\n');
    
    for (const endpoint of serviceEndpoints) {
      const url = `${CREATIO_URL}${endpoint}`;
      try {
        const response = await axios.get(url, {
          headers: {
            Cookie: cookies.join('; '),
            BPMCSRF: csrfToken,
          },
          timeout: 3000,
          validateStatus: () => true, // Accept all status codes
        });
        
        const status = response.status;
        const available = status !== 404;
        const icon = available ? '✅' : '❌';
        
        console.log(`${icon} ${status} - ${endpoint}`);
        
        if (available && status < 400) {
          console.log(`   Response type: ${response.headers['content-type']}`);
        }
      } catch (error) {
        console.log(`❌ ERR - ${endpoint} (${error.message})`);
      }
    }

    // Try to query available configurations using DataService
    console.log('\n\n2️⃣ Querying system configurations...');
    try {
      const queryResponse = await axios.post(
        `${CREATIO_URL}/0/DataService/json/reply/SelectQuery`,
        {
          RootSchemaName: 'SysPackage',
          OperationType: 0,
          Columns: {
            Items: {
              Name: { Expression: { ColumnPath: 'Name' } },
              UId: { Expression: { ColumnPath: 'UId' } },
              Maintainer: { Expression: { ColumnPath: 'Maintainer' } },
            }
          },
          RowCount: 10,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookies.join('; '),
            BPMCSRF: csrfToken,
          },
        }
      );

      console.log('✅ DataService available!');
      console.log('Sample packages:');
      queryResponse.data.rows?.slice(0, 5).forEach((row) => {
        console.log(`   - ${row.Name} (${row.UId})`);
      });
    } catch (error) {
      console.log('❌ DataService query failed:', error.message);
    }

    // Check Creatio version/info
    console.log('\n\n3️⃣ Checking Creatio version...');
    try {
      const versionResponse = await axios.get(
        `${CREATIO_URL}/ServiceModel/AppInstallerService.svc/GetApplicationInfo`,
        {
          headers: {
            Cookie: cookies.join('; '),
          },
        }
      );
      
      if (versionResponse.data) {
        console.log('✅ Application Info:');
        console.log(JSON.stringify(versionResponse.data, null, 2));
      }
    } catch (error) {
      console.log('❌ Version check failed');
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

discoverCreatioServices();
