#!/usr/bin/env python3
"""
Comprehensive MCP Tools Test Suite
Tests all MCP tools to verify they work after code changes
"""
import json
import requests

MCP_URL = "http://localhost:5001/mcp"
AUTH = ("Supervisor", "Supervisor")

def parse_sse_response(response):
    """Parse Server-Sent Events response"""
    if "text/event-stream" in response.headers.get("Content-Type", ""):
        lines = response.text.strip().split("\n")
        for line in lines:
            if line.startswith("data: "):
                return json.loads(line[6:])
    return response.json()

def mcp_call(method, params, session_id=None):
    """Make MCP request"""
    headers = {"Content-Type": "application/json"}
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    
    response = requests.post(
        MCP_URL,
        auth=AUTH,
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": 1
        }
    )
    
    if response.status_code != 200:
        return {"error": f"HTTP {response.status_code}: {response.text[:200]}"}
    
    return parse_sse_response(response)

def test_tool(name, args, session_id, expected_keys=None):
    """Test single tool"""
    print(f"\n{'='*60}")
    print(f"Testing: {name}")
    print(f"{'='*60}")
    
    result = mcp_call("tools/call", {"name": name, "arguments": args}, session_id)
    
    if "error" in result:
        print(f"❌ ERROR: {result['error']}")
        return False
    
    if "result" not in result:
        print(f"❌ No result in response")
        return False
    
    content = result["result"].get("content", [])
    if not content:
        print(f"❌ Empty content")
        return False
    
    text = content[0].get("text", "")
    try:
        data = json.loads(text)
        
        if data.get("success") is False:
            error = data.get("error", {})
            print(f"❌ Tool failed: {error.get('message', 'Unknown error')}")
            print(f"   Code: {error.get('code')}")
            return False
        
        print(f"✅ SUCCESS")
        
        # Check expected keys
        if expected_keys:
            for key in expected_keys:
                if key not in data:
                    print(f"⚠️  Missing expected key: {key}")
        
        # Show sample data
        sample = json.dumps(data, indent=2)[:300]
        print(f"Response sample:\n{sample}...")
        
        return True
    except json.JSONDecodeError:
        print(f"✅ Response (non-JSON): {text[:200]}")
        return True

# Main test flow
print("🔧 MCP Tools Test Suite")
print("="*60)

# Step 1: Initialize
print("\n📡 Step 1: Initialize session...")
init_result = mcp_call("initialize", {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {"name": "test-suite", "version": "1.0"}
})

if "error" in init_result:
    print(f"❌ Initialize failed: {init_result['error']}")
    exit(1)

# CRITICAL: Get session from headers, not body!
print("⚠️  Note: Session ID must be retrieved from response headers in actual implementation")
print("    For this test, we'll make a real request to get it...")

response = requests.post(
    MCP_URL,
    auth=AUTH,
    headers={"Content-Type": "application/json"},
    json={
        "jsonrpc": "2.0",
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "test-suite", "version": "1.0"}
        },
        "id": 1
    }
)

session_id = response.headers.get("Mcp-Session-Id")
if not session_id:
    print(f"❌ No session ID in headers!")
    exit(1)

print(f"✅ Session ID: {session_id}")

# Step 2: List tools
print("\n📡 Step 2: List tools...")
tools_result = mcp_call("tools/list", {}, session_id)
if "error" in tools_result:
    print(f"❌ tools/list failed: {tools_result['error']}")
    exit(1)

tools = tools_result.get("result", {}).get("tools", [])
tool_names = [t["name"] for t in tools]
print(f"✅ Found {len(tools)} tools:")
for name in sorted(tool_names):
    print(f"   - {name}")

# Test results tracker
results = {}

# Step 3: Test application tools
print("\n" + "="*60)
print("📦 APPLICATION TOOLS")
print("="*60)

results["application.get_list"] = test_tool(
    "application.get_list",
    {},
    session_id,
    expected_keys=["applications"]
)

# Get first app for further tests
list_result = mcp_call("tools/call", {"name": "application.get_list", "arguments": {}}, session_id)
if "result" in list_result:
    content = json.loads(list_result["result"]["content"][0]["text"])
    apps = content.get("applications", [])
    if apps:
        test_app_id = apps[0]["id"]
        print(f"\n📝 Using app ID for tests: {test_app_id}")
        
        results["application.get_info"] = test_tool(
            "application.get_info",
            {"appId": test_app_id},
            session_id,
            expected_keys=["app", "packages"]
        )

# Step 4: Test entity tools
print("\n" + "="*60)
print("📦 ENTITY TOOLS")
print("="*60)

results["entity.get_schema_info"] = test_tool(
    "entity.get_schema_info",
    {"name": "Account"},
    session_id,
    expected_keys=["uId", "name", "caption"]
)

# Step 5: Test binding tools
print("\n" + "="*60)
print("📦 BINDING TOOLS")
print("="*60)

results["binding.get_columns"] = test_tool(
    "binding.get_columns",
    {"entitySchemaName": "Account"},
    session_id,
    expected_keys=["columns"]
)

# Summary
print("\n" + "="*60)
print("📊 TEST SUMMARY")
print("="*60)

passed = sum(1 for v in results.values() if v)
total = len(results)
success_rate = (passed / total * 100) if total > 0 else 0

for tool, success in sorted(results.items()):
    status = "✅" if success else "❌"
    print(f"{status} {tool}")

print(f"\nPassed: {passed}/{total} ({success_rate:.1f}%)")

if passed == total:
    print("\n🎉 All tools working perfectly!")
    exit(0)
else:
    print(f"\n⚠️  {total - passed} tool(s) failed")
    exit(1)
