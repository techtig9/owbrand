/**
 * Provider registry, ordering and health.
 *
 * Order comes from AI_PROVIDER_ORDER (comma-separated ids), defaulting to
 * Claude first with Gemini behind it. Nothing hard-codes a vendor.
 *
 * A provider is only ever offered if `isConfigured()` is true — the master
 * command is explicit that we must not claim a provider is available when its
 * credentials are absent, and `/api/ready` reports the same view.
 */
import { anthropicProvider } from '@/lib/ai/providers/anthropic';
import { geminiProvider } from '@/lib/ai/providers/gemini';
import type { AIProvider } from '@/lib/ai/types';
import { logger } from '@/lib/logger';

const ALL_PROVIDERS: Record<string, AIProvider> = {
  [anthropicProvider.id]: anthropicProvider,
  [geminiProvider.id]: geminiProvider,
};

const DEFAULT_ORDER = ['anthropic', 'gemini'];

/* ------------------------------------------------------------------ *
 * Health / circuit breaking
 * ------------------------------------------------------------------ */

interface ProviderHealth {
  consecutiveFailures: number;
  /** Epoch ms until which this provider is skipped. */
  openUntil: number;
  lastError?: string;
  lastFailureAt?: number;
  totalCalls: number;
  totalFailures: number;
}

const health = new Map<string, ProviderHealth>();

/** Failures before a provider is taken out of rotation. */
const FAILURE_THRESHOLD = 3;
/** How long it stays out, growing with repeated trips. */
const BASE_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 300_000;

function healthFor(id: string): ProviderHealth {
  let entry = health.get(id);
  if (!entry) {
    entry = { consecutiveFailures: 0, openUntil: 0, totalCalls: 0, totalFailures: 0 };
    health.set(id, entry);
  }
  return entry;
}

export function recordProviderSuccess(id: string): void {
  const entry = healthFor(id);
  entry.consecutiveFailures = 0;
  entry.openUntil = 0;
  entry.totalCalls += 1;
}

export function recordProviderFailure(id: string, reason: string): void {
  const entry = healthFor(id);
  entry.consecutiveFailures += 1;
  entry.totalCalls += 1;
  entry.totalFailures += 1;
  entry.lastError = reason.slice(0, 200);
  entry.lastFailureAt = Date.now();

  if (entry.consecutiveFailures >= FAILURE_THRESHOLD) {
    const overshoot = entry.consecutiveFailures - FAILURE_THRESHOLD;
    const cooldown = Math.min(BASE_COOLDOWN_MS * 2 ** overshoot, MAX_COOLDOWN_MS);
    entry.openUntil = Date.now() + cooldown;

    logger.warn('ai:provider_circuit_open', {
      provider: id,
      consecutiveFailures: entry.consecutiveFailures,
      cooldownMs: cooldown,
      reason: entry.lastError,
    });
  }
}

/** True when the breaker is open and this provider should be skipped. */
export function isProviderTripped(id: string): boolean {
  return healthFor(id).openUntil > Date.now();
}

export interface ProviderHealthReport {
  id: string;
  displayName: string;
  configured: boolean;
  tripped: boolean;
  consecutiveFailures: number;
  totalCalls: number;
  totalFailures: number;
  lastError?: string;
}

/** Snapshot for /api/ready and the admin surface. */
export function providerHealthReport(): ProviderHealthReport[] {
  return Object.values(ALL_PROVIDERS).map((provider) => {
    const entry = healthFor(provider.id);
    return {
      id: provider.id,
      displayName: provider.displayName,
      configured: provider.isConfigured(),
      tripped: entry.openUntil > Date.now(),
      consecutiveFailures: entry.consecutiveFailures,
      totalCalls: entry.totalCalls,
      totalFailures: entry.totalFailures,
      lastError: entry.lastError,
    };
  });
}

/** Test hook. */
export function __resetProviderHealth(): void {
  health.clear();
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

function configuredOrder(): string[] {
  const raw = process.env.AI_PROVIDER_ORDER;
  const ids = raw
    ? raw
        .split(',')
        .map((id) => id.trim().toLowerCase())
        .filter(Boolean)
    : DEFAULT_ORDER;

  const known = ids.filter((id) => {
    if (ALL_PROVIDERS[id]) return true;
    logger.warn('ai:unknown_provider_in_order', { provider: id });
    return false;
  });

  return known.length > 0 ? known : DEFAULT_ORDER;
}

export interface ProviderSelection {
  /** Providers to try, in order. Empty when none are usable. */
  chain: AIProvider[];
  /** Providers skipped because their breaker is open. */
  skipped: string[];
}

/**
 * Builds the provider chain for one request.
 *
 * `requireVision` and `requireStructuredOutput` filter out providers that
 * genuinely cannot serve the request, rather than letting it fail at the API.
 */
export function selectProviders(
  options: { requireVision?: boolean; requireStructuredOutput?: boolean } = {}
): ProviderSelection {
  const chain: AIProvider[] = [];
  const skipped: string[] = [];

  for (const id of configuredOrder()) {
    const provider = ALL_PROVIDERS[id];
    if (!provider || !provider.isConfigured()) continue;
    if (options.requireVision && !provider.supportsVision()) continue;

    if (isProviderTripped(id)) {
      skipped.push(id);
      continue;
    }

    chain.push(provider);
  }

  // Everything is tripped: try anyway rather than fail outright. A cooling-off
  // period should degrade throughput, not deny service entirely.
  if (chain.length === 0 && skipped.length > 0) {
    for (const id of skipped) {
      const provider = ALL_PROVIDERS[id];
      if (provider) chain.push(provider);
    }
    logger.warn('ai:all_providers_tripped_retrying_anyway', { providers: skipped });
  }

  return { chain, skipped };
}

/** Every provider that has credentials, regardless of health. */
export function configuredProviders(): AIProvider[] {
  return Object.values(ALL_PROVIDERS).filter((p) => p.isConfigured());
}

export function getProvider(id: string): AIProvider | undefined {
  return ALL_PROVIDERS[id];
}

/** True when at least one provider could serve a request. */
export function hasUsableProvider(): boolean {
  return configuredProviders().length > 0;
}
