#!/bin/bash
# A2A Protocol Error/Exception E2E Test Suite
# Tests all error handling paths in both JSON-RPC and REST endpoints

BASE_URL="http://localhost:4936"
VALID_AGENT_ID="0b7c73cb-0f69-48e5-a5be-49ba3dd4573c"
VALID_API_KEY="agt_proj_dc709015_3a9361ccef8754c5f1385b292cd028ec"
FAKE_AGENT_ID="00000000-0000-0000-0000-000000000000"
FAKE_API_KEY="agt_proj_fake_0000000000000000000000000000"
FAKE_TASK_ID="99999999-9999-9999-9999-999999999999"

PASS=0
FAIL=0
TOTAL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

run_test() {
  local test_name="$1"
  local expected_http="$2"
  local expected_pattern="$3"
  local curl_args=("${@:4}")

  TOTAL=$((TOTAL + 1))
  printf "${CYAN}[TEST %02d] %s${NC}\n" "$TOTAL" "$test_name"

  RESPONSE=$(curl -s -w "\n%{http_code}" "${curl_args[@]}" 2>&1)
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  local status="PASS"
  local details=""

  if [ "$HTTP_CODE" != "$expected_http" ]; then
    status="FAIL"
    details="Expected HTTP $expected_http, got $HTTP_CODE"
  fi

  if [ -n "$expected_pattern" ] && ! echo "$BODY" | grep -qF -- "$expected_pattern"; then
    status="FAIL"
    details="${details:+$details; }Expected pattern '$expected_pattern' not found in response"
  fi

  if [ "$status" = "PASS" ]; then
    PASS=$((PASS + 1))
    printf "  ${GREEN}✓ PASS${NC} (HTTP %s)\n" "$HTTP_CODE"
  else
    FAIL=$((FAIL + 1))
    printf "  ${RED}✗ FAIL${NC} — %s\n" "$details"
  fi
  printf "  Response: %.200s\n\n" "$BODY"
}

echo "============================================================"
echo "  A2A Protocol — Error/Exception E2E Test Suite"
echo "  Target: $BASE_URL"
echo "  Agent:  $VALID_AGENT_ID"
echo "============================================================"
echo ""

# ============================================================
# Category 1: Authentication Errors
# ============================================================
printf "${YELLOW}═══ Category 1: Authentication Errors ═══${NC}\n\n"

run_test "Missing Authorization header" "401" "MISSING_AUTH_HEADER" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"parts":[{"type":"text","text":"hello"}]}}}'

run_test "Invalid Authorization format (not Bearer)" "401" "INVALID_AUTH_FORMAT" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic dXNlcjpwYXNz" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"parts":[{"type":"text","text":"hello"}]}}}'

run_test "Empty API key (Bearer with no key)" "401" "EMPTY_API_KEY" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer " \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"parts":[{"type":"text","text":"hello"}]}}}'

run_test "Invalid API key" "401" "INVALID_API_KEY" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FAKE_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"parts":[{"type":"text","text":"hello"}]}}}'

# ============================================================
# Category 2: Agent ID Errors
# ============================================================
printf "${YELLOW}═══ Category 2: Agent ID Errors ═══${NC}\n\n"

run_test "Non-existent Agent ID" "404" "AGENT_NOT_FOUND" \
  -X POST "$BASE_URL/a2a/$FAKE_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"parts":[{"type":"text","text":"hello"}]}}}'

run_test "Malformed Agent ID (not UUID)" "404" "AGENT_NOT_FOUND" \
  -X POST "$BASE_URL/a2a/not-a-valid-uuid" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"parts":[{"type":"text","text":"hello"}]}}}'

run_test "Empty Agent ID segment" "404" "" \
  -X POST "$BASE_URL/a2a/" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":"hello"}}'

# ============================================================
# Category 3: JSON-RPC Format Errors
# ============================================================
printf "${YELLOW}═══ Category 3: JSON-RPC Format Errors ═══${NC}\n\n"

