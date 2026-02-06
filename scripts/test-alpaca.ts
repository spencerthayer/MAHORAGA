#!/usr/bin/env npx tsx
/**
 * Alpaca Connection Test Script
 *
 * Verifies that your Alpaca API keys are configured correctly by testing:
 *   1. Account authentication & status
 *   2. Market clock endpoint
 *   3. Market data endpoint (latest AAPL quote)
 *
 * Setup:
 *   1. Copy .env.example to .dev.vars
 *   2. Fill in ALPACA_API_KEY and ALPACA_API_SECRET from
 *      https://app.alpaca.markets/paper/dashboard/overview
 *   3. Run: npm run test:alpaca
 *
 * The script reads from .dev.vars (Wrangler local dev format) automatically.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadDevVars(): Record<string, string> {
  const filePath = resolve(process.cwd(), ".dev.vars");
  let content: string;

  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    console.error("❌ Could not read .dev.vars file.");
    console.error("   Run: cp .env.example .dev.vars  then fill in your Alpaca keys.\n");
    process.exit(1);
  }

  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    vars[key] = value;
  }
  return vars;
}

function printSection(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"─".repeat(60)}`);
}

function printKV(label: string, value: unknown) {
  console.log(`  ${label.padEnd(28)} ${value}`);
}

// ---------------------------------------------------------------------------
// Alpaca API calls (minimal, standalone – no project imports needed)
// ---------------------------------------------------------------------------

interface AlpacaConfig {
  apiKey: string;
  apiSecret: string;
  paper: boolean;
}

async function alpacaFetch<T>(
  config: AlpacaConfig,
  baseUrl: string,
  path: string,
): Promise<{ ok: boolean; status: number; data?: T; error?: string; requestId?: string }> {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "APCA-API-KEY-ID": config.apiKey,
      "APCA-API-SECRET-KEY": config.apiSecret,
      "Content-Type": "application/json",
    },
  });

  const requestId = response.headers.get("X-Request-ID") ?? undefined;

  if (!response.ok) {
    const body = await response.text();
    return { ok: false, status: response.status, error: body, requestId };
  }

  const data = (await response.json()) as T;
  return { ok: true, status: response.status, data, requestId };
}

// ---------------------------------------------------------------------------
// Test functions
// ---------------------------------------------------------------------------

async function testAccount(config: AlpacaConfig, tradingUrl: string): Promise<boolean> {
  printSection("1. Account Authentication");

  const result = await alpacaFetch<{
    id: string;
    account_number: string;
    status: string;
    currency: string;
    cash: string;
    buying_power: string;
    equity: string;
    portfolio_value: string;
    pattern_day_trader: boolean;
    trading_blocked: boolean;
    account_blocked: boolean;
    daytrade_count: number;
    created_at: string;
  }>(config, tradingUrl, "/v2/account");

  if (!result.ok) {
    console.log(`  ❌ FAILED (HTTP ${result.status})`);
    console.log(`  Error: ${result.error}`);
    if (result.requestId) {
      console.log(`  X-Request-ID: ${result.requestId}`);
    }
    if (result.status === 401 || result.status === 403) {
      console.log("\n  Possible fixes:");
      console.log("  • Double-check your ALPACA_API_KEY and ALPACA_API_SECRET in .dev.vars");
      console.log("  • Make sure you're using Paper Trading keys (not live) if ALPACA_PAPER=true");
      console.log("  • Regenerate keys at https://app.alpaca.markets/paper/dashboard/overview");
    }
    return false;
  }

  const a = result.data!;
  console.log("  ✅ Authentication successful!\n");
  printKV("Account ID:", a.id);
  printKV("Account Number:", a.account_number);
  printKV("Status:", a.status);
  printKV("Currency:", a.currency);
  printKV("Cash:", `$${parseFloat(a.cash).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  printKV("Buying Power:", `$${parseFloat(a.buying_power).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  printKV("Equity:", `$${parseFloat(a.equity).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  printKV("Portfolio Value:", `$${parseFloat(a.portfolio_value).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  printKV("Pattern Day Trader:", a.pattern_day_trader ? "Yes" : "No");
  printKV("Trading Blocked:", a.trading_blocked ? "YES ⚠️" : "No");
  printKV("Account Blocked:", a.account_blocked ? "YES ⚠️" : "No");
  printKV("Day Trade Count:", a.daytrade_count);
  if (result.requestId) {
    printKV("X-Request-ID:", result.requestId);
  }
  return true;
}

async function testClock(config: AlpacaConfig, tradingUrl: string): Promise<boolean> {
  printSection("2. Market Clock");

  const result = await alpacaFetch<{
    timestamp: string;
    is_open: boolean;
    next_open: string;
    next_close: string;
  }>(config, tradingUrl, "/v2/clock");

  if (!result.ok) {
    console.log(`  ❌ FAILED (HTTP ${result.status}): ${result.error}`);
    return false;
  }

  const c = result.data!;
  console.log("  ✅ Clock endpoint reachable!\n");
  printKV("Server Time:", new Date(c.timestamp).toLocaleString());
  printKV("Market Open:", c.is_open ? "YES (trading now)" : "NO (closed)");
  printKV("Next Open:", new Date(c.next_open).toLocaleString());
  printKV("Next Close:", new Date(c.next_close).toLocaleString());
  return true;
}

async function testMarketData(config: AlpacaConfig): Promise<boolean> {
  printSection("3. Market Data (AAPL Snapshot)");

  const dataUrl = "https://data.alpaca.markets";
  const result = await alpacaFetch<{
    latestTrade?: { p: number; s: number; t: string };
    latestQuote?: { ap: number; as: number; bp: number; bs: number; t: string };
    dailyBar?: { o: number; h: number; l: number; c: number; v: number; t: string };
  }>(config, dataUrl, "/v2/stocks/AAPL/snapshot");

  if (!result.ok) {
    console.log(`  ❌ FAILED (HTTP ${result.status}): ${result.error}`);
    if (result.status === 403) {
      console.log("\n  Note: Market data may require a funded account or data subscription.");
      console.log("  Paper accounts get free IEX data. This is non-blocking for trading.");
    }
    return false;
  }

  const s = result.data!;
  console.log("  ✅ Market data endpoint reachable!\n");

  if (s.latestTrade) {
    printKV("Latest Trade Price:", `$${s.latestTrade.p.toFixed(2)}`);
    printKV("Latest Trade Size:", s.latestTrade.s);
    printKV("Trade Time:", new Date(s.latestTrade.t).toLocaleString());
  }
  if (s.latestQuote) {
    printKV("Bid:", `$${s.latestQuote.bp.toFixed(2)} x ${s.latestQuote.bs}`);
    printKV("Ask:", `$${s.latestQuote.ap.toFixed(2)} x ${s.latestQuote.as}`);
  }
  if (s.dailyBar) {
    printKV("Daily OHLC:", `$${s.dailyBar.o.toFixed(2)} / $${s.dailyBar.h.toFixed(2)} / $${s.dailyBar.l.toFixed(2)} / $${s.dailyBar.c.toFixed(2)}`);
    printKV("Daily Volume:", s.dailyBar.v.toLocaleString());
  }
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║            MAHORAGA — Alpaca Connection Test            ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // Load config
  const vars = loadDevVars();
  const apiKey = vars.ALPACA_API_KEY;
  const apiSecret = vars.ALPACA_API_SECRET;
  const paper = (vars.ALPACA_PAPER ?? "true").toLowerCase() !== "false";

  if (!apiKey || apiKey === "your_alpaca_api_key_here") {
    console.error("\n❌ ALPACA_API_KEY is not set in .dev.vars");
    console.error("   Get your keys at: https://app.alpaca.markets/paper/dashboard/overview\n");
    process.exit(1);
  }
  if (!apiSecret || apiSecret === "your_alpaca_api_secret_here") {
    console.error("\n❌ ALPACA_API_SECRET is not set in .dev.vars");
    console.error("   Get your keys at: https://app.alpaca.markets/paper/dashboard/overview\n");
    process.exit(1);
  }

  const tradingUrl = paper
    ? "https://paper-api.alpaca.markets"
    : "https://api.alpaca.markets";

  console.log(`\n  Mode:         ${paper ? "📄 PAPER TRADING (safe)" : "💰 LIVE TRADING ⚠️"}`);
  console.log(`  Trading URL:  ${tradingUrl}`);
  console.log(`  Data URL:     https://data.alpaca.markets`);
  console.log(`  API Key:      ${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`);

  // Run tests
  const results: boolean[] = [];

  results.push(await testAccount({ apiKey, apiSecret, paper }, tradingUrl));
  results.push(await testClock({ apiKey, apiSecret, paper }, tradingUrl));
  results.push(await testMarketData({ apiKey, apiSecret, paper }));

  // Summary
  printSection("Summary");
  const passed = results.filter(Boolean).length;
  const total = results.length;

  if (passed === total) {
    console.log("  ✅ All tests passed! Your Alpaca API is ready to go.\n");
    console.log("  Next steps:");
    console.log("  • Run: npm run dev            — start the Wrangler dev server");
    console.log("  • Run: npm run test:run       — run unit tests");
    console.log("  • Read: docs/getting-started.html for full setup guide\n");
  } else {
    console.log(`  ⚠️  ${passed}/${total} tests passed.\n`);
    console.log("  Fix the failing tests above, then re-run: npm run test:alpaca\n");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n❌ Unexpected error:", error);
  process.exit(1);
});
