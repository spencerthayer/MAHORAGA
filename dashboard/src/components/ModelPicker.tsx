import { useState, useMemo, useRef, useEffect } from 'react'
import clsx from 'clsx'
import type { OpenRouterModel } from '../types'

type SortMode = 'price-asc' | 'price-desc' | 'name'

interface ModelPickerProps {
  models: OpenRouterModel[]
  loading: boolean
  error: string | null
  value: string
  onChange: (modelId: string) => void
  label: string
}

function formatPrice(price: number): string {
  if (price === 0) return 'FREE'
  if (price < 0.01) return `$${price.toFixed(4)}`
  if (price < 1) return `$${price.toFixed(3)}`
  return `$${price.toFixed(2)}`
}

function getProviderFromId(id: string): string {
  const slash = id.indexOf('/')
  return slash > 0 ? id.slice(0, slash) : id
}

export function ModelPicker({ models, loading, error, value, onChange, label }: ModelPickerProps) {
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<SortMode>('price-asc')
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Scroll selected item into view when opening
  useEffect(() => {
    if (isOpen && listRef.current && value) {
      const selected = listRef.current.querySelector('[data-selected="true"]')
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [isOpen, value])

  const filteredModels = useMemo(() => {
    let result = models

    if (filter) {
      const q = filter.toLowerCase()
      result = result.filter(
        (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
      )
    }

    const sorted = [...result]
    switch (sort) {
      case 'price-asc':
        sorted.sort((a, b) => a.combinedPricePer1M - b.combinedPricePer1M || a.id.localeCompare(b.id))
        break
      case 'price-desc':
        sorted.sort((a, b) => b.combinedPricePer1M - a.combinedPricePer1M || a.id.localeCompare(b.id))
        break
      case 'name':
        sorted.sort((a, b) => a.id.localeCompare(b.id))
        break
    }

    return sorted
  }, [models, filter, sort])

  const selectedModel = models.find((m) => m.id === value)

  const cycleSortMode = () => {
    setSort((prev) => {
      if (prev === 'price-asc') return 'price-desc'
      if (prev === 'price-desc') return 'name'
      return 'price-asc'
    })
  }

  const sortLabel = sort === 'price-asc' ? 'PRICE \u25B2' : sort === 'price-desc' ? 'PRICE \u25BC' : 'NAME'

  if (loading) {
    return (
      <div>
        <label className="hud-label block mb-1">{label}</label>
        <div className="hud-input w-full text-hud-text-dim">Loading models...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <label className="hud-label block mb-1">{label}</label>
        <div className="hud-input w-full text-hud-error">Error: {error}</div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <label className="hud-label block mb-1">{label}</label>

      {/* Trigger button */}
      <button
        type="button"
        className="hud-input w-full text-left flex items-center justify-between gap-2"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="truncate">
          {selectedModel ? selectedModel.id : value || 'Select a model...'}
        </span>
        <span className="shrink-0 flex items-center gap-2">
          {selectedModel && (
            <span className={clsx(
              'text-[9px]',
              selectedModel.combinedPricePer1M === 0 ? 'text-hud-success' : 'text-hud-text-dim'
            )}>
              {formatPrice(selectedModel.combinedPricePer1M)}/1M
            </span>
          )}
          <span className="text-hud-text-dim">{isOpen ? '\u25B4' : '\u25BE'}</span>
        </span>
      </button>

      {/* Fullscreen overlay dropdown */}
      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setIsOpen(false); setFilter('') } }}
        >
          <div className="w-full max-w-2xl max-h-[80vh] flex flex-col hud-panel border border-hud-line shadow-lg">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-hud-line/50 shrink-0">
              <span className="hud-label text-hud-primary">{label}</span>
              <button
                type="button"
                className="hud-label hover:text-hud-primary transition-colors"
                onClick={() => { setIsOpen(false); setFilter('') }}
              >
                [CLOSE]
              </button>
            </div>

            {/* Search + sort bar */}
            <div className="flex items-center gap-2 p-3 border-b border-hud-line/50 shrink-0">
              <input
                type="text"
                className="hud-input flex-1"
                placeholder="Filter models..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                className="hud-label shrink-0 hover:text-hud-primary transition-colors px-2 py-1"
                onClick={cycleSortMode}
                title="Cycle sort: price asc, price desc, name"
              >
                {sortLabel}
              </button>
            </div>

            {/* Model count */}
            <div className="px-3 py-1 border-b border-hud-line/30 shrink-0">
              <span className="text-[9px] text-hud-text-dim">
                {filteredModels.length} of {models.length} models
              </span>
            </div>

            {/* Model list */}
            <div ref={listRef} className="flex-1 overflow-y-auto min-h-0">
            {filteredModels.length === 0 ? (
              <div className="p-3 text-center text-hud-text-dim text-xs">
                No models match "{filter}"
              </div>
            ) : (
              filteredModels.map((m) => {
                const isSelected = m.id === value
                const provider = getProviderFromId(m.id)
                const isFree = m.combinedPricePer1M === 0

                return (
                  <button
                    key={m.id}
                    type="button"
                    data-selected={isSelected}
                    className={clsx(
                      'w-full text-left px-2 py-1.5 flex items-center gap-2 transition-colors border-b border-hud-line/10',
                      isSelected
                        ? 'bg-hud-primary/10 text-hud-text-bright'
                        : 'hover:bg-hud-line/10 text-hud-text'
                    )}
                    onClick={() => {
                      onChange(m.id)
                      setIsOpen(false)
                      setFilter('')
                    }}
                  >
                    {/* Selection indicator */}
                    <span className={clsx('w-2 shrink-0', isSelected ? 'text-hud-primary' : 'opacity-0')}>
                      *
                    </span>

                    {/* Model info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-hud-text-dim bg-hud-bg px-1 rounded shrink-0">
                          {provider}
                        </span>
                        <span className="hud-value-sm truncate">{m.id.split('/').slice(1).join('/')}</span>
                      </div>
                    </div>

                    {/* Context length */}
                    <span className="text-[9px] text-hud-text-dim shrink-0 hidden sm:inline">
                      {m.contextLength >= 1000000
                        ? `${(m.contextLength / 1000000).toFixed(1)}M`
                        : `${Math.round(m.contextLength / 1000)}k`}
                    </span>

                    {/* Price */}
                    <span className={clsx(
                      'text-[10px] shrink-0 w-16 text-right font-mono',
                      isFree ? 'text-hud-success' : 'text-hud-text-dim'
                    )}>
                      {isFree ? 'FREE' : `$${m.combinedPricePer1M < 1 ? m.combinedPricePer1M.toFixed(3) : m.combinedPricePer1M.toFixed(2)}`}
                    </span>
                  </button>
                )
              })
            )}
          </div>

            {/* Footer */}
            <div className="px-3 py-2 border-t border-hud-line/50 shrink-0">
              <span className="text-[8px] text-hud-text-dim">
                Combined price (in + out) per 1M tokens in USD
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
