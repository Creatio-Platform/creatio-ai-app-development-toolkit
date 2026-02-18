import axios from 'axios';

const CREATIO_URL = 'http://ts1-infr-web01:88/studioenu_14225044_0218';
const USERNAME = 'Supervisor';
const PASSWORD = 'Supervisor';

async function testCreatioConnection() {
  console.log('Testing Creatio connection...\n');
  console.log('URL:', CREATIO_URL);
  console.log('User:', USERNAME);

  try {
    // Step 1: Login
    console.log('\n1. Attempting login...');
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

    console.log('Login response:', loginResponse.status, loginResponse.data);
    
    if (!loginResponse.data || loginResponse.data.Code !== 0) {
      console.error('❌ Login failed');
      return;
    }
    
    console.log('✅ Login successful');

    // Extract cookies
    const cookies = loginResponse.headers['set-cookie'];
    console.log('\nCookies received:', cookies?.length || 0);

    // Step 2: Get Design Package UID
    console.log('\n2. Getting design package UID...');
    
    const csrfCookie = cookies?.find((c) => c.includes('BPMCSRF='));
    const csrfToken = csrfCookie?.split(';')[0].split('=')[1];
    
    console.log('CSRF Token:', csrfToken ? 'Found' : 'Not found');

    const packageResponse = await axios.post(
      `${CREATIO_URL}/0/ServiceModel/ApplicationPackagesService.svc/GetDesignPackageUId`,
      {
        userLevelSchema: false,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookies.join('; '),
          BPMCSRF: csrfToken || '',
        },
        withCredentials: true,
      }
    );

    console.log('Package response:', packageResponse.status);
    console.log('Package data:', JSON.stringify(packageResponse.data, null, 2));
    
    if (packageResponse.data?.success && packageResponse.data?.uId) {
      console.log('\n✅ Successfully retrieved package UID:', packageResponse.data.uId);
    } else {
      console.log('\n❌ Failed to get package UID');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testCreatioConnection();
