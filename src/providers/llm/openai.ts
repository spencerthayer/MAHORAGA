import { createError, ErrorCode } from "../../lib/errors";
import type { CompletionParams, CompletionResult, LLMProvider } from "../types";

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

interface OpenAIResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    /** Actual cost in USD (provided by OpenRouter, not by direct OpenAI) */
    cost?: number;
  };
}

interface OpenRouterModel {
  id: string;
  pricing: {
    prompt: string; // $ per token (string)
    completion: string; // $ per token (string)
  };
  supported_parameters?: string[];
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

interface CachedModelInfo {
  pricing: { prompt: number; completion: number };
  supportedParams: Set<string>;
}

export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private isOpenRouter: boolean;
  /** Cached model info from OpenRouter's /models endpoint: pricing + supported parameters */
  private modelCache: Map<string, CachedModelInfo> = new Map();
  private modelFetchPromise: Promise<void> | null = null;

  constructor(config: OpenAIConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "gpt-4o-mini";
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").trim().replace(/\/+$/, "");
    this.isOpenRouter = this.baseUrl.includes("openrouter.ai");
  }

  /**
   * Fetch and cache model info (pricing + supported_parameters) from OpenRouter's /models endpoint.
   * Only fetches once; subsequent calls return immediately.
   */
  private async ensureModelInfo(): Promise<void> {
    if (!this.isOpenRouter || this.modelCache.size > 0) return;

    // Deduplicate concurrent fetches
    if (this.modelFetchPromise) {
      await this.modelFetchPromise;
      return;
    }

    this.modelFetchPromise = (async () => {
      try {
        const res = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        });
        if (res.ok) {
          const data = (await res.json()) as OpenRouterModelsResponse;
          for (const model of data.data) {
            if (model.pricing) {
              const prompt = parseFloat(model.pricing.prompt);
              const completion = parseFloat(model.pricing.completion);
              if (!isNaN(prompt) && !isNaN(completion)) {
                this.modelCache.set(model.id, {
                  pricing: { prompt, completion },
                  supportedParams: new Set(model.supported_parameters ?? []),
                });
              }
            }
          }
          console.log(`[LLM] Cached pricing for ${this.modelCache.size} OpenRouter models`);
          // #region agent log
          fetch('http://127.0.0.1:7246/ingest/e74a6fed-0be4-43c3-aabb-46a1af95b1a3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'openai.ts:ensureModelInfo',message:'pricing_fetched',data:{modelCount:this.modelCache.size},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H5'})}).catch(()=>{});
          // #endregion
        }
      } catch (err) {
        console.warn("[LLM] Failed to fetch OpenRouter model info:", err);
      }
    })();

    await this.modelFetchPromise;
  }

  /**
   * Calculate cost from token counts using cached OpenRouter pricing.
   * Returns undefined if pricing is unavailable.
   */
  private calculateCost(modelId: string, promptTokens: number, completionTokens: number): number | undefined {
    const info = this.modelCache.get(modelId);
    if (!info) return undefined;
    return promptTokens * info.pricing.prompt + completionTokens * info.pricing.completion;
  }

  /**
   * Check if a model supports a given parameter (e.g. "response_format").
   * Returns true if we have no data (non-OpenRouter or unknown model) to avoid stripping params unnecessarily.
   */
  private modelSupportsParam(modelId: string, param: string): boolean {
    const info = this.modelCache.get(modelId);
    if (!info || info.supportedParams.size === 0) return true; // assume supported if unknown
    return info.supportedParams.has(param);
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    // Fetch model info on first call (non-blocking for subsequent calls)
    if (this.isOpenRouter) {
      await this.ensureModelInfo();
    }

    const modelId = params.model ?? this.model;

    const body: Record<string, unknown> = {
      model: modelId,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? 1024,
    };

    // Only include response_format if the model supports it
    if (params.response_format) {
      if (this.modelSupportsParam(modelId, "response_format")) {
        body.response_format = params.response_format;
      } else {
        console.log(`[LLM] Model ${modelId} does not support response_format, relying on prompt instructions`);
      }
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // #region agent log
      const attemptStart = Date.now();
      fetch('http://127.0.0.1:7246/ingest/e74a6fed-0be4-43c3-aabb-46a1af95b1a3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'openai.ts:complete',message:'attempt_start',data:{modelId,attempt,maxRetries,attemptStart},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3'})}).catch(()=>{});
      // #endregion
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const data = (await response.json()) as OpenAIResponse;
        const content = data.choices?.[0]?.message?.content ?? "";
        const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

        // Use OpenRouter's reported cost if > 0, otherwise calculate from cached pricing
        let cost = usage.cost && usage.cost > 0 ? usage.cost : undefined;
        if (cost === undefined && this.isOpenRouter) {
          cost = this.calculateCost(modelId, usage.prompt_tokens, usage.completion_tokens);
        }

        return {
          content,
          usage: {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
            cost,
          },
        };
      }

      const errorText = await response.text();

      // Retry on 429 (rate limit) and 503 (service unavailable) with exponential backoff
      if ((response.status === 429 || response.status === 503) && attempt < maxRetries - 1) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 8000); // 1s, 2s, 4s (capped at 8s)
        console.log(`[LLM] ${response.status} on attempt ${attempt + 1}, retrying in ${backoffMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        lastError = createError(ErrorCode.PROVIDER_ERROR, `OpenAI API error (${response.status}): ${errorText}`);
        continue;
      }

      throw createError(ErrorCode.PROVIDER_ERROR, `OpenAI API error (${response.status}): ${errorText}`);
    }

    // Should not reach here, but just in case
    throw lastError ?? createError(ErrorCode.PROVIDER_ERROR, "OpenAI API error: max retries exceeded");
  }
}

export function createOpenAIProvider(config: OpenAIConfig): OpenAIProvider {
  return new OpenAIProvider(config);
}
