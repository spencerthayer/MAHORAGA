# AGENTS.md - Coding Guidelines for Mahoraga

This document guides agentic coding agents working on the Mahoraga codebase.

## Build/Lint/Test Commands

```bash
# Build
npm run build              # TypeScript compilation
npm run typecheck         # Type check only (no emit)

# Code Quality
npm run lint              # Run Biome linter
npm run lint:fix         # Auto-fix lint issues
npm run format            # Format code with Biome
npm run check             # Run both lint and format check

# Testing
npm test                 # Run tests in watch mode
npm run test:run         # Run tests once (no watch)
npm test src/path/to/test.test.ts  # Run single test file
npm test -t "test name"  # Run specific test by name

# Database
npm run db:migrate       # Apply local migrations

# Development
npm run dev              # Start wrangler dev server (localhost:8787)
npm run deploy            # Deploy to Cloudflare Workers
```

## Code Style Guidelines

### Formatting (Biome)
- Indentation: 2 spaces
- Line width: 120 characters
- Quotes: Double quotes
- Semicolons: Required
- Trailing commas: ES5 style
- Run `npm run format` before committing

### TypeScript
- Strict mode enabled (noImplicitAny, noUnusedLocals, noUnusedParameters)
- Use `import type { Foo }` for type-only imports
- Path alias: `@/*` maps to `./src/*`
- Prefer explicit types over `any`
- Non-null assertions (`!`) discouraged

### Import Conventions
```typescript
// Relative imports within same directory
import { foo } from "./foo";
import type { Foo } from "./types";

// Absolute imports using path alias
import { createError } from "@/lib/errors";

// Group imports: standard libs, external packages, internal modules
import { useState, useEffect } from "react";
import { z } from "zod";
import { createAlpacaClient } from "./providers/alpaca";
```

### Naming Conventions
- Classes: `PascalCase` (e.g., `PolicyEngine`, `AlpacaClient`)
- Interfaces: `PascalCase` (e.g., `AgentConfig`, `OrderParams`)
- Functions: `camelCase` (e.g., `getRiskState`, `executeOrder`)
- Constants: `UPPER_SNAKE_CASE` or `camelCase`
- Private methods: `private` keyword in TypeScript
- Durable Objects: PascalCase with `DO` suffix (e.g., `SessionDO`)

### Error Handling
```typescript
// Use custom error types from @/lib/errors
import { createError, ErrorCode } from "@/lib/errors";

// Throw descriptive errors with context
throw createError(ErrorCode.NOT_FOUND, `No crypto snapshot data for ${symbol}`);

// Parse user input with defaults (utils/parse*)
const value = parseNumber(env.FOO, 100);
const enabled = parseBoolean(env.BAR, false);

// API error handling: check status codes and map to error types
if (response.status === 401) {
  throw createError(ErrorCode.UNAUTHORIZED, "Authentication failed");
}
```

### Database Patterns
```typescript
// Use parameterized queries to prevent SQL injection
await db.run("UPDATE table SET foo = ? WHERE id = ?", [value, id]);

// Query functions return typed results
const row = await db.executeOne<RiskStateRow>(`SELECT * FROM risk_state WHERE id = 1`);

// Use NOW() and utility functions for timestamps
import { nowISO } from "@/lib/utils";
await db.run("INSERT INTO logs (created_at) VALUES (?)", [nowISO()]);
```

### Testing Patterns
```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("ComponentName", () => {
  let mockClient: { method: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockClient = { method: vi.fn() };
  });

  it("should do something", async () => {
    mockClient.method.mockResolvedValueOnce({ data: "value" });
    const result = await functionUnderTest();
    expect(mockClient.method).toHaveBeenCalledWith("arg");
    expect(result).toBe("expected");
  });
});
```

### Logging
```typescript
// Use structured logging with JSON objects
console.log("[ComponentName] action_name", { symbol: "AAPL", value: 100 });

// Redact sensitive keys automatically
import { sanitizeForLog } from "@/lib/utils";
console.log("[ComponentName] request_data", sanitizeForLog(requestData));

// Log format: [ComponentName] action_name { ...context }
```

### Comments & Documentation
```typescript
// File header comment blocks for major components
/**
 * Policy Engine - Trade Validation System
 *
 * Validates orders before execution. All trades pass through here.
 */

// Section markers in custom code (especially mahoraga-harness.ts)
// [TUNE] - Numeric values to adjust
// [TOGGLE] - Features to enable/disable
// [CUSTOMIZABLE] - Code sections you can modify
```

### File Organization
- `src/index.ts` - Entry point, API routes
- `src/durable-objects/` - Durable Objects (main logic)
- `src/providers/` - External integrations (Alpaca, LLM, scrapers)
- `src/policy/` - Trade validation and safety
- `src/storage/` - D1, KV, R2 database layers
- `src/mcp/` - Model Context Protocol server
- `src/lib/` - Utilities and error handling
- `src/schemas/` - Zod validation schemas
- `src/jobs/` - Scheduled tasks and cron handlers
- `dashboard/` - React monitoring UI (separate package.json)

### Security Guidelines
- Never commit `.dev.vars`, `wrangler.jsonc`, `agent-config.json`
- Use constant-time compare for secrets: `constantTimeCompare(token, secret)`
- Sanitize logs with `sanitizeForLog()` before logging requests
- Use parameterized queries for all database operations
- API keys are accessed from `env` in Cloudflare Workers context

### Cloudflare Workers Specifics
- Env interface defined in `src/env.d.ts`
- Durable Objects use `export default { fetch, alarm }` pattern
- Use `ctx.waitUntil()` for background work
- Cron triggers configured in `wrangler.jsonc`
- Local dev: `npm run dev`, remote: `npm run deploy`

### When in Doubt
- Run `npm run typecheck` and `npm run lint` before pushing
- Check existing test files for patterns
- Look at `src/providers/alpaca/` for API integration patterns
- Reference `src/policy/engine.ts` for validation patterns
- Use TypeScript strict mode - the compiler will guide you

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds