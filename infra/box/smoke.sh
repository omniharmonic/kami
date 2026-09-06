#!/usr/bin/env bash
# smoke.sh — the box smoke test (architecture §12.5 step 5; plan T0.2 tests). Run after every reboot, twice.
#
#   1. guard:   POST the gate with a fabricated tool result (15.4 cfs) and a reply forced to contain a number
#               that is NOT in it (30%) → the sentence with 30% must be gone and the gate line present.
#   2. context: a ~60k-token prompt against vLLM directly → 200 and a non-empty completion (64k context).
#   3. tools:   a tool schema + enable_thinking → a well-formed tool_calls entry (the vllm#42021 check;
#               record the answer in the README table).
#   4. pulse:   `hermes cron run pulse --profile <slug>` (*verify* the subcommand) → prints a wakeAgent line.
#
# Env: GATE_URL (default http://127.0.0.1:8001), VLLM_URL (default http://127.0.0.1:8000), SLUG (boulder-creek),
#      MODEL (qwen3.5-9b), HERMES_CMD (default: docker compose exec -T hermes hermes), SKIP_PULSE=1 to skip 4.
set -euo pipefail

GATE_URL="${GATE_URL:-http://127.0.0.1:8001}"
VLLM_URL="${VLLM_URL:-http://127.0.0.1:8000}"
SLUG="${SLUG:-boulder-creek}"
MODEL="${MODEL:-qwen3.5-9b}"
HERE="$(cd "$(dirname "$0")" && pwd)"
HERMES_CMD="${HERMES_CMD:-docker compose -f $HERE/docker-compose.yml exec -T hermes hermes}"
GATE_LINE="I dropped a sentence because it contained something I hadn't measured."
FAIL=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAIL=1; }
need() { command -v "$1" >/dev/null || { echo "missing $1" >&2; exit 1; }; }
need curl; need python3

echo "== 1. guard: fabricated tool result + wrong number → sentence dropped, gate line present"
GUARD_BODY=$(python3 - "$MODEL" <<'PY'
import json, sys
model = sys.argv[1]
tool_result = {"as_of": "2026-09-06T12:00:00Z", "needs": [{"need": "flow", "property": "discharge",
  "place_id": "place/boulder-creek-near-orodell-co", "value": 15.4, "unit": "[ft_i]3/s",
  "time": "2026-09-04T20:15:00Z", "source_id": "cdss.telemetry", "stale": True, "staleness_s": 118000,
  "source_status": "ok", "label": "15.4 cfs at Orodell, 2026-09-04 20:15Z, stale"}]}
print(json.dumps({
  "model": model, "stream": False, "max_tokens": 120, "temperature": 0,
  "messages": [
    {"role": "system", "content": "You are an AI voice for Boulder Creek. Repeat the user's text exactly."},
    {"role": "user", "content": "What is the flow?"},
    {"role": "assistant", "content": None, "tool_calls": [{"id": "call_1", "type": "function",
       "function": {"name": "get_entity_status", "arguments": "{}"}}]},
    {"role": "tool", "tool_call_id": "call_1", "content": json.dumps(tool_result)},
    {"role": "user", "content": "Repeat exactly, nothing else: Flow at Orodell is 15.4 cfs, the last reading I have. That is about 30% below normal for September."}
  ]}))
PY
)
GUARD_RESP=$(curl -sS -m 120 -H 'Content-Type: application/json' -d "$GUARD_BODY" "$GATE_URL/p/$SLUG/v1/chat/completions" || true)
python3 - "$GUARD_RESP" "$GATE_LINE" <<'PY' && pass "guard dropped the unmeasured sentence and appended the gate line" || fail "guard: see response above"
import json, sys
raw, gate_line = sys.argv[1], sys.argv[2]
try:
    data = json.loads(raw)
    text = data["choices"][0]["message"]["content"] or ""
except Exception as e:
    print("   unparseable gate response:", raw[:400], e); sys.exit(1)
