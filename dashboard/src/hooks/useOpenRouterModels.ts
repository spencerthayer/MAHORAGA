import { useState, useEffect, useRef } from 'react'
import type { OpenRouterModel } from '../types'

interface OpenRouterApiModel {
  id: string
  name: string
  context_length: number
  pricing?: {
    prompt?: string
    completion?: string
  }
}

interface OpenRouterApiResponse {
  data: OpenRouterApiModel[]
}

// Module-level cache so we only fetch once across component remounts
let cachedModels: OpenRouterModel[] | null = null

function parseModels(data: OpenRouterApiModel[]): OpenRouterModel[] {
  return data
    .map((m) => {
      const promptPerToken = parseFloat(m.pricing?.prompt || '0') || 0
      const completionPerToken = parseFloat(m.pricing?.completion || '0') || 0
      const promptPricePer1M = promptPerToken * 1_000_000
      const completionPricePer1M = completionPerToken * 1_000_000

      return {
        id: m.id,
        name: m.name,
        contextLength: m.context_length || 0,
        promptPricePer1M: Math.round(promptPricePer1M * 10000) / 10000,
        completionPricePer1M: Math.round(completionPricePer1M * 10000) / 10000,
        combinedPricePer1M: Math.round((promptPricePer1M + completionPricePer1M) * 10000) / 10000,
      }
    })
    .sort((a, b) => a.combinedPricePer1M - b.combinedPricePer1M)
}

export function useOpenRouterModels(enabled: boolean) {
  const [models, setModels] = useState<OpenRouterModel[]>(cachedModels || [])
  const [loading, setLoading] = useState(!cachedModels && enabled)
  const [error, setError] = useState<string | null>(null)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (!enabled || cachedModels || fetchedRef.current) {
      if (cachedModels && models.length === 0) {
        setModels(cachedModels)
      }
      return
    }

    fetchedRef.current = true
    setLoading(true)

    fetch('https://openrouter.ai/api/v1/models')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<OpenRouterApiResponse>
      })
      .then((data) => {
        const parsed = parseModels(data.data || [])
        cachedModels = parsed
        setModels(parsed)
        setError(null)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to fetch models')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [enabled, models.length])

  return { models, loading, error }
}