run_test "Missing jsonrpc field" "400" "-32600" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"id":"1","method":"message/send","params":{"message":"hello"}}'

run_test "Wrong jsonrpc version (1.0)" "400" "-32600" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"1.0","id":"1","method":"message/send","params":{"message":"hello"}}'

run_test "Unsupported method" "200" "-32601" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"nonexistent/method","params":{}}'

run_test "Empty method field" "200" "-32601" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"","params":{}}'

run_test "Null method field" "200" "-32601" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":null,"params":{}}'

run_test "Missing id field (notification style)" "200" "" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","method":"message/send","params":{"message":{"parts":[{"type":"text","text":"hello"}]}}}'

# ============================================================
# Category 4: message/send Parameter Errors
# ============================================================
printf "${YELLOW}═══ Category 4: message/send Parameter Errors ═══${NC}\n\n"

run_test "message/send: missing params" "200" "-32602" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send"}'

run_test "message/send: null params" "200" "-32602" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":null}'

run_test "message/send: empty params object" "200" "-32602" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{}}'

run_test "message/send: message is empty string" "200" "-32602" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":""}}'

run_test "message/send: message object with empty parts" "200" "-32602" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"parts":[]}}}'

run_test "message/send: message object with non-text parts only" "200" "-32602" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"parts":[{"type":"image","data":"base64data"}]}}}'

run_test "message/send: params is a string instead of object" "200" "-32602" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":"hello"}'

# ============================================================
# Category 5: message/stream Parameter Errors
# ============================================================
printf "${YELLOW}═══ Category 5: message/stream Parameter Errors ═══${NC}\n\n"

run_test "message/stream: missing message" "200" "-32602" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/stream","params":{}}'

run_test "message/stream: empty message string" "200" "-32602" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/stream","params":{"message":""}}'

run_test "message/stream: null params" "200" "-32602" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/stream","params":null}'

# ============================================================
# Category 6: tasks/get Errors
# ============================================================
printf "${YELLOW}═══ Category 6: tasks/get Errors ═══${NC}\n\n"

run_test "tasks/get: missing taskId" "200" "-32602" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tasks/get","params":{}}'

run_test "tasks/get: non-existent taskId" "200" "-32001" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tasks/get","params":{"id":"'"$FAKE_TASK_ID"'"}}'

run_test "tasks/get: null taskId" "200" "-32602" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tasks/get","params":{"id":null}}'

run_test "tasks/get: empty string taskId" "200" "-32602" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tasks/get","params":{"id":""}}'

# ============================================================
# Category 7: tasks/cancel Errors
# ============================================================
printf "${YELLOW}═══ Category 7: tasks/cancel Errors ═══${NC}\n\n"

run_test "tasks/cancel: missing taskId" "200" "-32602" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tasks/cancel","params":{}}'

run_test "tasks/cancel: non-existent taskId" "200" "-32001" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tasks/cancel","params":{"id":"'"$FAKE_TASK_ID"'"}}'

# ============================================================
# Category 8: Request Body Errors
# ============================================================
printf "${YELLOW}═══ Category 8: Request Body Errors ═══${NC}\n\n"

run_test "Empty request body" "400" "" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d ''

run_test "Invalid JSON body" "400" "" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{invalid json!!!'

run_test "Body is a JSON array" "400" "-32600" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '[{"jsonrpc":"2.0","id":"1","method":"message/send","params":{}}]'

run_test "Body is a JSON number" "400" "-32600" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '42'

run_test "Wrong Content-Type (text/plain)" "400" "" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: text/plain" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":"hello"}}'

# ============================================================
# Category 9: REST Endpoint Errors (non-JSON-RPC paths)
# ============================================================
printf "${YELLOW}═══ Category 9: REST Endpoint Errors ═══${NC}\n\n"

run_test "REST POST /messages: missing auth" "401" "MISSING_AUTH_HEADER" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID/messages" \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'

run_test "REST POST /messages: invalid API key" "401" "INVALID_API_KEY" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FAKE_API_KEY" \
  -d '{"message":"hello"}'

