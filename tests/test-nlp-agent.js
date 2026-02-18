#!/usr/bin/env node

/**
 * Test Natural Language Processing Agent for Creatio Schema Creation
 * 
 * This test validates that the LLM-powered agent correctly:
 * 1. Interprets natural language commands (Ukrainian/English)
 * 2. Creates schemas when requested
 * 3. Rejects unsupported operations
 * 4. Handles various command formats
 */

const API_URL = 'http://localhost:3000/agent/creatio';

/**
 * Send command to NLP agent
 */
async function sendCommand(text) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('❌ Request failed:', error.message);
    throw error;
  }
}

/**
 * Test cases
 */
const tests = [
  {
    name: 'Create schema with explicit name (Ukrainian)',
    command: 'створи схему з назвою TestCustomerPage',
    expectSuccess: true,
    expectOperation: 'create_schema',
  },
  {
    name: 'Create schema with explicit name (English)',
    command: 'create schema named OrderForm',
    expectSuccess: true,
    expectOperation: 'create_schema',
  },
  {
    name: 'Natural language request (no explicit name)',
    command: 'мені потрібна нова сторінка для контактів',
    expectSuccess: true,
    expectOperation: 'create_schema',
  },
  {
    name: 'Unsupported operation - delete',
    command: 'видали схему TestPage',
    expectSuccess: false,
    expectOperation: 'not_supported',
  },
  {
    name: 'Unsupported operation - modify code',
    command: 'зміни код схеми AccountPage',
    expectSuccess: false,
    expectOperation: 'not_supported',
  },
  {
    name: 'Simple command',
    command: 'зроби схему TestDemo',
    expectSuccess: true,
    expectOperation: 'create_schema',
  },
];

/**
 * Run tests
 */
async function runTests() {
  console.log('🧪 Testing NLP Agent for Creatio\n');
  console.log(`Endpoint: ${API_URL}\n`);

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    console.log(`\n📋 Test: ${test.name}`);
    console.log(`   Command: "${test.command}"`);

    try {
      const result = await sendCommand(test.command);

      // Validate result structure
      if (!result.hasOwnProperty('success')) {
        throw new Error('Response missing "success" field');
      }

      // Check expected success
      if (result.success !== test.expectSuccess) {
        throw new Error(
          `Expected success=${test.expectSuccess}, got ${result.success}`
        );
      }

      // Check expected operation (if specified)
      if (test.expectOperation && result.operation !== test.expectOperation) {
        throw new Error(
          `Expected operation=${test.expectOperation}, got ${result.operation}`
        );
      }

      // For successful schema creation, validate required fields
      if (result.success && result.operation === 'create_schema') {
        if (!result.schemaUId || !result.schemaName) {
          throw new Error('Missing schemaUId or schemaName in successful response');
        }

        console.log(`   ✅ PASSED`);
        console.log(`      Created: ${result.schemaName}`);
        console.log(`      GUID: ${result.schemaUId}`);
        if (result.creatio_url) {
          console.log(`      URL: ${result.creatio_url}`);
        }
      } else {
        console.log(`   ✅ PASSED`);
        console.log(`      Message: ${result.message}`);
      }

      passed++;
    } catch (error) {
      console.log(`   ❌ FAILED: ${error.message}`);
      failed++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
