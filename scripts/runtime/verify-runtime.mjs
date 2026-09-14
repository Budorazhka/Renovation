import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Lightweight HTTP-only smoke check (api liveness/readiness + both web
 * roots). Kept intentionally small and dependency-free — `pnpm runtime:verify`
 * is meant as a quick "did `runtime:up` actually come up" sanity check after
 * `docker compose up`, run manually by a human.
 *
 * For the full, honest D-07 gate (Node/pnpm/Docker/Mongo/Redis/MinIO checks,
 * BLOCKED_INFRASTRUCTURE reporting with remediation commands, and the thing
 * Playwright's globalSetup actually imports) see scripts/runtime/preflight.mjs.
 *
 * apps/erp-web вернулся в workspace и в runtime-стек (см. compose.runtime.yml)
 * позже 04.09.2026 — этот комментарий раньше объяснял, почему erp-web
 * исключён, но с тех пор устарел: DEFAULTS/checkEndpoint ниже уже проверяют
 * его наравне с остальными тремя приложениями.
 */
const DEFAULTS = {
  api: 'http://localhost:3000',
  marketplace: 'http://localhost:4173',
  admin: 'http://localhost:4174',
  erp: 'http://localhost:4175',
};

function withPath(origin, path) {
  return `${origin.replace(/\/+$/, '')}${path}`;
}

export async function checkEndpoint(label, url, { fetcher = fetch, timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(url, { signal: controller.signal });
    return { label, url, ok: response.ok, status: response.status };
  } catch (error) {
    return {
      label,
      url,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyRuntime({ env = process.env, fetcher = fetch } = {}) {
  const api = env.RUNTIME_API_URL || DEFAULTS.api;
  const marketplace = env.RUNTIME_MARKETPLACE_URL || DEFAULTS.marketplace;
  const admin = env.RUNTIME_ADMIN_URL || DEFAULTS.admin;
  const erp = env.RUNTIME_ERP_URL || DEFAULTS.erp;

  return Promise.all([
    checkEndpoint('api liveness', withPath(api, '/health'), { fetcher }),
    checkEndpoint('api readiness', withPath(api, '/health/ready'), { fetcher }),
    checkEndpoint('marketplace web', marketplace, { fetcher }),
    checkEndpoint('admin web', admin, { fetcher }),
    checkEndpoint('erp web', erp, { fetcher }),
  ]);
}

function printResults(results) {
  for (const result of results) {
    if (result.ok) {
      console.log(`[runtime] PASS ${result.label} (${result.status}) ${result.url}`);
    } else {
      const reason = result.status ? `HTTP ${result.status}` : result.error || 'unknown error';
      console.error(`[runtime] FAIL ${result.label}: ${reason} ${result.url}`);
    }
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const results = await verifyRuntime();
  printResults(results);
  process.exitCode = results.every((result) => result.ok) ? 0 : 1;
}
