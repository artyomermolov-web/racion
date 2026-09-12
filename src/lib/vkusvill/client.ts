// Тонкий адаптер к публичному MCP-серверу ВкусВилл (тикет 01, ADR-0001) —
// ЕДИНСТВЕННАЯ точка сети во всей интеграции. Вся остальная логика (парсинг,
// маппинг) — чистые модули core/vkusvill, тестируемые на фикстурах.
//
// Протокол: JSON-RPC 2.0, метод `tools/call`, инструменты с префиксом `vkusvill_`
// (подтверждено `tools/list` на живом сервере). Ответ MCP — в
// `result.content[0].text` JSON-строкой с конвертом `{ok, data}` либо
// `{ok:false, error, code, retryable}`. Тело шлём реальным UTF-8 (JSON.stringify +
// fetch), без шелла — кириллица не ломается. Жёсткий rate-limit (429) отдаётся
// как `code:"rate_limited"`; синк деградирует мягко (тикет: устойчивость).
//
// Не помечен "server-only": адаптер вызывается и из server actions, и из CLI-синка
// (node/tsx). В клиентские бандлы он не импортируется.

const DEFAULT_ENDPOINT = "https://mcp001.vkusvill.ru/mcp";

/** Ошибка из конверта ВВ (или транспортная). */
export interface VvError {
  code: string;
  message: string;
  httpStatus?: number;
  retryable: boolean;
}

/** Нормализованный результат вызова: успех с данными или ошибка. */
export type VvResult<T> = { ok: true; data: T } | { ok: false; error: VvError };

export interface VvClientOptions {
  endpoint?: string;
  /** Сколько раз повторить при retryable-ошибке (rate limit). По умолчанию 2. */
  maxRetries?: number;
  /** Базовая пауза между повторами, мс (экспоненциально растёт). По умолчанию 800. */
  retryDelayMs?: number;
  /** Таймаут запроса, мс. По умолчанию 30000. */
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function endpoint(opts?: VvClientOptions): string {
  return opts?.endpoint ?? process.env.VKUSVILL_MCP_URL ?? DEFAULT_ENDPOINT;
}

/** Разбирает конверт ВВ из текста MCP-контента в нормализованный результат. */
function parseEnvelope<T>(text: string): VvResult<T> {
  let env: unknown;
  try {
    env = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: { code: "bad_envelope", message: "Невалидный JSON в ответе ВВ", retryable: false },
    };
  }
  const e = env as {
    ok?: boolean;
    data?: T;
    error?: { code?: string; message?: string; http_status?: number };
    code?: string;
    retryable?: boolean;
  };
  if (e.ok && e.data !== undefined) return { ok: true, data: e.data };
  return {
    ok: false,
    error: {
      code: e.code ?? e.error?.code ?? "unknown",
      message: e.error?.message ?? "Ошибка ВкусВилл",
      httpStatus: e.error?.http_status,
      retryable: e.retryable ?? false,
    },
  };
}

/**
 * Низкоуровневый вызов инструмента ВВ через JSON-RPC `tools/call`. Повторяет при
 * retryable-ошибке (rate limit) с экспоненциальной паузой. Транспортные сбои и
 * не-2xx оборачиваются в `VvError` — исключения наружу не летят.
 */
export async function callTool<T>(
  tool: string,
  args: Record<string, unknown>,
  opts?: VvClientOptions,
): Promise<VvResult<T>> {
  const url = endpoint(opts);
  const maxRetries = opts?.maxRetries ?? 2;
  const baseDelay = opts?.retryDelayMs ?? 800;
  const timeoutMs = opts?.timeoutMs ?? 30000;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: tool, arguments: args },
  });

  let last: VvError = { code: "unknown", message: "Нет ответа", retryable: false };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(baseDelay * 2 ** (attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        last = {
          code: "http_error",
          message: `HTTP ${res.status}`,
          httpStatus: res.status,
          retryable: res.status === 429 || res.status >= 500,
        };
        if (!last.retryable) return { ok: false, error: last };
        continue;
      }
      const json = (await res.json()) as {
        result?: { content?: { type: string; text?: string }[] };
        error?: { message?: string };
      };
      if (json.error) {
        return {
          ok: false,
          error: { code: "rpc_error", message: json.error.message ?? "JSON-RPC error", retryable: false },
        };
      }
      const text = json.result?.content?.find((c) => c.type === "text")?.text;
      if (!text) {
        return {
          ok: false,
          error: { code: "empty", message: "Пустой ответ ВВ", retryable: false },
        };
      }
      const parsed = parseEnvelope<T>(text);
      if (parsed.ok) return parsed;
      last = parsed.error;
      if (!last.retryable) return parsed;
    } catch (err) {
      last = {
        code: "network",
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: last };
}

/** Ответ `vkusvill_products_search` (нужные слайсу поля; остальное игнорируется). */
export interface ProductsSearchData {
  products?: unknown[];
  meta?: { has_more?: boolean; page?: number };
}

/**
 * Поиск товаров ВВ (`vkusvill_products_search`) — единственный метод, нужный этому
 * слайсу. mode=full отдаёт КБЖУ/цену/категорию. Пагинация фиксирована 10/стр.
 */
export function productsSearch(
  q: string,
  params: { page?: number; mode?: "full" | "short"; sort?: string } = {},
  opts?: VvClientOptions,
): Promise<VvResult<ProductsSearchData>> {
  return callTool<ProductsSearchData>(
    "vkusvill_products_search",
    { q, page: params.page ?? 1, mode: params.mode ?? "full", sort: params.sort ?? "popularity" },
    opts,
  );
}