run_test "REST POST /messages: empty message body" "400" "VALIDATION_ERROR" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{}'

run_test "REST POST /messages: message too long (>10000 chars)" "400" "VALIDATION_ERROR" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d "{\"message\":\"$(python3 -c "print('A' * 10001)")\"}"

run_test "REST GET /tasks/nonexistent: task not found" "404" "TASK_NOT_FOUND" \
  -X GET "$BASE_URL/a2a/$VALID_AGENT_ID/tasks/$FAKE_TASK_ID" \
  -H "Authorization: Bearer $VALID_API_KEY"

run_test "REST DELETE /tasks/nonexistent: task not found" "404" "TASK_NOT_FOUND" \
  -X DELETE "$BASE_URL/a2a/$VALID_AGENT_ID/tasks/$FAKE_TASK_ID" \
  -H "Authorization: Bearer $VALID_API_KEY"

# ============================================================
# Category 10: Agent Card Endpoints
# ============================================================
printf "${YELLOW}═══ Category 10: Agent Card Endpoints ═══${NC}\n\n"

run_test "Agent card: no auth" "401" "MISSING_AUTH_HEADER" \
  -X GET "$BASE_URL/a2a/$VALID_AGENT_ID/.well-known/agent.json"

run_test "Agent card: invalid agent ID" "404" "AGENT_NOT_FOUND" \
  -X GET "$BASE_URL/a2a/$FAKE_AGENT_ID/.well-known/agent.json" \
  -H "Authorization: Bearer $VALID_API_KEY"

run_test "Agent card (REST): no auth" "401" "MISSING_AUTH_HEADER" \
  -X GET "$BASE_URL/a2a/$VALID_AGENT_ID/.well-known/agent-card.json"

run_test "Agent card (REST): valid request should succeed" "200" "name" \
  -X GET "$BASE_URL/a2a/$VALID_AGENT_ID/.well-known/agent-card.json" \
  -H "Authorization: Bearer $VALID_API_KEY"

# ============================================================
# Category 11: HTTP Method Errors
# ============================================================
printf "${YELLOW}═══ Category 11: HTTP Method Errors ═══${NC}\n\n"

run_test "GET on JSON-RPC endpoint (should be POST)" "404" "" \
  -X GET "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Authorization: Bearer $VALID_API_KEY"

run_test "PUT on JSON-RPC endpoint" "404" "" \
  -X PUT "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":"hello"}}'

run_test "DELETE on JSON-RPC endpoint" "404" "" \
  -X DELETE "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Authorization: Bearer $VALID_API_KEY"

# ============================================================
# Category 12: Edge Cases
# ============================================================
printf "${YELLOW}═══ Category 12: Edge Cases ═══${NC}\n\n"

run_test "JSON-RPC with numeric id" "200" "-32601" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":42,"method":"unknown/method","params":{}}'

run_test "JSON-RPC with null id" "200" "-32601" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":null,"method":"unknown/method","params":{}}'

run_test "Very long method name" "200" "-32601" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"'"$(python3 -c "print('a' * 1000)")"'","params":{}}'

run_test "Special chars in message (SQL injection attempt)" "200" "" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tasks/get","params":{"id":"'\''; DROP TABLE tasks; --"}}'

run_test "Unicode in message params" "200" "" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tasks/get","params":{"id":"中文测试🎉"}}'

run_test "Extremely nested JSON" "200" "" \
  -X POST "$BASE_URL/a2a/$VALID_AGENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_API_KEY" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"parts":[{"type":"text","text":"test","meta":{"a":{"b":{"c":{"d":{"e":"deep"}}}}}}]}}}'

# ============================================================
# Summary
# ============================================================
echo ""
echo "============================================================"
echo "  Test Summary"
echo "============================================================"
printf "  Total:  %d\n" "$TOTAL"
printf "  ${GREEN}Passed: %d${NC}\n" "$PASS"
printf "  ${RED}Failed: %d${NC}\n" "$FAIL"
echo "============================================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
else
  exit 0
fi
