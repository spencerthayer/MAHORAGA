#!/usr/bin/env bash
# ============================================================================
# list-models.sh — Fetch all OpenRouter models and output sorted JSON by cost
#
# Usage:
#   ./scripts/list-models.sh                  # uses key from .dev.vars
#   OPENAI_API_KEY=sk-or-... ./scripts/list-models.sh   # explicit key
#
# Output: scripts/openrouter-models.json
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_FILE="$SCRIPT_DIR/openrouter-models.json"

# ---------------------------------------------------------------------------
# 1. Resolve API key (env var > .dev.vars)
# ---------------------------------------------------------------------------
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  DEV_VARS="$PROJECT_ROOT/.dev.vars"
  if [[ -f "$DEV_VARS" ]]; then
    OPENAI_API_KEY="$(grep -E '^OPENAI_API_KEY=' "$DEV_VARS" | head -1 | cut -d'=' -f2-)"
  fi
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "❌ No API key found. Set OPENAI_API_KEY or add it to .dev.vars" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Fetch models from OpenRouter
# ---------------------------------------------------------------------------
echo "Fetching models from OpenRouter..."

RAW_JSON=$(curl -s https://openrouter.ai/api/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY")

# Verify we got valid data
MODEL_COUNT=$(echo "$RAW_JSON" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null || echo "0")

if [[ "$MODEL_COUNT" == "0" ]]; then
  echo "❌ Failed to fetch models or empty response." >&2
  echo "$RAW_JSON" | head -5 >&2
  exit 1
fi

echo "Received $MODEL_COUNT models. Processing..."

# ---------------------------------------------------------------------------
# 3. Transform, sort by cost (prompt + completion), and write JSON
# ---------------------------------------------------------------------------
echo "$RAW_JSON" | python3 -c "
import json, sys
from datetime import datetime, timezone

data = json.load(sys.stdin)
models = data.get('data', [])

results = []
for m in models:
    pricing = m.get('pricing') or {}

    # Parse costs (per token, in USD)
    prompt_cost     = float(pricing.get('prompt', '0') or '0')
    completion_cost = float(pricing.get('completion', '0') or '0')
    request_cost    = float(pricing.get('request', '0') or '0')
    image_cost      = float(pricing.get('image', '0') or '0')

    # Combined cost metric: average of prompt + completion per token
    combined_cost = prompt_cost + completion_cost

    # Costs expressed per 1M tokens for readability
    prompt_per_m     = prompt_cost * 1_000_000
    completion_per_m = completion_cost * 1_000_000
    combined_per_m   = combined_cost * 1_000_000

    arch = m.get('architecture') or {}
    top  = m.get('top_provider') or {}

    results.append({
        'id':                   m.get('id', ''),
        'name':                 m.get('name', ''),
        'context_length':       m.get('context_length', 0),
        'pricing': {
            'prompt_per_1m_tokens':     round(prompt_per_m, 4),
            'completion_per_1m_tokens': round(completion_per_m, 4),
            'combined_per_1m_tokens':   round(combined_per_m, 4),
            'request':                  round(request_cost, 6),
            'image':                    round(image_cost, 6),
        },
        'modality': {
            'summary': arch.get('modality', ''),
            'input':   arch.get('input_modalities', []),
            'output':  arch.get('output_modalities', []),
        },
        'tokenizer':            arch.get('tokenizer', ''),
        'max_completion_tokens': top.get('max_completion_tokens'),
        'is_moderated':         top.get('is_moderated', False),
        'supported_parameters': m.get('supported_parameters', []),
        'description':          (m.get('description') or '')[:200],
    })

# Sort: free models first (combined=0), then by combined cost ascending
results.sort(key=lambda x: (
    x['pricing']['combined_per_1m_tokens'],
    x['pricing']['prompt_per_1m_tokens'],
    x['id'],
))

output = {
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'total_models': len(results),
    'sorted_by': 'combined_cost_per_1m_tokens_asc',
    'note': 'Pricing is in USD per 1M tokens. Combined = prompt + completion.',
    'models': results,
}

json.dump(output, sys.stdout, indent=2)
" > "$OUTPUT_FILE"

# ---------------------------------------------------------------------------
# 4. Summary
# ---------------------------------------------------------------------------
TOTAL=$(python3 -c "import json; d=json.load(open('$OUTPUT_FILE')); print(d['total_models'])")
FREE=$(python3 -c "import json; d=json.load(open('$OUTPUT_FILE')); print(sum(1 for m in d['models'] if m['pricing']['combined_per_1m_tokens']==0))")

echo ""
echo "✅ Wrote $TOTAL models to: $OUTPUT_FILE"
echo "   Free models: $FREE"
echo ""
echo "Top 10 cheapest (non-free):"
python3 -c "
import json
d = json.load(open('$OUTPUT_FILE'))
paid = [m for m in d['models'] if m['pricing']['combined_per_1m_tokens'] > 0]
print(f'  {\"ID\":<55} {\"In/1M\":>8} {\"Out/1M\":>8} {\"Combined\":>9}  {\"Context\":>8}')
print(f'  {\"─\"*55} {\"─\"*8} {\"─\"*8} {\"─\"*9}  {\"─\"*8}')
for m in paid[:10]:
    p = m['pricing']
    print(f'  {m[\"id\"]:<55} \${p[\"prompt_per_1m_tokens\"]:>7.3f} \${p[\"completion_per_1m_tokens\"]:>7.3f} \${p[\"combined_per_1m_tokens\"]:>8.3f}  {m[\"context_length\"]:>8,}')
"
echo ""
echo "Top 5 most expensive:"
python3 -c "
import json
d = json.load(open('$OUTPUT_FILE'))
expensive = sorted(d['models'], key=lambda x: x['pricing']['combined_per_1m_tokens'], reverse=True)
print(f'  {\"ID\":<55} {\"In/1M\":>8} {\"Out/1M\":>8} {\"Combined\":>9}  {\"Context\":>8}')
print(f'  {\"─\"*55} {\"─\"*8} {\"─\"*8} {\"─\"*9}  {\"─\"*8}')
for m in expensive[:5]:
    p = m['pricing']
    print(f'  {m[\"id\"]:<55} \${p[\"prompt_per_1m_tokens\"]:>7.2f} \${p[\"completion_per_1m_tokens\"]:>7.2f} \${p[\"combined_per_1m_tokens\"]:>8.2f}  {m[\"context_length\"]:>8,}')
"