print("   reply:", text.replace("\n", " ")[:300])
ok = ("30%" not in text and "30 %" not in text) and (gate_line in text)
if "15.4" not in text: print("   note: the measured sentence was dropped too — check the atom matcher")
sys.exit(0 if ok else 1)
PY

echo "== 2. 64k context: ~60k-token prompt against vLLM"
CTX_BODY=$(python3 - "$MODEL" <<'PY'
import json, sys
filler = ("the creek runs past the gauge and the gauge counts the water " * 5200)  # ~60k tokens of prose
print(json.dumps({"model": sys.argv[1], "stream": False, "max_tokens": 16, "temperature": 0,
  "messages": [{"role": "user", "content": filler + "\n\nReply with the single word OK."}]}))
PY
)
CTX_CODE=$(printf '%s' "$CTX_BODY" | curl -sS -m 600 -o /tmp/kami-smoke-ctx.json -w '%{http_code}' -H 'Content-Type: application/json' -d @- "$VLLM_URL/v1/chat/completions" || echo 000)
if [ "$CTX_CODE" = 200 ] && python3 -c "import json,sys; d=json.load(open('/tmp/kami-smoke-ctx.json')); assert d['choices'][0]['message']['content'].strip(); print('   prompt_tokens =', d['usage']['prompt_tokens'])"; then
  pass "64k-context completion"
else
  fail "64k-context completion (HTTP $CTX_CODE) — check --max-model-len and the KV budget"
fi

echo "== 3. tool call with thinking enabled (vllm#42021)"
TOOL_BODY=$(python3 - "$MODEL" <<'PY'
import json, sys
print(json.dumps({"model": sys.argv[1], "stream": False, "max_tokens": 256, "temperature": 0,
  "chat_template_kwargs": {"enable_thinking": True},
  "tools": [{"type": "function", "function": {"name": "get_entity_status",
     "description": "Current readings for the entity's member places.",
     "parameters": {"type": "object", "properties": {"entity": {"type": "string"}}, "required": []}}}],
  "tool_choice": "auto",
  "messages": [{"role": "system", "content": "Call get_entity_status before answering anything about readings."},
               {"role": "user", "content": "How is the creek right now?"}]}))
PY
)
TOOL_RESP=$(curl -sS -m 120 -H 'Content-Type: application/json' -d "$TOOL_BODY" "$VLLM_URL/v1/chat/completions" || true)
python3 - "$TOOL_RESP" <<'PY' && pass "well-formed <tool_call> parsed with the hermes parser + qwen3 reasoning parser" || fail "tool call did not parse — record in README table; try without --reasoning-parser (T0.2 step 4)"
import json, sys
try:
    d = json.loads(sys.argv[1]); m = d["choices"][0]["message"]
    tc = m.get("tool_calls") or []
    assert tc and tc[0]["function"]["name"] == "get_entity_status"
    json.loads(tc[0]["function"]["arguments"] or "{}")
    print("   tool_calls:", json.dumps(tc)[:200], "| reasoning present:", bool(m.get("reasoning_content") or m.get("reasoning")))
except Exception as e:
    print("   ", sys.argv[1][:400], e); sys.exit(1)
PY

if [ "${SKIP_PULSE:-0}" != 1 ]; then
  echo "== 4. one pulse: $HERMES_CMD cron run pulse --profile $SLUG   (*verify* subcommand)"
  if OUT=$($HERMES_CMD cron run pulse --profile "$SLUG" 2>&1); then
    echo "$OUT" | tail -5 | sed 's/^/   /'
    echo "$OUT" | grep -q 'wakeAgent' && pass "pulse ran; precheck printed a wakeAgent decision" || fail "pulse ran but no wakeAgent line — is the pre-script wired?"
  else
    echo "$OUT" | tail -5 | sed 's/^/   /'; fail "hermes cron run pulse"
  fi
fi

[ "$FAIL" = 0 ] && echo "SMOKE OK" || { echo "SMOKE FAILED"; exit 1; }
