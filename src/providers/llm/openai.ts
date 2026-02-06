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
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private isOpenRouter: boolean;
  /** Per-token pricing cached from OpenRouter's /models endpoint: { prompt: $/token, completion: $/token } */
  private pricingCache: Map<string, { prompt: number; completion: number }> = new Map();
  private pricingFetchPromise: Promise<void> | null = null;

  constructor(config: OpenAIConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "gpt-4o-mini";
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").trim().replace(/\/+$/, "");
    this.isOpenRouter = this.baseUrl.includes("openrouter.ai");
  }

  /**
   * Fetch and cache model pricing from OpenRouter's /models endpoint.
   * Only fetches once; subsequent calls return immediately.
   */
  private async ensurePricing(): Promise<void> {
    if (!this.isOpenRouter || this.pricingCache.size > 0) return;

    // Deduplicate concurrent fetches
    if (this.pricingFetchPromise) {
      await this.pricingFetchPromise;
      return;
    }

    this.pricingFetchPromise = (async () => {
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
                this.pricingCache.set(model.id, { prompt, completion });
              }
            }
          }
          console.log(`[LLM] Cached pricing for ${this.pricingCache.size} OpenRouter models`);
        }
      } catch (err) {
        console.warn("[LLM] Failed to fetch OpenRouter model pricing:", err);
      }
    })();

    await this.pricingFetchPromise;
  }

  /**
   * Calculate cost from token counts using cached OpenRouter pricing.
   * Returns undefined if pricing is unavailable.
   */
  private calculateCost(modelId: string, promptTokens: number, completionTokens: number): number | undefined {
    const pricing = this.pricingCache.get(modelId);
    if (!pricing) return undefined;
    return promptTokens * pricing.prompt + completionTokens * pricing.completion;
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    // Fetch pricing in the background on first call (non-blocking for subsequent calls)
    if (this.isOpenRouter) {
      await this.ensurePricing();
    }

    const body: Record<string, unknown> = {
      model: params.model ?? this.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? 1024,
    };

    if (params.response_format) {
      body.response_format = params.response_format;
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
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
        const content = data.choices[0]?.message?.content ?? "";
        const modelId = (body.model as string) ?? this.model;

        // Use OpenRouter's reported cost if > 0, otherwise calculate from cached pricing
        let cost = data.usage.cost && data.usage.cost > 0 ? data.usage.cost : undefined;
        if (cost === undefined && this.isOpenRouter) {
          cost = this.calculateCost(modelId, data.usage.prompt_tokens, data.usage.completion_tokens);
        }

        return {
          content,
          usage: {
            prompt_tokens: data.usage.prompt_tokens,
            completion_tokens: data.usage.completion_tokens,
            total_tokens: data.usage.total_tokens,
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
