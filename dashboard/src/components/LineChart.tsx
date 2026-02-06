import { motion } from 'motion/react'
import { useState, useRef } from 'react'

type ChartVariant = 'cyan' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'primary'

interface LineChartSeries {
  label: string
  data: number[]
  variant?: ChartVariant
}

interface ChartMarker {
  index: number
  label: string
  color?: string
  tooltip?: string[]
}

interface MarketHoursZone {
  openIndex: number
  closeIndex: number
}

export type ChartViewMode = 'line' | 'candle' | 'both'

interface OHLC {
  open: number
  high: number
  low: number
  close: number
}

interface LineChartProps {
  series: LineChartSeries[]
  labels?: string[]
  variant?: ChartVariant
  height?: number
  showDots?: boolean
  showGrid?: boolean
  showArea?: boolean
  animated?: boolean
  formatValue?: (value: number) => string
  markers?: ChartMarker[]
  marketHours?: MarketHoursZone
  /** When true, shows Line / Candle / Both toggle and candlestick layer (5-min) under the line */
  showChartTypeToggle?: boolean
}

const variantColors: Record<ChartVariant, { stroke: string; fill: string }> = {
  cyan: { stroke: 'var(--color-hud-cyan)', fill: 'var(--color-hud-cyan)' },
  blue: { stroke: 'var(--color-hud-blue)', fill: 'var(--color-hud-blue)' },
  green: { stroke: 'var(--color-hud-green)', fill: 'var(--color-hud-green)' },
  yellow: { stroke: 'var(--color-hud-yellow)', fill: 'var(--color-hud-yellow)' },
  red: { stroke: 'var(--color-hud-red)', fill: 'var(--color-hud-red)' },
  purple: { stroke: 'var(--color-hud-purple)', fill: 'var(--color-hud-purple)' },
  primary: { stroke: 'var(--color-hud-primary)', fill: 'var(--color-hud-primary)' },
}

/** Build 5-min OHLC candles from 15-min line data (3 candles per interval). */
function deriveFiveMinCandles(lineData: number[]): OHLC[] {
  if (lineData.length < 2) return []
  const candles: OHLC[] = []
  for (let i = 0; i < lineData.length - 1; i++) {
    const a = lineData[i]
    const b = lineData[i + 1]
    const mid1 = a * 2 / 3 + b * 1 / 3
    const mid2 = a * 1 / 3 + b * 2 / 3
    candles.push({ open: a, high: Math.max(a, mid1), low: Math.min(a, mid1), close: mid1 })
    candles.push({ open: mid1, high: Math.max(mid1, mid2), low: Math.min(mid1, mid2), close: mid2 })
    candles.push({ open: mid2, high: Math.max(mid2, b), low: Math.min(mid2, b), close: b })
  }
  return candles
}

