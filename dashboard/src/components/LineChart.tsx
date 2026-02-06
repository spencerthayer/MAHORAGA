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
}: LineChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [hoverMarker, setHoverMarker] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const viewBoxWidth = 800
  const viewBoxHeight = height || 200
  const padding = { top: 16, right: 16, bottom: 24, left: 48 }
  const chartWidth = viewBoxWidth - padding.left - padding.right
  const chartHeight = viewBoxHeight - padding.top - padding.bottom

  const allValues = series.flatMap((s) => s.data)
  const dataMin = Math.min(...allValues)
  const dataMax = Math.max(...allValues)
  const range = dataMax - dataMin || 1
  const minValue = dataMin - range * 0.05
  const maxValue = dataMax + range * 0.05
  const valueRange = maxValue - minValue || 1

  const maxPoints = Math.max(...series.map((s) => s.data.length), 1)

  const getX = (index: number) => padding.left + (index / (maxPoints - 1 || 1)) * chartWidth
  const getY = (value: number) => padding.top + chartHeight - ((value - minValue) / valueRange) * chartHeight
  const getIndexFromX = (x: number) => Math.round(((x - padding.left) / chartWidth) * (maxPoints - 1))

  const gridLines = 4
  const gridValues = Array.from({ length: gridLines }, (_, i) => minValue + (valueRange / (gridLines - 1)) * i)

  const formatLabel = formatValue || ((v: number) => {
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`
    return v.toFixed(0)
  })

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const scaleX = viewBoxWidth / rect.width
    const x = (e.clientX - rect.left) * scaleX
    const index = getIndexFromX(x)
    if (index >= 0 && index < maxPoints) {
      setHoverIndex(index)
    } else {
      setHoverIndex(null)
    }
  }

  const handleMouseLeave = () => { setHoverIndex(null); setHoverMarker(null) }

  const hoverValue = hoverIndex !== null ? series[0]?.data[hoverIndex] : null
  const hoverLabel = hoverIndex !== null && labels ? labels[hoverIndex] : null

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
      preserveAspectRatio="xMidYMid meet"
      className="block"
      style={{ overflow: 'hidden' }}
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

      {series.map((s, seriesIndex) => {
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
              stroke={colors.stroke}
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

      {hoverIndex !== null && hoverValue !== null && hoverMarker === null && (() => {
        const hoverX = getX(hoverIndex)
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
