import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import clsx from 'clsx'
import { Panel } from './components/Panel'
import { Metric, MetricInline } from './components/Metric'
import { StatusIndicator, StatusBar } from './components/StatusIndicator'
import { SettingsModal } from './components/SettingsModal'
import { SetupWizard } from './components/SetupWizard'
import { LineChart, Sparkline } from './components/LineChart'
import { NotificationBell } from './components/NotificationBell'
import { Tooltip, TooltipContent } from './components/Tooltip'
import { CrtEffect } from './components/CrtEffect'
import type { Status, Config, LogEntry, Signal, Position, SignalResearch, PortfolioSnapshot, SymbolDetail, CryptoAsset } from './types'
import type { PositionEntry, StalenessAnalysis } from './types'

const API_BASE = '/api'

function getApiToken(): string {
  return localStorage.getItem('mahoraga_api_token') || import.meta.env.VITE_MAHORAGA_API_TOKEN || ''
}

function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getApiToken()
  const headers = new Headers(options.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(url, { ...options, headers })
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

function getAgentColor(agent: string): string {
  const colors: Record<string, string> = {
    'Analyst': 'text-hud-purple',
    'Executor': 'text-hud-cyan',
    'StockTwits': 'text-hud-success',
    'SignalResearch': 'text-hud-cyan',
    'PositionResearch': 'text-hud-purple',
    'Crypto': 'text-hud-warning',
    'System': 'text-hud-text-dim',
  }
  return colors[agent] || 'text-hud-text'
}

function isCryptoSymbol(symbol: string, cryptoSymbols: string[] = []): boolean {
  return cryptoSymbols.includes(symbol) || symbol.includes('/USD') || symbol.includes('BTC') || symbol.includes('ETH') || symbol.includes('SOL')
}

function getVerdictColor(verdict: string): string {
  if (verdict === 'BUY') return 'text-hud-success'
  if (verdict === 'SKIP') return 'text-hud-error'
  return 'text-hud-warning'
}

function getQualityColor(quality: string): string {
  if (quality === 'excellent') return 'text-hud-success'
  if (quality === 'good') return 'text-hud-primary'
  if (quality === 'fair') return 'text-hud-warning'
  return 'text-hud-error'
}

function getSentimentColor(score: number): string {
  if (score >= 0.3) return 'text-hud-success'
  if (score <= -0.2) return 'text-hud-error'
  return 'text-hud-warning'
}

async function fetchPortfolioHistory(period: string = '1D'): Promise<PortfolioSnapshot[]> {
  try {
    const timeframe = period === '1D' ? '15Min' : '1D'
    const intraday = period === '1D' ? '&intraday_reporting=extended_hours' : ''
    const res = await authFetch(`${API_BASE}/history?period=${period}&timeframe=${timeframe}${intraday}`)
    const data = await res.json()
    if (data.ok && data.data?.snapshots) {
      return data.data.snapshots
    }
    return []
  } catch {
    return []
  }
}

// Generate mock price history for positions
function generateMockPriceHistory(currentPrice: number, unrealizedPl: number, points: number = 20): number[] {
  const prices: number[] = []
  const isPositive = unrealizedPl >= 0
  const startPrice = currentPrice * (isPositive ? 0.95 : 1.05)
  
  for (let i = 0; i < points; i++) {
    const progress = i / (points - 1)
    const trend = startPrice + (currentPrice - startPrice) * progress
    const noise = trend * (Math.random() - 0.5) * 0.02
    prices.push(trend + noise)
  }
  prices[prices.length - 1] = currentPrice
  return prices
}

// ---------------------------------------------------------------------------
// Symbol Detail Tooltip — lazy-loads data on hover from /api/symbol-detail/:symbol
// ---------------------------------------------------------------------------

function formatLargeNumber(value: number | null): string {
  if (value === null || value === undefined) return '--'
  if (Math.abs(value) >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  return `$${value.toLocaleString()}`
}

function formatVolume(value: number | null): string {
  if (value === null || value === undefined) return '--'
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return value.toLocaleString()
}

const symbolDetailCache: Record<string, { data: SymbolDetail; ts: number }> = {}
const SYMBOL_DETAIL_CACHE_TTL = 60_000 // 1 minute client-side cache

function SymbolDetailTooltip({
  symbol,
  posEntry,
  staleness,
  holdTime,
  currentPrice,
  isCrypto,
  children,
}: {
  symbol: string
  posEntry?: PositionEntry
  staleness?: StalenessAnalysis
  holdTime: number | null
  currentPrice: number
  isCrypto: boolean
  children: React.ReactNode
}) {
  const [detail, setDetail] = useState<SymbolDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)

  const handleMouseEnter = () => {
    if (fetched) return
    const cached = symbolDetailCache[symbol]
    if (cached && Date.now() - cached.ts < SYMBOL_DETAIL_CACHE_TTL) {
      setDetail(cached.data)
      setFetched(true)
      return
    }
    setLoading(true)
    authFetch(`${API_BASE}/symbol-detail/${encodeURIComponent(symbol)}`)
      .then(res => res.json())
      .then(data => {
        if (data.ok && data.data) {
          symbolDetailCache[symbol] = { data: data.data, ts: Date.now() }
          setDetail(data.data)
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false)
        setFetched(true)
      })
  }

  const tooltipContent = (
    <div className="space-y-2 min-w-[260px]">
      {/* Header */}
      <div className="hud-label text-hud-primary border-b border-hud-line/50 pb-1">
        {symbol} {isCrypto && <span className="text-hud-warning">₿</span>}
      </div>

      {loading && !detail && (
        <div className="text-hud-text-dim text-xs animate-pulse">Loading market data...</div>
      )}

      {detail && (
        <>
          {/* Quote Section */}
          <div className="space-y-0.5">
            <div className="hud-label text-[10px] text-hud-text-dim uppercase tracking-wider">Quote</div>
            <div className="flex justify-between gap-4">
              <span className="text-hud-text-dim">Bid</span>
              <span className="text-hud-text-bright">{formatCurrency(detail.bid_price)} x {detail.bid_size}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-hud-text-dim">Ask</span>
              <span className="text-hud-text-bright">{formatCurrency(detail.ask_price)} x {detail.ask_size}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-hud-text-dim">Spread</span>
              <span className="text-hud-text-bright">{formatCurrency(detail.ask_price - detail.bid_price)}</span>
            </div>
          </div>

          {/* Trading Section */}
          <div className="space-y-0.5 border-t border-hud-line/30 pt-1">
            <div className="hud-label text-[10px] text-hud-text-dim uppercase tracking-wider">Trading</div>
            <div className="flex justify-between gap-4">
              <span className="text-hud-text-dim">Volume</span>
              <span className="text-hud-text-bright">{formatVolume(detail.volume)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-hud-text-dim">Overnight Vol</span>
              <span className="text-hud-text-dim">--</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-hud-text-dim">Avg Volume</span>
              <span className="text-hud-text-bright">{formatVolume(detail.avg_volume)}</span>
            </div>
          </div>

          {/* Price Section */}
          <div className="space-y-0.5 border-t border-hud-line/30 pt-1">
            <div className="hud-label text-[10px] text-hud-text-dim uppercase tracking-wider">Price</div>
            <div className="flex justify-between gap-4">
              <span className="text-hud-text-dim">Open</span>
              <span className="text-hud-text-bright">{formatCurrency(detail.open)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-hud-text-dim">Today&apos;s High</span>
              <span className="text-hud-text-bright">{formatCurrency(detail.day_high)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-hud-text-dim">Today&apos;s Low</span>
              <span className="text-hud-text-bright">{formatCurrency(detail.day_low)}</span>
            </div>
          </div>

          {/* Fundamentals Section */}
          <div className="space-y-0.5 border-t border-hud-line/30 pt-1">
            <div className="hud-label text-[10px] text-hud-text-dim uppercase tracking-wider">Fundamentals</div>
            <div className="flex justify-between gap-4">
              <span className="text-hud-text-dim">Market Cap</span>
              <span className="text-hud-text-bright">{formatLargeNumber(detail.market_cap)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-hud-text-dim">52 Week High</span>
              <span className="text-hud-text-bright">{detail.year_high !== null ? formatCurrency(detail.year_high) : '--'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-hud-text-dim">52 Week Low</span>
              <span className="text-hud-text-bright">{detail.year_low !== null ? formatCurrency(detail.year_low) : '--'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-hud-text-dim">P/E Ratio</span>
              <span className="text-hud-text-bright">{detail.pe_ratio !== null ? detail.pe_ratio.toFixed(2) : '--'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-hud-text-dim">Dividend Yield</span>
              <span className="text-hud-text-bright">{detail.dividend_yield !== null ? `${detail.dividend_yield.toFixed(2)}%` : '--'}</span>
            </div>
          </div>

          {/* Short Section */}
          {!isCrypto && (
            <div className="space-y-0.5 border-t border-hud-line/30 pt-1">
              <div className="hud-label text-[10px] text-hud-text-dim uppercase tracking-wider">Short Info</div>
              <div className="flex justify-between gap-4">
                <span className="text-hud-text-dim">Short Inventory</span>
                <span className="text-hud-text-bright">{detail.shortable ? 'Available' : 'Unavailable'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-hud-text-dim">Borrow Rate</span>
                <span className="text-hud-text-dim">--</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Position Section (always available from existing data) */}
      <div className="space-y-0.5 border-t border-hud-line/30 pt-1">
        <div className="hud-label text-[10px] text-hud-text-dim uppercase tracking-wider">Position</div>
        <div className="flex justify-between gap-4">
          <span className="text-hud-text-dim">Entry Price</span>
          <span className="text-hud-text-bright">{posEntry ? formatCurrency(posEntry.entry_price) : 'N/A'}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-hud-text-dim">Current Price</span>
          <span className="text-hud-text-bright">{formatCurrency(currentPrice)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-hud-text-dim">Hold Time</span>
          <span className="text-hud-text-bright">{holdTime !== null ? `${holdTime}h` : 'N/A'}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-hud-text-dim">Entry Sentiment</span>
          <span className="text-hud-text-bright">{posEntry ? `${(posEntry.entry_sentiment * 100).toFixed(0)}%` : 'N/A'}</span>
        </div>
        {staleness && (
          <div className="flex justify-between gap-4">
            <span className="text-hud-text-dim">Staleness</span>
            <span className={staleness.shouldExit ? 'text-hud-error' : 'text-hud-text'}>{Number.isFinite(staleness.score) ? `${(staleness.score * 100).toFixed(0)}%` : 'N/A'}</span>
          </div>
        )}
      </div>

      {posEntry?.entry_reason && (
        <p className="text-hud-text-dim text-hud-sm leading-tight border-t border-hud-line/30 pt-1">
          {posEntry.entry_reason}
        </p>
      )}
    </div>
  )

  return (
    <div className="inline-block" onMouseEnter={handleMouseEnter}>
      <Tooltip position="right" content={tooltipContent} className="max-w-sm">
        {children}
      </Tooltip>
    </div>
  )
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [setupChecked, setSetupChecked] = useState(false)
  const [time, setTime] = useState(new Date())
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>([])
  const [portfolioPeriod, setPortfolioPeriod] = useState<'1D' | '1W' | '1M'>('1D')
  const [crtEnabled, setCrtEnabled] = useState(() => localStorage.getItem('mahoraga_crt') === 'true')
  const [cryptoAssets, setCryptoAssets] = useState<CryptoAsset[]>([])
  type SignalFilter = 'all' | 'social' | 'market_data' | 'sec' | 'crypto'
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('all')

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const res = await authFetch(`${API_BASE}/setup/status`)
        const data = await res.json()
        if (data.ok && !data.data.configured) {
          setShowSetup(true)
        }
        setSetupChecked(true)
      } catch {
        setSetupChecked(true)
      }
    }
    checkSetup()
  }, [])

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await authFetch(`${API_BASE}/status`)
        const data = await res.json()
        if (data.ok) {
          setStatus(data.data)
          setError(null)
        } else {
          setError(data.error || 'Failed to fetch status')
        }
      } catch {
        setError('Connection failed - is the agent running?')
      }
    }

    if (setupChecked && !showSetup) {
      fetchStatus()
      const interval = setInterval(fetchStatus, 5000)
      const timeInterval = setInterval(() => setTime(new Date()), 1000)

      return () => {
        clearInterval(interval)
        clearInterval(timeInterval)
      }
    }
  }, [setupChecked, showSetup])

  useEffect(() => {
    if (!setupChecked || showSetup) return

    const loadPortfolioHistory = async () => {
      const history = await fetchPortfolioHistory(portfolioPeriod)
      if (history.length > 0) {
        setPortfolioHistory(history)
      }
    }

    loadPortfolioHistory()
    const historyInterval = setInterval(loadPortfolioHistory, 60000)
    return () => clearInterval(historyInterval)
  }, [setupChecked, showSetup, portfolioPeriod])

  // Fetch available Alpaca crypto assets once on load
  useEffect(() => {
    if (!setupChecked || showSetup) return
    const fetchCryptoAssets = async () => {
      try {
        const res = await authFetch(`${API_BASE}/crypto-assets`)
        const data = await res.json()
        if (data.ok) {
          setCryptoAssets(data.data)
        }
      } catch {
        // Non-critical: crypto asset list will be empty, settings modal falls back gracefully
      }
    }
    fetchCryptoAssets()
  }, [setupChecked, showSetup])

  const handleSaveConfig = async (config: Config) => {
    const res = await authFetch(`${API_BASE}/config`, {
      method: 'POST',
      body: JSON.stringify(config),
    })
    const data = await res.json()
    if (data.ok && status) {
      setStatus({ ...status, config: data.data })
    }
  }

  // Derived state (must stay above early returns per React hooks rules)
  const account = status?.account
  const positions = status?.positions || []
  const signals = status?.signals || []
  const getSignalCategory = (sig: Signal): SignalFilter => {
    if (sig.isCrypto || (sig.source && sig.source.toLowerCase().includes('crypto'))) return 'crypto'
    const s = (sig.source || '').toLowerCase()
    if (s.startsWith('reddit_') || s === 'stocktwits' || s === 'quiver_wsb') return 'social'
    if (s.startsWith('fmp_') || s.startsWith('alpaca_') || s === 'finnhub_news') return 'market_data'
    if (s.includes('sec') || s === 'quiver_congress' || s === 'quiver_insiders' || s === 'finnhub_insider') return 'sec'
    return 'market_data'
  }
  const filteredSignals = useMemo(() => {
    if (signalFilter === 'all') return signals
    return signals.filter((sig: Signal) => getSignalCategory(sig) === signalFilter)
  }, [signals, signalFilter])
  const logs = status?.logs || []
  const costs = status?.costs || { total_usd: 0, calls: 0, tokens_in: 0, tokens_out: 0, by_model: {} }
  const config = status?.config

  // Debounced config save for inline signal toggles (batches rapid changes)
  const pendingConfigRef = useRef<Config | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const debouncedSaveConfig = useCallback((updatedConfig: Config) => {
    pendingConfigRef.current = updatedConfig
    if (status) {
      setStatus({ ...status, config: updatedConfig }) // optimistic UI
    }
    clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      if (pendingConfigRef.current) {
        handleSaveConfig(pendingConfigRef.current)
        pendingConfigRef.current = null
      }
    }, 500)
  }, [status, handleSaveConfig])

  // Toggle a signal's tradability: crypto → crypto_symbols, equity → ticker_blacklist
  const handleToggleSignal = useCallback((symbol: string, isCrypto: boolean, enabled: boolean) => {
    if (!config) return
    if (isCrypto) {
      const symbols = config.crypto_symbols || ['BTC/USD', 'ETH/USD', 'SOL/USD']
      const updated = enabled
        ? [...new Set([...symbols, symbol])]
        : symbols.filter(s => s !== symbol)
      debouncedSaveConfig({ ...config, crypto_symbols: updated })
    } else {
      const blacklist = config.ticker_blacklist || []
      const updated = enabled
        ? blacklist.filter(s => s !== symbol)
        : [...new Set([...blacklist, symbol])]
      debouncedSaveConfig({ ...config, ticker_blacklist: updated })
    }
  }, [config, debouncedSaveConfig])
  const isMarketOpen = status?.clock?.is_open ?? false

  const startingEquity = config?.starting_equity || 100000
  const unrealizedPl = positions.reduce((sum, p) => sum + p.unrealized_pl, 0)
  const totalPl = account ? account.equity - startingEquity : 0
  const realizedPl = totalPl - unrealizedPl
  const totalPlPct = account ? (totalPl / startingEquity) * 100 : 0

  // Daily P&L from Alpaca's last_equity (previous day close)
  const dailyPl = account?.last_equity ? account.equity - account.last_equity : 0
  const dailyPlPct = account?.last_equity ? (dailyPl / account.last_equity) * 100 : 0

  // Color palette for position lines (distinct colors for each stock)
  const positionColors = ['cyan', 'purple', 'yellow', 'blue', 'green'] as const

  // Generate mock price histories for positions (stable per session via useMemo)
  const positionPriceHistories = useMemo(() => {
    const histories: Record<string, number[]> = {}
    positions.forEach(pos => {
      histories[pos.symbol] = generateMockPriceHistory(pos.current_price, pos.unrealized_pl)
    })
    return histories
  }, [positions.map(p => p.symbol).join(',')])

  // Chart data derived from portfolio history
  const portfolioChartData = useMemo(() => {
    return portfolioHistory.map(s => s.equity)
  }, [portfolioHistory])

  // Use backend-provided timezone (falls back to ET if not set)
  const displayTimezone = status?.displayTimezone || 'America/New_York'

  const portfolioChartLabels = useMemo(() => {
    return portfolioHistory.map(s => {
      const date = new Date(s.timestamp)
      if (portfolioPeriod === '1D') {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: displayTimezone })
      }
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: displayTimezone })
    })
  }, [portfolioHistory, portfolioPeriod, displayTimezone])

  const { marketMarkers, marketHoursZone } = useMemo(() => {
    if (portfolioPeriod !== '1D' || portfolioHistory.length === 0) {
      return { marketMarkers: undefined, marketHoursZone: undefined }
    }

    // Use dynamic market schedule from Alpaca Calendar API (falls back to default NYSE hours)
    const schedule = status?.marketSchedule
    const marketOpenET = schedule?.open || '09:30'   // e.g. "09:30"
    const marketCloseET = schedule?.close || '16:00'  // e.g. "16:00"

    // Convert "HH:MM" to minutes-since-midnight for comparison
    const toMinutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
    const openMinutes = toMinutes(marketOpenET)
    const closeMinutes = toMinutes(marketCloseET)

    // Format timestamps in Eastern Time (market timezone) for accurate comparison
    const etFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })

    const markers: { index: number; label: string; color?: string; tooltip?: string[] }[] = []
    let openIndex = -1
    let closeIndex = -1

    const extendedHours = config?.extended_hours_allowed ?? false
    const exchanges = 'NYSE, NASDAQ, ARCA, AMEX, BATS'

    const openTooltip = [
      `REGULAR SESSION ${marketOpenET} ET`,
      exchanges,
      ...(extendedHours ? ['Pre-market: 04:00 - 09:30 ET'] : []),
    ]
    const closeTooltip = [
      `REGULAR SESSION ENDS ${marketCloseET} ET`,
      exchanges,
      ...(extendedHours ? ['After-hours: 16:00 - 20:00 ET'] : []),
    ]

    // Extended hours markers
    const preMarketOpen = toMinutes('04:00')
    const afterHoursClose = toMinutes('20:00')
    let preMarketIndex = -1
    let afterHoursIndex = -1

    portfolioHistory.forEach((s, i) => {
      const etTime = etFormatter.format(new Date(s.timestamp))
      const etMinutes = toMinutes(etTime)

      // Pre-market open marker (4:00 AM ET)
      if (extendedHours && etMinutes >= preMarketOpen && etMinutes < preMarketOpen + 15 && preMarketIndex === -1) {
        preMarketIndex = i
        markers.push({
          index: i, label: 'PRE-MKT', color: 'var(--color-hud-warning)',
          tooltip: ['PRE-MARKET OPEN 04:00 ET', exchanges, 'Limit orders only'],
        })
      }

      // Regular session open
      if (etMinutes >= openMinutes && etMinutes < openMinutes + 15 && openIndex === -1) {
        openIndex = i
        markers.push({ index: i, label: 'OPEN', color: 'var(--color-hud-success)', tooltip: openTooltip })
      }

      // Regular session close
      if (etMinutes >= closeMinutes && etMinutes < closeMinutes + 15 && closeIndex === -1) {
        closeIndex = i
        markers.push({ index: i, label: 'CLOSE', color: 'var(--color-hud-error)', tooltip: closeTooltip })
      }

      // After-hours close marker (8:00 PM ET)
      if (extendedHours && etMinutes >= afterHoursClose && etMinutes < afterHoursClose + 15 && afterHoursIndex === -1) {
        afterHoursIndex = i
        markers.push({
          index: i, label: 'AH-END', color: 'var(--color-hud-warning)',
          tooltip: ['AFTER-HOURS CLOSE 20:00 ET', exchanges, 'Limit orders only'],
        })
      }
    })

    const zone = openIndex >= 0 && closeIndex >= 0
      ? { openIndex, closeIndex }
      : undefined

    return {
      marketMarkers: markers.length > 0 ? markers : undefined,
      marketHoursZone: zone
    }
  }, [portfolioHistory, portfolioPeriod, status?.marketSchedule, config?.extended_hours_allowed])

  // Normalize position price histories to % change for stacked comparison view
  const normalizedPositionSeries = useMemo(() => {
    return positions.map((pos, idx) => {
      const priceHistory = positionPriceHistories[pos.symbol] || []
      if (priceHistory.length < 2) return null
      const startPrice = priceHistory[0]
      // Convert to % change from start
      const normalizedData = priceHistory.map(price => ((price - startPrice) / startPrice) * 100)
      return {
        label: pos.symbol,
        data: normalizedData,
        variant: positionColors[idx % positionColors.length],
      }
    }).filter(Boolean) as { label: string; data: number[]; variant: typeof positionColors[number] }[]
  }, [positions, positionPriceHistories])

  // Early returns (after all hooks)
  if (showSetup) {
    return <SetupWizard onComplete={() => setShowSetup(false)} />
  }

  if (error && !status) {
    const isAuthError = error.includes('Unauthorized')
    return (
      <div className="min-h-screen bg-hud-bg flex items-center justify-center p-6">
        <Panel title={isAuthError ? "AUTHENTICATION REQUIRED" : "CONNECTION ERROR"} className="max-w-md w-full">
          <div className="text-center py-8">
            <div className="text-hud-error text-2xl mb-4">{isAuthError ? "NO TOKEN" : "OFFLINE"}</div>
            <p className="text-hud-text-dim text-sm mb-6">{error}</p>
            {isAuthError ? (
              <div className="space-y-4">
                <div className="text-left bg-hud-panel p-4 border border-hud-line">
                  <label className="hud-label block mb-2">API Token</label>
                  <input
                    type="password"
                    className="hud-input w-full mb-2"
                    placeholder="Enter MAHORAGA_API_TOKEN"
                    defaultValue={localStorage.getItem('mahoraga_api_token') || ''}
                    onChange={(e) => localStorage.setItem('mahoraga_api_token', e.target.value)}
                  />
                  <button 
                    onClick={() => window.location.reload()}
                    className="hud-button w-full"
                  >
                    Save & Reload
                  </button>
                </div>
                <p className="text-hud-text-dim text-xs">
                  Find your token in <code className="text-hud-primary">.dev.vars</code> (local) or Cloudflare secrets (deployed)
                </p>
              </div>
            ) : (
              <p className="text-hud-text-dim text-xs">
                Enable the agent: <code className="text-hud-primary">curl -H "Authorization: Bearer $TOKEN" localhost:8787/agent/enable</code>
              </p>
            )}
          </div>
        </Panel>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-hud-bg">
      <div className="max-w-[1920px] mx-auto p-4">
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 pb-3 border-b border-hud-line relative after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1px] after:neon-stripe after:opacity-40">
          <div className="flex items-center gap-4 md:gap-6">
            <button
              onClick={() => {
                const next = !crtEnabled
                setCrtEnabled(next)
                localStorage.setItem('mahoraga_crt', String(next))
              }}
              className={clsx(
                'hud-label transition-colors hover:text-hud-primary',
                crtEnabled && 'crt-toggle-active'
              )}
              title={crtEnabled ? 'Disable CRT effect' : 'Enable CRT effect'}
            >
              [CRT]
            </button>
            <div className="flex items-baseline gap-2">
              <span className="text-xl md:text-2xl font-light tracking-tight text-hud-text-bright hud-title-glow">
                STONKS
              </span>
              <span className="hud-label">v2.5</span>
            </div>
            <StatusIndicator 
              status={isMarketOpen ? 'active' : 'inactive'} 
              label={isMarketOpen ? 'MARKET OPEN' : 'MARKET CLOSED'}
              pulse={isMarketOpen}
            />
          </div>
          <div className="flex items-center gap-3 md:gap-6 flex-wrap">
            <StatusBar
              items={[
                { label: 'LLM COST', value: `$${costs.total_usd.toFixed(4)}`, status: costs.total_usd > 1 ? 'warning' : 'active' },
                { label: 'API CALLS', value: costs.calls.toString() },
              ]}
            />
            <NotificationBell 
              overnightActivity={status?.overnightActivity}
              premarketPlan={status?.premarketPlan}
            />
            <button 
              className="hud-label hover:text-hud-primary transition-colors"
              onClick={() => setShowSettings(true)}
            >
              [CONFIG]
            </button>
            <span className="hud-value-sm font-mono">
              {time.toLocaleTimeString('en-US', { hour12: false, timeZone: displayTimezone })}
            </span>
          </div>
        </header>

        <div className="dashboard-grid grid grid-cols-4 md:grid-cols-8 lg:grid-cols-12 gap-4">
          {/* Row 1 @narrow: ACCOUNT | LLM COSTS */}
          <div className="panel-account col-span-4 md:col-span-4 lg:col-span-3">
            <Panel title="ACCOUNT" className="h-full">
              {account ? (
                <div className="space-y-4">
                  <Metric label="EQUITY" value={formatCurrency(account.equity)} size="xl" />
                  <div className="grid grid-cols-2 gap-4">
                    <Metric label="CASH" value={formatCurrency(account.cash)} size="md" />
                    <Metric label="BUYING POWER" value={formatCurrency(account.buying_power)} size="md" />
                  </div>
                  <div className="pt-2 border-t border-hud-line space-y-2">
                    <Metric 
                      label="DAILY P&L" 
                      value={`${formatCurrency(dailyPl)} (${formatPercent(dailyPlPct)})`}
                      size="md"
                      color={dailyPl >= 0 ? 'success' : 'error'}
                    />
                    <Metric 
                      label="TOTAL P&L" 
                      value={`${formatCurrency(totalPl)} (${formatPercent(totalPlPct)})`}
                      size="md"
                      color={totalPl >= 0 ? 'success' : 'error'}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <MetricInline 
                        label="REALIZED" 
                        value={formatCurrency(realizedPl)}
                        color={realizedPl >= 0 ? 'success' : 'error'}
                      />
                      <MetricInline 
                        label="UNREALIZED" 
                        value={formatCurrency(unrealizedPl)}
                        color={unrealizedPl >= 0 ? 'success' : 'error'}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-hud-text-dim text-sm">Loading...</div>
              )}
            </Panel>
          </div>

          {/* Row 2 @narrow: POSITIONS | POSITION PERFORMANCE */}
          <div className="panel-positions col-span-4 md:col-span-4 lg:col-span-5">
            <Panel title="POSITIONS" titleRight={`${positions.length}/${config?.max_positions || 5}`} className="h-full">
              {positions.length === 0 ? (
                <div className="text-hud-text-dim text-sm py-8 text-center">No open positions</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-hud-line/50">
                        <th className="hud-label text-left py-2 px-2">Symbol</th>
                        <th className="hud-label text-right py-2 px-2 hidden sm:table-cell">Shares</th>
                        <th className="hud-label text-right py-2 px-2 hidden md:table-cell">Value</th>
                        <th className="hud-label text-right py-2 px-2">Today P&L</th>
                        <th className="hud-label text-right py-2 px-2 hidden sm:table-cell">Total P&L</th>
                        <th className="hud-label text-right py-2 px-2 hidden lg:table-cell">Diversity</th>
                        <th className="hud-label text-center py-2 px-2">Trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const totalMarketValue = positions.reduce((sum: number, p: Position) => sum + p.market_value, 0)
                        return positions.map((pos: Position) => {
                          const totalPlPct = pos.cost_basis ? ((pos.unrealized_pl / pos.cost_basis) * 100) : ((pos.unrealized_pl / (pos.market_value - pos.unrealized_pl)) * 100)
                          const todayPlPct = pos.unrealized_intraday_plpc ? pos.unrealized_intraday_plpc * 100 : 0
                          const diversity = totalMarketValue > 0 ? (pos.market_value / totalMarketValue * 100) : 0
                          const priceHistory = positionPriceHistories[pos.symbol] || []
                          const posEntry = status?.positionEntries?.[pos.symbol]
                          const staleness = status?.stalenessAnalysis?.[pos.symbol]
                          const holdTime = posEntry ? Math.floor((Date.now() - posEntry.entry_time) / 3600000) : null
                          
                          return (
                            <motion.tr 
                              key={pos.symbol}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className="border-b border-hud-line/20 hover:bg-hud-line/10"
                            >
                              <td className="hud-value-sm py-2 px-2">
                                <SymbolDetailTooltip
                                  symbol={pos.symbol}
                                  posEntry={posEntry}
                                  staleness={staleness}
                                  holdTime={holdTime}
                                  currentPrice={pos.current_price}
                                  isCrypto={isCryptoSymbol(pos.symbol, config?.crypto_symbols)}
                                >
                                  <span className="cursor-help border-b border-dotted border-hud-text-dim">
                                    {isCryptoSymbol(pos.symbol, config?.crypto_symbols) && (
                                      <span className="text-hud-warning mr-1">₿</span>
                                    )}
                                    {pos.symbol}
                                  </span>
                                </SymbolDetailTooltip>
                              </td>
                              <td className="hud-value-sm text-right py-2 px-2 hidden sm:table-cell">{pos.qty}</td>
                              <td className="hud-value-sm text-right py-2 px-2 hidden md:table-cell">{formatCurrency(pos.market_value)}</td>
                              <td className={clsx(
                                'hud-value-sm text-right py-2 px-2',
                                (pos.unrealized_intraday_pl || 0) >= 0 ? 'text-hud-success' : 'text-hud-error'
                              )}>
                                <div>{formatCurrency(pos.unrealized_intraday_pl || 0)}</div>
                                <div className="text-xs opacity-70">{formatPercent(todayPlPct)}</div>
                              </td>
                              <td className={clsx(
                                'hud-value-sm text-right py-2 px-2 hidden sm:table-cell',
                                pos.unrealized_pl >= 0 ? 'text-hud-success' : 'text-hud-error'
                              )}>
                                <div>{formatCurrency(pos.unrealized_pl)}</div>
                                <div className="text-xs opacity-70">{formatPercent(totalPlPct)}</div>
                              </td>
                              <td className="hud-value-sm text-right py-2 px-2 hidden lg:table-cell text-hud-text-dim">
                                {diversity.toFixed(1)}%
                              </td>
                              <td className="py-2 px-2">
                                <div className="flex justify-center">
                                  <Sparkline data={priceHistory} width={60} height={20} />
                                </div>
                              </td>
                            </motion.tr>
                          )
                        })
                      })()}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          <div className="panel-llm-costs col-span-4 md:col-span-8 lg:col-span-4">
            <Panel title="LLM COSTS" titleRight={
              <button
                className="hud-label hover:text-hud-error transition-colors"
                onClick={async () => {
                  if (!confirm('Reset LLM cost tracking to zero?')) return
                  await authFetch(`${API_BASE}/costs`, { method: 'DELETE' })
                }}
                title="Reset cost tracker to zero"
              >
                [RESET]
              </button>
            } className="h-full">
              <div className="space-y-3">
                {/* Totals */}
                <div className="grid grid-cols-2 gap-4">
                  <Metric label="TOTAL SPENT" value={`$${costs.total_usd.toFixed(4)}`} size="lg" />
                  <Metric label="API CALLS" value={costs.calls.toString()} size="lg" />
                  <MetricInline label="TOKENS IN" value={costs.tokens_in.toLocaleString()} />
                  <MetricInline label="TOKENS OUT" value={costs.tokens_out.toLocaleString()} />
                  <MetricInline 
                    label="AVG COST/CALL" 
                    value={costs.calls > 0 ? `$${(costs.total_usd / costs.calls).toFixed(6)}` : '$0'} 
                  />
                </div>
                {/* Per-model breakdown */}
                <div className="border-t border-hud-line/30 pt-2 space-y-2">
                  {(() => {
                    const researchModel = config?.llm_model || 'gpt-4o-mini'
                    const analystModel = config?.llm_analyst_model || 'gpt-4o'
                    const byModel = costs.by_model || {}
                    const researchCost = byModel[researchModel]
                    const analystCost = byModel[analystModel]
                    return (
                      <>
                        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center text-hud-sm">
                          <span className="hud-label text-hud-xs">MODEL</span>
                          <span className="hud-label text-hud-xs text-right">CALLS</span>
                          <span className="hud-label text-hud-xs text-right">COST</span>
                        </div>
                        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center text-hud-sm">
                          <span className="text-hud-text truncate" title={researchModel}>
                            <span className="text-hud-text-dim">RES</span> {researchModel}
                          </span>
                          <span className="text-hud-text-dim text-right font-mono">{researchCost?.calls ?? 0}</span>
                          <span className="text-hud-text text-right font-mono">${(researchCost?.total_usd ?? 0).toFixed(4)}</span>
                        </div>
                        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center text-hud-sm">
                          <span className="text-hud-text truncate" title={analystModel}>
                            <span className="text-hud-text-dim">ANA</span> {analystModel}
                          </span>
                          <span className="text-hud-text-dim text-right font-mono">{analystCost?.calls ?? 0}</span>
                          <span className="text-hud-text text-right font-mono">${(analystCost?.total_usd ?? 0).toFixed(4)}</span>
                        </div>
                      </>
                    )
                  })()}
                </div>
              </div>
            </Panel>
          </div>

          {/* Row 3 @narrow: PORTFOLIO PERFORMANCE full width */}
          <div className="panel-portfolio col-span-4 md:col-span-8 lg:col-span-8">
            <Panel
              title="PORTFOLIO PERFORMANCE"
              titleRight={
                <div className="flex gap-2">
                  {(['1D', '1W', '1M'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setPortfolioPeriod(p)}
                      className={clsx(
                        'hud-label transition-colors',
                        portfolioPeriod === p ? 'text-hud-primary' : 'text-hud-text-dim hover:text-hud-text'
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              } 
              className="h-[320px]"
            >
              {portfolioChartData.length > 1 ? (
                <div className="h-full w-full">
                  <LineChart
                    series={[{ label: 'Equity', data: portfolioChartData, variant: dailyPl >= 0 ? 'green' : 'red' }]}
                    labels={portfolioChartLabels}
                    showArea={true}
                    showGrid={true}
                    showDots={false}
                    formatValue={(v) => `$${(v / 1000).toFixed(1)}k`}
                    markers={marketMarkers}
                    marketHours={marketHoursZone}
                    showChartTypeToggle={true}
                  />
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-hud-text-dim text-sm">
                  Collecting performance data...
                </div>
              )}
            </Panel>
          </div>

          <div className="panel-position-perf col-span-4 md:col-span-8 lg:col-span-4">
            <Panel title="POSITION PERFORMANCE" titleRight="% CHANGE" className="h-[320px]">
              {positions.length === 0 ? (
                <div className="h-full flex items-center justify-center text-hud-text-dim text-sm">
                  No positions to display
                </div>
              ) : normalizedPositionSeries.length > 0 ? (
                <div className="h-full flex flex-col">
                  {/* Legend */}
                  <div className="flex flex-wrap gap-3 mb-2 pb-2 border-b border-hud-line/30 shrink-0">
                    {positions.slice(0, 5).map((pos: Position, idx: number) => {
                      const isPositive = pos.unrealized_pl >= 0
                      const plPct = (pos.unrealized_pl / (pos.market_value - pos.unrealized_pl)) * 100
                      const color = positionColors[idx % positionColors.length]
                      return (
                        <div key={pos.symbol} className="flex items-center gap-1.5">
                          <div 
                            className="w-2 h-2 rounded-full" 
                            style={{ backgroundColor: `var(--color-hud-${color})` }}
                          />
                          <span className="hud-value-sm">{pos.symbol}</span>
                          <span className={clsx('hud-label', isPositive ? 'text-hud-success' : 'text-hud-error')}>
                            {formatPercent(plPct)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  {/* Stacked chart */}
                  <div className="flex-1 min-h-0 w-full">
                    <LineChart
                      series={normalizedPositionSeries.slice(0, 5)}
                      showArea={false}
                      showGrid={true}
                      showDots={false}
                      animated={false}
                      formatValue={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
                    />
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-hud-text-dim text-sm">
                  Loading position data...
                </div>
              )}
            </Panel>
          </div>

          {/* Row 4 @narrow: ACTIVE SIGNALS | ACTIVITY FEED */}
          <div className="panel-signals col-span-4 md:col-span-4 lg:col-span-4">
            <Panel title="ACTIVE SIGNALS" titleRight={signalFilter === 'all' ? signals.length.toString() : `${filteredSignals.length} / ${signals.length}`} className="h-80">
              <div className="flex flex-wrap gap-1 mb-2 shrink-0">
                {(['all', 'social', 'market_data', 'sec', 'crypto'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setSignalFilter(f)}
                    className={clsx(
                      'px-2 py-0.5 text-xs rounded border transition-colors',
                      signalFilter === f
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                        : 'border-hud-line/50 text-hud-text-dim hover:border-hud-line hover:text-hud-text'
                    )}
                  >
                    {f === 'all' ? 'ALL' : f === 'market_data' ? 'MARKET' : f.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="overflow-y-auto h-full space-y-1 flex-1 min-h-0">
                {filteredSignals.length === 0 ? (
                  <div className="text-hud-text-dim text-sm py-4 text-center">
                    {signals.length === 0 ? 'Gathering signals...' : `No ${signalFilter} signals`}
                  </div>
                ) : (
                  filteredSignals.map((sig: Signal, i: number) => (
                    <Tooltip
                      key={`${sig.symbol}-${sig.source}-${i}`}
                      position="right"
                      content={
                        <TooltipContent
                          title={`${sig.symbol} - ${sig.source.toUpperCase()}`}
                          items={[
                            { label: 'Sentiment', value: `${(sig.sentiment * 100).toFixed(0)}%`, color: getSentimentColor(sig.sentiment) },
                            { label: 'Volume', value: sig.volume },
                            ...(sig.bullish !== undefined ? [{ label: 'Bullish', value: sig.bullish, color: 'text-hud-success' }] : []),
                            ...(sig.bearish !== undefined ? [{ label: 'Bearish', value: sig.bearish, color: 'text-hud-error' }] : []),
                            ...(sig.score !== undefined ? [{ label: 'Score', value: sig.score }] : []),
                            ...(sig.upvotes !== undefined ? [{ label: 'Upvotes', value: sig.upvotes }] : []),
                            ...(sig.momentum !== undefined ? [{ label: 'Momentum', value: `${sig.momentum >= 0 ? '+' : ''}${sig.momentum.toFixed(2)}%` }] : []),
                            ...(sig.price !== undefined ? [{ label: 'Price', value: formatCurrency(sig.price) }] : []),
                          ]}
                          description={sig.reason}
                        />
                      }
                    >
                      <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.02 }}
                        className={clsx(
                          "flex items-center justify-between py-1 px-2 border-b border-hud-line/10 hover:bg-hud-line/10 cursor-help",
                          sig.isCrypto && "bg-hud-warning/5",
                          (sig.isCrypto
                            ? !(config?.crypto_symbols || []).includes(sig.symbol)
                            : (config?.ticker_blacklist || []).includes(sig.symbol)
                          ) && "opacity-40"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="hud-input w-3.5 h-3.5 shrink-0 accent-cyan-400 cursor-pointer"
                            checked={
                              sig.isCrypto
                                ? (config?.crypto_symbols || []).includes(sig.symbol)
                                : !(config?.ticker_blacklist || []).includes(sig.symbol)
                            }
                            onChange={(e) => {
                              e.stopPropagation()
                              handleToggleSignal(sig.symbol, !!sig.isCrypto, e.target.checked)
                            }}
                            title={sig.isCrypto
                              ? `Toggle ${sig.symbol} crypto trading`
                              : `Toggle ${sig.symbol} blacklist`}
                          />
                          {sig.isCrypto && <span className="text-hud-warning text-xs">₿</span>}
                          <span className="hud-value-sm">{sig.symbol}</span>
                          {sig.source_count != null && sig.source_count >= 2 && (
                            <span className="text-[10px] px-1 rounded bg-cyan-500/20 text-cyan-300 font-medium">STRONG</span>
                          )}
                          <span className={clsx('hud-label', sig.isCrypto ? 'text-hud-warning' : '')}>{sig.source.toUpperCase()}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {sig.isCrypto && sig.momentum !== undefined ? (
                            <span className={clsx('hud-label hidden sm:inline', sig.momentum >= 0 ? 'text-hud-success' : 'text-hud-error')}>
                              {sig.momentum >= 0 ? '+' : ''}{sig.momentum.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="hud-label hidden sm:inline">VOL {sig.volume}</span>
                          )}
                          <span className={clsx('hud-value-sm', getSentimentColor(sig.sentiment))}>
                            {(sig.sentiment * 100).toFixed(0)}%
                          </span>
                        </div>
                      </motion.div>
                    </Tooltip>
                  ))
                )}
              </div>
            </Panel>
          </div>

          <div className="panel-activity col-span-4 md:col-span-4 lg:col-span-4">
            <Panel title="ACTIVITY FEED" titleRight="LIVE" className="h-80">
              <div className="overflow-y-auto h-full font-mono text-xs space-y-1">
                {logs.length === 0 ? (
                  <div className="text-hud-text-dim py-4 text-center">Waiting for activity...</div>
                ) : (
                  logs.slice(-50).reverse().map((log: LogEntry, i: number) => (
                    <motion.div 
                      key={`${log.timestamp}-${i}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-start gap-2 py-1 border-b border-hud-line/10"
                    >
                      <span className="text-hud-text-dim shrink-0 hidden sm:inline w-[52px]">
                        {new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false, timeZone: displayTimezone })}
                      </span>
                      <span className={clsx('shrink-0 w-[72px] text-right', getAgentColor(log.agent))}>
                        {log.agent}
                      </span>
                      <span className="text-hud-text flex-1 text-right wrap-break-word">
                        {log.action}
                        {log.symbol && <span className="text-hud-primary ml-1">({log.symbol})</span>}
                      </span>
                    </motion.div>
                  ))
                )}

              </div>
            </Panel>
          </div>

          {/* Row 5 @narrow: SIGNAL RESEARCH full width */}
          <div className="panel-research col-span-4 md:col-span-8 lg:col-span-4">
            <Panel title="SIGNAL RESEARCH" titleRight={Object.keys(status?.signalResearch || {}).length.toString()} className="h-80">
              <div className="overflow-y-auto h-full space-y-2">
                {Object.entries(status?.signalResearch || {}).length === 0 ? (
                  <div className="text-hud-text-dim text-sm py-4 text-center">Researching candidates...</div>
                ) : (
                  Object.entries(status?.signalResearch || {})
                    .sort(([, a], [, b]) => (b.timestamp || 0) - (a.timestamp || 0))
                    .map(([symbol, raw]: [string, SignalResearch]) => {
                    const research = {
                      verdict: raw.verdict || 'WAIT',
                      confidence: raw.confidence ?? 0,
                      entry_quality: raw.entry_quality || 'fair',
                      reasoning: raw.reasoning || '',
                      red_flags: raw.red_flags || [],
                      catalysts: raw.catalysts || [],
                      sentiment: raw.sentiment ?? 0,
                      timestamp: raw.timestamp || 0,
                    }
                    return (
                    <Tooltip
                      key={symbol}
                      position="left"
                      content={
                        <div className="space-y-2 min-w-[200px]">
                          <div className="hud-label text-hud-primary border-b border-hud-line/50 pb-1">
                            {isCryptoSymbol(symbol, config?.crypto_symbols) && (
                              <span className="text-hud-warning text-xs" style={{ marginRight: '8px' }}>₿</span>
                            )}{symbol} DETAILS
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span className="text-hud-text-dim">Confidence</span>
                              <span className="text-hud-text-bright">{(research.confidence * 100).toFixed(0)}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-hud-text-dim">Sentiment</span>
                              <span className={getSentimentColor(research.sentiment)}>
                                {(research.sentiment * 100).toFixed(0)}%
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-hud-text-dim">Analyzed</span>
                              <span className="text-hud-text">
                                {new Date(research.timestamp).toLocaleTimeString('en-US', { hour12: false, timeZone: displayTimezone })}
                              </span>
                            </div>
                          </div>
                          {research.catalysts.length > 0 && (
                            <div className="pt-1 border-t border-hud-line/30">
                              <span className="text-hud-xs text-hud-text-dim">CATALYSTS:</span>
                              <ul className="mt-1 space-y-0.5">
                                {research.catalysts.map((c, i) => (
                                  <li key={i} className="text-hud-sm text-hud-success">+ {c}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {research.red_flags.length > 0 && (
                            <div className="pt-1 border-t border-hud-line/30">
                              <span className="text-hud-xs text-hud-text-dim">RED FLAGS:</span>
                              <ul className="mt-1 space-y-0.5">
                                {research.red_flags.map((f, i) => (
                                  <li key={i} className="text-hud-sm text-hud-error">- {f}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      }
                    >
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="p-2 border border-hud-line/30 rounded hover:border-hud-line/60 cursor-help transition-colors"
                      >
                        <div className="flex justify-between items-center mb-1">
                          <span className="hud-value-sm">
                            {isCryptoSymbol(symbol, config?.crypto_symbols) && (
                              <span className="text-hud-warning text-xs" style={{ marginRight: '8px' }}>₿</span>
                            )}{symbol}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className={clsx('hud-label', getQualityColor(research.entry_quality))}>
                              {research.entry_quality.toUpperCase()}
                            </span>
                            <span className={clsx('hud-value-sm font-bold', getVerdictColor(research.verdict))}>
                              {research.verdict}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-hud-text-dim leading-tight mb-1">{research.reasoning}</p>
                        {research.red_flags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {research.red_flags.slice(0, 2).map((flag, i) => (
                              <span key={i} className="text-xs text-hud-error bg-hud-error/10 px-1 rounded">
                                {flag.slice(0, 30)}...
                              </span>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    </Tooltip>
                  )})
                )}
              </div>
            </Panel>
          </div>
        </div>

        <footer className="mt-4 pt-3 border-t border-hud-line relative before:absolute before:top-0 before:left-0 before:right-0 before:h-[1px] before:neon-stripe before:opacity-40 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex flex-wrap gap-4 md:gap-6">
            {config && (
              <>
                <MetricInline label="MAX POS" value={`$${config.max_position_value}`} />
                <MetricInline label="MIN SENT" value={`${(config.min_sentiment_score * 100).toFixed(0)}%`} />
                <MetricInline label="TAKE PROFIT" value={`${config.take_profit_pct}%`} />
                <MetricInline label="STOP LOSS" value={`${config.stop_loss_pct}%`} />
                <span className="hidden lg:inline text-hud-line">|</span>
                <MetricInline 
                  label="OPTIONS" 
                  value={config.options_enabled ? 'ON' : 'OFF'} 
                  valueClassName={config.options_enabled ? 'text-hud-purple' : 'text-hud-text-dim'}
                />
                {config.options_enabled && (
                  <>
                    <MetricInline label="OPT Δ" value={config.options_target_delta?.toFixed(2) || '0.35'} />
                    <MetricInline label="OPT DTE" value={`${config.options_min_dte || 7}-${config.options_max_dte || 45}`} />
                  </>
                )}
                <span className="hidden lg:inline text-hud-line">|</span>
                <MetricInline 
                  label="CRYPTO" 
                  value={config.crypto_enabled ? '24/7' : 'OFF'} 
                  valueClassName={config.crypto_enabled ? 'text-hud-warning' : 'text-hud-text-dim'}
                />
                {config.crypto_enabled && (
                  <MetricInline label="SYMBOLS" value={(config.crypto_symbols || ['BTC', 'ETH', 'SOL']).map(s => s.split('/')[0]).join('/')} />
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="hud-label hidden md:inline">AUTONOMOUS TRADING SYSTEM</span>
            <span className="hud-value-sm">PAPER MODE</span>
          </div>
        </footer>
      </div>

      <AnimatePresence>
        {showSettings && config && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <SettingsModal 
              config={config} 
              onSave={handleSaveConfig} 
              onClose={() => setShowSettings(false)}
              cryptoAssets={cryptoAssets}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <CrtEffect enabled={crtEnabled} />
    </div>
  )
}
