⚠️ **Warning:** This software is provided for educational and informational purposes only. Nothing in this repository constitutes financial, investment, legal, or tax advice.

# MAHORAGA

An autonomous, LLM-powered trading agent that runs 24/7 on Cloudflare Workers.

[![Discord](https://img.shields.io/discord/1467592472158015553?color=7289da&label=Discord&logo=discord&logoColor=white)](https://discord.gg/vMFnHe2YBh)

MAHORAGA monitors social sentiment from StockTwits and Reddit, uses AI (OpenAI, Anthropic, Google, xAI, DeepSeek via AI SDK, or 300+ models via OpenRouter) to analyze signals, and executes trades through Alpaca. It runs as a Cloudflare Durable Object with persistent state, automatic restarts, and 24/7 crypto trading support.

<img width="1278" height="957" alt="dashboard" src="https://github.com/user-attachments/assets/56473ab6-e2c6-45fc-9e32-cf85e69f1a2d" />

## Features

- **24/7 Operation** — Runs on Cloudflare Workers, no local machine required
- **Multi-Source Signals** — StockTwits, Reddit (4 subreddits), Twitter confirmation
- **Multi-Provider LLM** — OpenAI, Anthropic, Google, xAI, DeepSeek via AI SDK, OpenRouter (300+ models), or Cloudflare AI Gateway
- **Crypto Trading** — Trade BTC, ETH, SOL around the clock
- **Options Support** — High-conviction options plays
- **Staleness Detection** — Auto-exit positions that lose momentum
- **Pre-Market Analysis** — Prepare trading plans before market open
- **Discord Notifications** — Get alerts on BUY signals
- **Fully Customizable** — Well-documented with `[TUNE]` and `[CUSTOMIZABLE]` markers

## Requirements

- Node.js 18+
- Cloudflare account (free tier works)
- Alpaca account (free, paper trading supported)
- LLM API key (OpenAI, Anthropic, Google, xAI, DeepSeek), OpenRouter API key, or Cloudflare AI Gateway credentials

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/ygwyg/MAHORAGA.git
cd mahoraga
npm install
cd dashboard && npm install && cd ..
```

### 2. Create Cloudflare resources

```bash
# Create D1 database
npx wrangler d1 create mahoraga-db
# Copy the database_id to wrangler.jsonc

# Create KV namespace
npx wrangler kv namespace create CACHE
# Copy the id to wrangler.jsonc

# Run migrations
npx wrangler d1 migrations apply mahoraga-db
```

### 3. Set secrets

```bash
# Required
npx wrangler secret put ALPACA_API_KEY
npx wrangler secret put ALPACA_API_SECRET

# API Authentication - generate a secure random token (64+ chars recommended)
# Example: openssl rand -base64 48
npx wrangler secret put MAHORAGA_API_TOKEN

# LLM Provider (choose one mode)
npx wrangler secret put LLM_PROVIDER  # "openai-raw" (default), "openrouter", "ai-sdk", or "cloudflare-gateway"
npx wrangler secret put LLM_MODEL     # e.g. "gpt-4o-mini" or "openai/gpt-5-mini" (OpenRouter)

# LLM API Keys (based on provider mode)
npx wrangler secret put OPENAI_API_KEY         # For openai-raw, openrouter, or ai-sdk with OpenAI
npx wrangler secret put OPENAI_BASE_URL        # Optional: override base URL (auto-set for openrouter)
# npx wrangler secret put ANTHROPIC_API_KEY    # For ai-sdk with Anthropic
# npx wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY  # For ai-sdk with Google
# npx wrangler secret put XAI_API_KEY          # For ai-sdk with xAI/Grok
# npx wrangler secret put DEEPSEEK_API_KEY     # For ai-sdk with DeepSeek
# npx wrangler secret put CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID  # For cloudflare-gateway
# npx wrangler secret put CLOUDFLARE_AI_GATEWAY_ID          # For cloudflare-gateway
# npx wrangler secret put CLOUDFLARE_AI_GATEWAY_TOKEN       # For cloudflare-gateway

# Optional
npx wrangler secret put ALPACA_PAPER         # "true" for paper trading (recommended)
npx wrangler secret put TWITTER_BEARER_TOKEN
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler secret put KILL_SWITCH_SECRET   # Emergency kill switch (separate from API token)
```

### 4. Deploy

```bash
npx wrangler deploy
```

### 5. Enable the agent

All API endpoints require authentication via Bearer token:

```bash
# Set your API token as an env var for convenience
export MAHORAGA_TOKEN="your-api-token"

# Enable the agent
curl -H "Authorization: Bearer $MAHORAGA_TOKEN" \
  https://mahoraga.bernardoalmeida2004.workers.dev/agent/enable
```

### 6. Monitor

```bash
# Check status
curl -H "Authorization: Bearer $MAHORAGA_TOKEN" \
  https://mahoraga.bernardoalmeida2004.workers.dev/agent/status

# View logs
curl -H "Authorization: Bearer $MAHORAGA_TOKEN" \
  https://mahoraga.bernardoalmeida2004.workers.dev/agent/logs

# Emergency kill switch (uses separate KILL_SWITCH_SECRET)
curl -H "Authorization: Bearer $KILL_SWITCH_SECRET" \
  https://mahoraga.bernardoalmeida2004.workers.dev/agent/kill

# Run dashboard locally (or use ./start for both backend + dashboard)
cd dashboard && npm install && npm run dev
```

## Local Development

### Quick start (single command)

```bash
# Copy config files (first time only)
cp .env.example .dev.vars        # Edit with your API keys
cp wrangler.example.jsonc wrangler.jsonc

# Auto-authenticate the dashboard (optional, avoids manual token entry)
echo "VITE_MAHORAGA_API_TOKEN=$(grep MAHORAGA_API_TOKEN .dev.vars | cut -d= -f2-)" > dashboard/.env.development

# Run local D1 migrations
npm run db:migrate

# Start both backend and dashboard
./start
```

This starts the Wrangler backend on `http://localhost:8787` and the React dashboard on `http://localhost:3000`. Press Ctrl+C to stop both.

The `dashboard/.env.development` file auto-injects your API token so the dashboard authenticates without manual entry. Without it, you'll need to paste your `MAHORAGA_API_TOKEN` into the dashboard login screen on first visit.

```bash
./start              # Start both backend + dashboard
./start backend      # Backend only (port 8787)
./start dashboard    # Dashboard only (port 3000)
```

### Manual start (separate terminals)

```bash
# Terminal 1 - Start wrangler
npm run dev

# Terminal 2 - Start dashboard
cd dashboard && npm run dev
```

### Test Alpaca connection

```bash
npm run test:alpaca
```

Verifies your Alpaca API keys by testing account authentication, market clock, and a live AAPL snapshot.

### List OpenRouter models

```bash
./scripts/list-models.sh
```

Fetches all 300+ OpenRouter models with pricing and writes them to `scripts/openrouter-models.json`, sorted by cost (cheapest first).

### Enable the agent

```bash
curl -H "Authorization: Bearer $MAHORAGA_TOKEN" \
  http://localhost:8787/agent/enable
```

## Customizing the Harness

The main trading logic is in `src/durable-objects/mahoraga-harness.ts`. It's documented with markers to help you find what to modify:

| Marker | Meaning |
|--------|---------|
| `[TUNE]` | Numeric values you can adjust |
| `[TOGGLE]` | Features you can enable/disable |
| `[CUSTOMIZABLE]` | Sections with code you might want to modify |

### Adding a New Data Source

1. Create a new `gather*()` method that returns `Signal[]`
2. Add it to `runDataGatherers()` Promise.all
3. Add source weight to `SOURCE_CONFIG.weights`

See `docs/harness.html` for detailed customization guide.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `max_positions` | 5 | Maximum concurrent positions |
| `max_position_value` | 5000 | Maximum $ per position |
| `take_profit_pct` | 10 | Take profit percentage |
| `stop_loss_pct` | 5 | Stop loss percentage |
| `min_sentiment_score` | 0.3 | Minimum sentiment to consider |
| `min_analyst_confidence` | 0.6 | Minimum LLM confidence to trade |
| `options_enabled` | false | Enable options trading |
| `crypto_enabled` | false | Enable 24/7 crypto trading |
| `llm_model` | gpt-4o-mini | Research model. Use full ID for OpenRouter, e.g. `openai/gpt-5-mini` |
| `llm_analyst_model` | gpt-4o | Analyst model. Use full ID for OpenRouter, e.g. `openai/gpt-5.2` |

### LLM Provider Configuration

MAHORAGA supports multiple LLM providers via four modes:

| Mode | Description | Required Env Vars |
|------|-------------|-------------------|
| `openai-raw` | Direct OpenAI API (default) | `OPENAI_API_KEY` |
| `openrouter` | OpenRouter proxy (300+ models) | `OPENAI_API_KEY` (your OpenRouter key) |
| `ai-sdk` | Vercel AI SDK with 5 providers | One or more provider keys |
| `cloudflare-gateway` | Cloudflare AI Gateway (/compat) | `CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID`, `CLOUDFLARE_AI_GATEWAY_ID`, `CLOUDFLARE_AI_GATEWAY_TOKEN` |

**OpenRouter Setup:**

OpenRouter gives you access to 300+ models (OpenAI, Anthropic, Google, Meta, DeepSeek, xAI, and more) through a single API key. Get your key at [openrouter.ai/keys](https://openrouter.ai/keys).

```bash
# .dev.vars (local) or wrangler secrets (production)
LLM_PROVIDER=openrouter
LLM_MODEL=openai/gpt-5-mini
OPENAI_API_KEY=sk-or-v1-your-openrouter-key
```

Models use the `provider/model` format (e.g. `openai/gpt-5-mini`, `anthropic/claude-sonnet-4.5`, `google/gemini-2.5-pro`). The base URL is auto-configured to `https://openrouter.ai/api/v1`.

The dashboard settings panel includes a **dynamic model picker** when OpenRouter is selected -- it fetches all 300+ models with live pricing from the OpenRouter API, with search filtering and sort by price. LLM cost tracking uses **actual costs** from OpenRouter's API response, so free models correctly show $0.

Run `./scripts/list-models.sh` to fetch all available models with pricing to a local JSON file, sorted by cost.

**Optional OpenAI Base URL Override:**

- `OPENAI_BASE_URL` — Override the base URL for OpenAI requests. Applies to `openai-raw` and `ai-sdk` (OpenAI models). Auto-set for `openrouter`. Default: `https://api.openai.com/v1`.

**Cloudflare AI Gateway Notes:**

- This integration calls Cloudflare's OpenAI-compatible `/compat/chat/completions` endpoint and always sends `cf-aig-authorization`.
- It is intended for BYOK/Unified Billing setups where upstream provider keys are configured in Cloudflare (so your worker does not send provider API keys).
- Models use the `{provider}/{model}` format (e.g. `openai/gpt-5-mini`, `google-ai-studio/gemini-2.5-flash`, `anthropic/claude-sonnet-4-5`).

**AI SDK Supported Providers:**

| Provider | Env Var | Example Models |
|----------|---------|----------------|
| OpenAI | `OPENAI_API_KEY` | `openai/gpt-4o`, `openai/o1` |
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic/claude-sonnet-4`, `anthropic/claude-opus-4` |
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` | `google/gemini-2.5-pro`, `google/gemini-2.5-flash` |
| xAI (Grok) | `XAI_API_KEY` | `xai/grok-4`, `xai/grok-3` |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek/deepseek-chat`, `deepseek/deepseek-reasoner` |

**Example: Using Claude via OpenRouter:**

```bash
npx wrangler secret put LLM_PROVIDER  # Set to "openrouter"
npx wrangler secret put LLM_MODEL     # Set to "anthropic/claude-sonnet-4.5"
npx wrangler secret put OPENAI_API_KEY # Your OpenRouter API key (sk-or-...)
```

**Example: Using Claude with AI SDK (direct):**

```bash
npx wrangler secret put LLM_PROVIDER      # Set to "ai-sdk"
npx wrangler secret put LLM_MODEL         # Set to "anthropic/claude-sonnet-4"
npx wrangler secret put ANTHROPIC_API_KEY # Your Anthropic API key
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/agent/status` | Full status (account, positions, signals) |
| `/agent/enable` | Enable the agent |
| `/agent/disable` | Disable the agent |
| `/agent/config` | GET or POST configuration |
| `/agent/costs` | GET costs, or DELETE to reset cost tracker |
| `/agent/logs` | Get recent logs |
| `/agent/trigger` | Manually trigger (for testing) |
| `/agent/kill` | Emergency kill switch (uses `KILL_SWITCH_SECRET`) |
| `/mcp` | MCP server for tool access |

## Security

### API Authentication (Required)

All `/agent/*` endpoints require Bearer token authentication using `MAHORAGA_API_TOKEN`:

```bash
curl -H "Authorization: Bearer $MAHORAGA_TOKEN" https://mahoraga.bernardoalmeida2004.workers.dev/agent/status
```

Generate a secure token: `openssl rand -base64 48`

### Emergency Kill Switch

The `/agent/kill` endpoint uses a separate `KILL_SWITCH_SECRET` for emergency shutdown:

```bash
curl -H "Authorization: Bearer $KILL_SWITCH_SECRET" https://mahoraga.bernardoalmeida2004.workers.dev/agent/kill
```

This immediately disables the agent, cancels all alarms, and clears the signal cache.

### Cloudflare Access (Recommended)

For additional security with SSO/email verification, set up Cloudflare Access:

```bash
# 1. Create a Cloudflare API token with Access:Edit permissions
#    https://dash.cloudflare.com/profile/api-tokens

# 2. Run the setup script
CLOUDFLARE_API_TOKEN=your-token \
CLOUDFLARE_ACCOUNT_ID=your-account-id \
MAHORAGA_WORKER_URL=https://mahoraga.your-subdomain.workers.dev \
MAHORAGA_ALLOWED_EMAILS=you@example.com \
npm run setup:access
```

This creates a Cloudflare Access Application with email verification or One-Time PIN.

## Project Structure

```
mahoraga/
├── start                       # Dev launcher (backend + dashboard)
├── wrangler.jsonc              # Cloudflare Workers config
├── .dev.vars                   # Local secrets (gitignored)
├── src/
│   ├── index.ts                # Entry point
│   ├── durable-objects/
│   │   ├── mahoraga-harness.ts # THE HARNESS - customize this!
│   │   └── session.ts
│   ├── mcp/                    # MCP server & tools
│   ├── policy/                 # Trade validation
│   └── providers/              # Alpaca, LLM, news clients
├── scripts/
│   ├── test-alpaca.ts          # Alpaca API connection test
│   ├── list-models.sh          # Fetch OpenRouter models + pricing
│   └── setup-access.ts         # Cloudflare Access setup
├── dashboard/                  # React dashboard (Vite + React + Tailwind)
│   └── src/
│       ├── index.css           # Synthwave '84 theme, glow utilities, CRT overlay CSS
│       ├── components/         # Panel, LineChart, ModelPicker, CrtEffect, etc.
│       └── hooks/              # useOpenRouterModels (dynamic model fetching)
├── docs/                       # Documentation
└── migrations/                 # D1 database migrations
```

## Dashboard Theming

The dashboard uses a **[Synthwave '84](https://github.com/robb0wen/synthwave-vscode)** color palette with neon glow effects, defined as CSS custom properties in `dashboard/src/index.css`.

### Color Palette

All colors are pulled from the Synthwave '84 VS Code theme:

```css
@theme {
  /* Backgrounds — deep purple-blue */
  --color-hud-bg: #262335;
  --color-hud-bg-panel: #2a2139;

  /* Core accents */
  --color-hud-primary: #36f9f6;     /* Neon cyan */
  --color-hud-success: #72f1b8;     /* Neon green */
  --color-hud-warning: #fede5d;     /* Neon yellow */
  --color-hud-error: #fe4450;       /* Neon red */
  --color-hud-purple: #ff7edb;      /* Neon pink */
  --color-hud-cyan: #03edf9;        /* Bright cyan */

  /* Text */
  --color-hud-text: #b6b1b1;        /* Muted warm grey */
  --color-hud-text-dim: #848bbd;    /* Lavender */
  --color-hud-text-bright: #f4eee4; /* Off-white */
}
```

### Neon Glow Effects

Text glow utilities (`.glow-cyan`, `.glow-green`, `.glow-pink`, `.glow-red`, `.glow-yellow`, `.glow-orange`) apply `text-shadow` halos inspired by the Synthwave '84 glow CSS. They're used on panel titles, status indicators, large metric values, and the header title. A pink-to-cyan gradient stripe (`.neon-stripe`) accents panel headers and dividers.

### CRT Effect

A toggleable CRT screen effect is available via the **[CRT]** button in the top-left of the header. It adds:

- **Scanlines** — Thin horizontal bars with a slow retrace scroll
- **Vignette** — Radial gradient darkening screen edges
- **Static noise** — Tiled noise texture animated via CSS
- **Flicker** — Subtle brightness/contrast oscillation on the page
- **Chromatic aberration** — Faint red/cyan fringe at screen edges

The effect is CSS-only with zero per-frame JavaScript (noise tile is generated once on mount). Inspired by [CRTFilter.js](https://github.com/Ichiaka/CRTFilter). The preference is persisted to `localStorage`.

All overlay layers use `pointer-events: none` and high `z-index` so they never block interaction.

## Safety Features

| Feature | Description |
|---------|-------------|
| Paper Trading | Start with `ALPACA_PAPER=true` |
| Kill Switch | Emergency halt via secret |
| Position Limits | Max positions and $ per position |
| Daily Loss Limit | Stops trading after 2% daily loss |
| Staleness Detection | Auto-exit stale positions |
| No Margin | Cash-only trading |
| No Shorting | Long positions only |

## Community

Join our Discord for help and discussion:

**[Discord Server](https://discord.gg/vMFnHe2YBh)**

## Disclaimer

**⚠️ IMPORTANT: READ BEFORE USING**

This software is provided for **educational and informational purposes only**. Nothing in this repository constitutes financial, investment, legal, or tax advice.

**By using this software, you acknowledge and agree that:**

- All trading and investment decisions are made **at your own risk**
- Markets are volatile and **you can lose some or all of your capital**
- No guarantees of performance, profits, or outcomes are made
- The authors and contributors are **not responsible** for any financial losses
- This software may contain bugs or behave unexpectedly
- Past performance does not guarantee future results

**Always start with paper trading and never risk money you cannot afford to lose.**

## License

MIT License - Free for personal and commercial use. See [LICENSE](LICENSE) for full terms.
