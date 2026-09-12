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
 * Поиск товаров ВВ (`vkusvill_products_search`). mode=full отдаёт КБЖУ/цену/
 * категорию. Пагинация фиксирована 10/стр. — за пределы страницы 1 ходит
 * `productsSearchAll`.
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

/** Итог постраничного сбора: собранные товары + честный признак неполноты. */
export interface ProductsSearchAllResult {
  /** Собранные товары со всех пройденных страниц (сырые, форму валидирует core). */
  products: unknown[];
  /** Сколько страниц реально получено. */
  pages: number;
  /**
   * true — обход прерван раньше `has_more=false` (лимит/ошибка/достигнут cap), и
   * набор, вероятно, неполон. Синк деградирует мягко (устойчивость, spec.md).
   */
  incomplete: boolean;
  /** Последняя ошибка, если обход прервался ею. */
  error?: VvError;
}

/**
 * Собирает все страницы выдачи `vkusvill_products_search` по одному запросу,
 * итерируя `page` пока `meta.has_more` (пагинация ВВ фиксирована 10/стр.). Обход
 * ограничен `maxPages` — курируемый охват не требует глубокой пагинации и бережёт
 * rate-limit; бэкофф на 429 живёт в `callTool`. Ошибка на любой странице
 * останавливает обход мягко: возвращаем уже собранное с `incomplete=true`.
 */
export async function productsSearchAll(
  q: string,
  params: { mode?: "full" | "short"; sort?: string; maxPages?: number } = {},
  opts?: VvClientOptions,
): Promise<ProductsSearchAllResult> {
  const maxPages = params.maxPages ?? 5;
  const products: unknown[] = [];
  let pages = 0;
  for (let page = 1; page <= maxPages; page++) {
    const res = await productsSearch(q, { page, mode: params.mode, sort: params.sort }, opts);
    if (!res.ok) return { products, pages, incomplete: true, error: res.error };
    pages++;
    products.push(...(res.data.products ?? []));
    if (!res.data.meta?.has_more) return { products, pages, incomplete: false };
  }
  // Вышли по cap — has_more мог остаться true.
  return { products, pages, incomplete: true };
}