export function LineChart({
  series,
  labels,
  variant = 'cyan',
  height,
  showDots = false,
  showGrid = true,
  showArea = true,
  animated = true,
  formatValue,
  markers,
  marketHours,
  showChartTypeToggle = false,
}: LineChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [hoverMarker, setHoverMarker] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<ChartViewMode>('both')
  const svgRef = useRef<SVGSVGElement>(null)

  const viewBoxWidth = 800
  const viewBoxHeight = height || 200
  const padding = { top: 16, right: 16, bottom: 24, left: 48 }
  const chartWidth = viewBoxWidth - padding.left - padding.right
  const chartHeight = viewBoxHeight - padding.top - padding.bottom

  const lineData = series[0]?.data ?? []
  const maxPoints = Math.max(...series.map((s) => s.data.length), 1)
  const candleData = showChartTypeToggle && lineData.length >= 2 ? deriveFiveMinCandles(lineData) : []
  const candleCount = candleData.length

  const allValues = series.flatMap((s) => s.data)
  const candleExtrema = candleData.length > 0
    ? { min: Math.min(...candleData.map((c) => c.low)), max: Math.max(...candleData.map((c) => c.high)) }
    : null
  const dataMin = candleExtrema && (viewMode === 'candle' || viewMode === 'both')
    ? Math.min(Math.min(...allValues), candleExtrema.min)
    : Math.min(...allValues)
  const dataMax = candleExtrema && (viewMode === 'candle' || viewMode === 'both')
    ? Math.max(Math.max(...allValues), candleExtrema.max)
    : Math.max(...allValues)
  const range = dataMax - dataMin || 1
  const minValue = dataMin - range * 0.05
  const maxValue = dataMax + range * 0.05
  const valueRange = maxValue - minValue || 1

  const getX = (index: number) => padding.left + (index / (maxPoints - 1 || 1)) * chartWidth
  const getXCandle = (candleIndex: number) =>
    candleCount > 1
      ? padding.left + (candleIndex / (candleCount - 1)) * chartWidth
      : padding.left + chartWidth / 2
  const getY = (value: number) => padding.top + chartHeight - ((value - minValue) / valueRange) * chartHeight
  const getIndexFromX = (x: number) => {
    if (viewMode === 'candle' && candleCount > 0) {
      const candleIndex = Math.round(((x - padding.left) / chartWidth) * (candleCount - 1))
      return Math.max(0, Math.min(candleIndex, candleCount - 1))
    }
    return Math.round(((x - padding.left) / chartWidth) * (maxPoints - 1))
  }
  const gridLines = 4
  const gridValues = Array.from({ length: gridLines }, (_, i) => minValue + (valueRange / (gridLines - 1)) * i)

  const formatLabel = formatValue || ((v: number) => {
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`
    return v.toFixed(0)
  })

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const svgPt = pt.matrixTransform(ctm.inverse())
    const x = svgPt.x
    const index = getIndexFromX(x)
    if (viewMode === 'candle') {
      if (index >= 0 && index < candleCount) setHoverIndex(index)
      else setHoverIndex(null)
    } else {
      if (index >= 0 && index < maxPoints) setHoverIndex(index)
      else setHoverIndex(null)
    }
  }

  const handleMouseLeave = () => { setHoverIndex(null); setHoverMarker(null) }

  const hoverValue =
    hoverIndex === null
      ? null
      : viewMode === 'candle'
        ? candleData[hoverIndex]?.close ?? null
        : series[0]?.data[hoverIndex] ?? null
  const hoverLabel =
    hoverIndex === null
      ? null
      : viewMode === 'candle'
        ? null
        : labels?.[hoverIndex] ?? null
  const hoverX = hoverIndex !== null
    ? (viewMode === 'candle' ? getXCandle(hoverIndex) : getX(hoverIndex))
    : 0

  const chartContent = (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
      preserveAspectRatio="xMidYMid meet"
      className="block"
      style={{ overflow: 'hidden', cursor: 'crosshair' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {showGrid && (
        <g>
          {gridValues.map((value, i) => (
            <g key={i}>
              <line
                x1={padding.left}
                y1={getY(value)}
                x2={viewBoxWidth - padding.right}
                y2={getY(value)}
                stroke="currentColor"
                className="text-hud-border"
                strokeWidth={0.5}
                opacity={0.3}
              />
              <text
                x={padding.left - 6}
                y={getY(value)}
                textAnchor="end"
                dominantBaseline="middle"
                fill="currentColor"
                className="text-hud-text-dim"
                fontSize={9}
              >
                {formatLabel(value)}
              </text>
            </g>
          ))}
        </g>
      )}

      {labels && (
        <g>
          {labels.filter((_, i) => i % Math.ceil(labels.length / 6) === 0).map((label, i) => {
            const actualIndex = i * Math.ceil(labels.length / 6)
            return (
              <text
                key={i}
                x={getX(actualIndex)}
                y={viewBoxHeight - 6}
                textAnchor="middle"
                fill="currentColor"
                className="text-hud-text-dim"
                fontSize={9}
              >
                {label}
              </text>
            )
          })}
        </g>
      )}

      {marketHours && (
        <>
          {marketHours.openIndex > 0 && (
            <rect
              x={padding.left}
              y={padding.top}
              width={getX(marketHours.openIndex) - padding.left}
              height={chartHeight}
              fill="var(--color-hud-bg)"
              opacity={0.6}
            />
          )}
          {marketHours.closeIndex < maxPoints - 1 && (
            <rect
              x={getX(marketHours.closeIndex)}
              y={padding.top}
              width={viewBoxWidth - padding.right - getX(marketHours.closeIndex)}
              height={chartHeight}
              fill="var(--color-hud-bg)"
              opacity={0.6}
            />
          )}
        </>
      )}

      {markers && markers.map((marker, i) => {
        const mx = getX(marker.index)
        return (
          <g key={`marker-${i}`}>
            <line
              x1={mx}
              y1={padding.top}
              x2={mx}
              y2={padding.top + chartHeight}
              stroke={marker.color || 'var(--color-hud-text-dim)'}
              strokeWidth={1}
              strokeDasharray="4,4"
              opacity={0.5}
            />
            {/* Invisible wider hit area for hover */}
            <rect
              x={mx - 24}
              y={padding.top - 14}
              width={48}
              height={chartHeight + 14}
              fill="transparent"
              style={{ cursor: marker.tooltip ? 'pointer' : 'default' }}
              onMouseEnter={() => marker.tooltip && setHoverMarker(i)}
              onMouseLeave={() => setHoverMarker(null)}
            />
            <text
              x={mx}
              y={padding.top - 4}
              textAnchor="middle"
              fill={marker.color || 'var(--color-hud-text-dim)'}
              fontSize={8}
              style={{ pointerEvents: 'none' }}
            >
              {marker.label}
            </text>
          </g>
        )
      })}

      {(viewMode === 'line' || viewMode === 'both') && series.map((s, seriesIndex) => {
        const colors = variantColors[s.variant ?? variant]
        const points = s.data.map((value, i) => ({ x: getX(i), y: getY(value) }))
        if (points.length === 0) return null

        const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
        const areaD = `${pathD} L ${points[points.length - 1]?.x ?? 0} ${padding.top + chartHeight} L ${points[0]?.x ?? 0} ${padding.top + chartHeight} Z`

        return (
          <g key={seriesIndex}>
            {showArea && (
              <defs>
                <linearGradient id={`area-gradient-${seriesIndex}`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={colors.fill} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={colors.fill} stopOpacity={0} />
                </linearGradient>
              </defs>
            )}

            {showArea && (
              <motion.path
                d={areaD}
                fill={`url(#area-gradient-${seriesIndex})`}
                initial={animated ? { opacity: 0 } : undefined}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8 }}
              />
            )}

            <motion.path
              d={pathD}
              fill="none"
              stroke={showChartTypeToggle && viewMode === 'both' ? 'var(--color-hud-dim)' : colors.stroke}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.8}
              initial={animated ? { pathLength: 0 } : undefined}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            />

            {showDots &&
              points.map((p, i) => (
                <motion.circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={2}
                  fill={colors.fill}
                  opacity={0.8}
                  initial={animated ? { scale: 0 } : undefined}
                  animate={{ scale: 1 }}
                  transition={{ delay: i * 0.03, duration: 0.2 }}
                />
              ))}
          </g>
        )
      })}

      {/* Candlestick layer (5-min) — drawn above the line when viewMode is candle or both */}
      {showChartTypeToggle && candleData.length > 0 && (viewMode === 'candle' || viewMode === 'both') && (
        <g aria-hidden="true">
          {candleData.map((c, i) => {
            const x = getXCandle(i)
            const cw = Math.max(2, (chartWidth / (candleCount + 1)) * 0.6)
            const openY = getY(c.open)
            const closeY = getY(c.close)
            const highY = getY(c.high)
            const lowY = getY(c.low)
            const isUp = c.close >= c.open
            const bodyTop = Math.min(openY, closeY)
            const bodyHeight = Math.max(1, Math.abs(closeY - openY))
            return (
              <g key={i}>
                <line x1={x} y1={highY} x2={x} y2={lowY} stroke={isUp ? 'var(--color-hud-green)' : 'var(--color-hud-red)'} strokeWidth={1} opacity={0.7} />
                <rect x={x - cw / 2} y={bodyTop} width={cw} height={bodyHeight} fill={isUp ? 'var(--color-hud-green)' : 'var(--color-hud-red)'} opacity={viewMode === 'both' ? 0.35 : 0.6} stroke="none" />
              </g>
            )
          })}
        </g>
      )}

      {hoverIndex !== null && hoverValue !== null && hoverMarker === null && (() => {
        const hoverY = getY(hoverValue)
        const tooltipWidth = 85
        const tooltipHeight = 38
        const nearRightEdge = hoverX > viewBoxWidth - padding.right - tooltipWidth - 20
        const tooltipX = nearRightEdge ? hoverX - tooltipWidth - 12 : hoverX + 12
        const tooltipY = Math.min(Math.max(hoverY - tooltipHeight / 2, padding.top), padding.top + chartHeight - tooltipHeight)
        
        return (
          <g>
            <line
              x1={hoverX}
              y1={padding.top}
              x2={hoverX}
              y2={padding.top + chartHeight}
              stroke="var(--color-hud-text-dim)"
              strokeWidth={1}
              opacity={0.6}
            />
            <circle
              cx={hoverX}
              cy={hoverY}
              r={4}
              fill="var(--color-hud-bg)"
              stroke={variantColors[series[0]?.variant ?? variant].stroke}
              strokeWidth={2}
            />
            <g transform={`translate(${tooltipX}, ${tooltipY})`}>
              <rect
                x={0}
                y={0}
                width={tooltipWidth}
                height={tooltipHeight}
                fill="var(--color-hud-bg)"
                stroke="var(--color-hud-line)"
                strokeWidth={1}
                rx={2}
              />
              <text x={8} y={15} fill="var(--color-hud-text)" fontSize={11} fontWeight="500">
                {formatLabel(hoverValue)}
              </text>
              {hoverLabel && (
                <text x={8} y={30} fill="var(--color-hud-text-dim)" fontSize={9}>
                  {hoverLabel}
                </text>
              )}
            </g>
          </g>
        )
      })()}

      {/* Marker tooltip - rendered last so it's always on top of chart lines */}
      {hoverMarker !== null && markers?.[hoverMarker]?.tooltip && (() => {
        const marker = markers[hoverMarker]
        const tooltip = marker.tooltip!
        const mx = getX(marker.index)
        const lineHeight = 14
        const tooltipPadX = 10
        const tooltipPadY = 8
        // Measure width: ~6px per char at 9px monospace is reliable
        const charW = 6
        const longestLine = Math.max(...tooltip.map(l => l.length))
        const tooltipW = Math.ceil(longestLine * charW) + tooltipPadX * 2
        const tooltipH = tooltipPadY * 2 + tooltip.length * lineHeight
        // Vertical: just below the marker label text
        const ty = padding.top + 2
        // Horizontal: prefer right of marker line, flip left if near edge
        const nearRight = mx + tooltipW + 12 > viewBoxWidth - padding.right
        const nearLeft = mx - tooltipW - 8 < padding.left
        const tx = nearRight && !nearLeft ? mx - tooltipW - 8 : mx + 8

        return (
          <g style={{ pointerEvents: 'none' }}>
            <rect
              x={tx}
              y={ty}
              width={tooltipW}
              height={tooltipH}
              fill="rgba(13, 17, 23, 0.85)"
              stroke={marker.color || 'var(--color-hud-line)'}
              strokeWidth={1}
              rx={3}
            />
            {tooltip.map((line, j) => (
              <text
                key={j}
                x={tx + tooltipPadX}
                y={ty + tooltipPadY + (j + 1) * lineHeight - 3}
                fill={j === 0 ? (marker.color || 'var(--color-hud-text)') : 'var(--color-hud-text-dim)'}
                fontSize={9}
                fontWeight={j === 0 ? 600 : 400}
                fontFamily="monospace"
              >
                {line}
              </text>
            ))}
          </g>
        )
      })()}
    </svg>
  )

  if (showChartTypeToggle) {
    return (
      <div className="relative h-full w-full">
        {chartContent}
        <div className="absolute top-2 right-2 flex gap-1 z-10" style={{ pointerEvents: 'auto' }}>
          {(['line', 'candle', 'both'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`hud-label transition-colors px-1.5 py-0.5 rounded ${viewMode === mode ? 'text-hud-primary bg-hud-bg/80' : 'text-hud-text-dim hover:text-hud-text'}`}
            >
              {mode === 'line' ? 'Line' : mode === 'candle' ? 'Candle' : 'Both'}
            </button>
          ))}
        </div>
      </div>
    )
  }
  return chartContent
}

// Mini sparkline chart for inline use
interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  variant?: ChartVariant
  showChange?: boolean
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
}: SparklineProps) {
  if (data.length < 2) return null

  const padding = 2
  const chartWidth = width - padding * 2
  const chartHeight = height - padding * 2

  const minValue = Math.min(...data)
  const maxValue = Math.max(...data)
  const valueRange = maxValue - minValue || 1

  const points = data.map((value, i) => ({
    x: padding + (i / (data.length - 1)) * chartWidth,
    y: padding + chartHeight - ((value - minValue) / valueRange) * chartHeight,
  }))

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const isPositive = data[data.length - 1] >= data[0]

  return (
    <svg width={width} height={height}>
      <path
        d={pathD}
        fill="none"
        stroke={isPositive ? variantColors.green.stroke : variantColors.red.stroke}
        strokeWidth={1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
