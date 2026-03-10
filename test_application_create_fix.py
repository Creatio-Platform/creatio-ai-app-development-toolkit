#!/usr/bin/env python3
import json
import requests

MCP_URL = "http://localhost:5001/mcp"
AUTH = ("Supervisor", "Supervisor")

print("🔧 Testing application.create fix...")
print("=" * 60)

# Step 1: Initialize
print("\n📡 Step 1: Initialize MCP session...")
init_response = requests.post(
    MCP_URL,
    auth=AUTH,
    headers={"Content-Type": "application/json"},
    json={
        "jsonrpc": "2.0",
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "test-client", "version": "1.0"}
        },
        "id": 1
    }
)

if init_response.status_code != 200:
    print(f"❌ Initialize failed: {init_response.status_code}")
    print(init_response.text)
    exit(1)

session_id = init_response.headers.get("Mcp-Session-Id")
print(f"✅ Session ID: {session_id}")

# Step 2: tools/list
print("\n📡 Step 2: List tools...")
tools_response = requests.post(
    MCP_URL,
    auth=AUTH,
    headers={
        "Content-Type": "application/json",
        "Mcp-Session-Id": session_id
    },
    json={
        "jsonrpc": "2.0",
        "method": "tools/list",
        "params": {},
        "id": 2
    }
)

print(f"Status code: {tools_response.status_code}")
print(f"Content-Type: {tools_response.headers.get('Content-Type')}")
print(f"Raw content (first 500 chars): {tools_response.text[:500]}")

# Parse SSE stream
if "text/event-stream" in tools_response.headers.get("Content-Type", ""):
    lines = tools_response.text.strip().split("\n")
    json_data = ""
    for line in lines:
        if line.startswith("data: "):
            json_data = line[6:]  # Remove "data: " prefix
            break
    tools_data = json.loads(json_data)
else:
    tools_data = tools_response.json()

if "result" in tools_data:
    tool_names = [t["name"] for t in tools_data["result"]["tools"]]
    print(f"✅ Found {len(tool_names)} tools")
    if "application.create" in tool_names:
        print("✅ application.create tool found!")
    else:
        print("❌ application.create tool NOT found!")
        exit(1)
else:
    print(f"❌ Failed to list tools: {tools_data}")
    exit(1)

# Step 3: application.create
print("\n📡 Step 3: Call application.create...")
create_response = requests.post(
    MCP_URL,
    auth=AUTH,
    headers={
        "Content-Type": "application/json",
        "Mcp-Session-Id": session_id
    },
    json={
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "application.create",
            "arguments": {
                "name": "Identity Name Test",
                "code": "UsrIdentityNameTest",
                "description": "Testing CurrentWebOperationIdentityName fix",
                "templateCode": "AppFreedomUIv2",
                "iconBackground": "#0052CC"
            }
        },
        "id": 3
    }
)

print(f"Status code: {create_response.status_code}")
print(f"Content-Type: {create_response.headers.get('Content-Type')}")

# Parse SSE stream
if "text/event-stream" in create_response.headers.get("Content-Type", ""):
    lines = create_response.text.strip().split("\n")
    json_data = ""
    for line in lines:
        if line.startswith("data: "):
            json_data = line[6:]  # Remove "data: " prefix
            break
    result_data = json.loads(json_data)
else:
    result_data = create_response.json()

print(f"\n📄 Response:")
print(json.dumps(result_data, indent=2))

if "error" in result_data:
    print(f"\n❌ ERROR: {result_data['error']}")
    if "AUTH_REQUIRED" in str(result_data):
        print("⚠️  This means RequestUserConnection is null!")
    exit(1)

if "result" in result_data:
    content = result_data["result"]["content"]
    if isinstance(content, list) and len(content) > 0:
        text_content = content[0].get("text", "")
        response_obj = json.loads(text_content)
        
        print("\n✅ SUCCESS!")
        print(f"Application ID: {response_obj.get('application_id')}")
        print(f"Success: {response_obj.get('success')}")
        print(f"Message: {response_obj.get('message')}")
    else:
        print("⚠️  Unexpected response structure")
else:
    print("❌ No result in response")
    exit(1)

print("\n" + "=" * 60)
print("✅ Test completed successfully!")
