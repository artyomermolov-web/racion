// Service worker «Рациона» (тикеты 10, 21).
// Кэшируем оболочку приложения И последние отрисованные страницы-планы, чтобы
// офлайн пользователь видел свой последний рацион. Запросы к API и server actions
// (POST) — только сеть, никогда не кэшируются.
const SHELL_CACHE = "racion-shell-v2";
const RUNTIME_CACHE = "racion-runtime-v2";
const KEEP = [SHELL_CACHE, RUNTIME_CACHE];

// Оболочка: то, без чего не отрисовать ни одну страницу офлайн.
const SHELL = [
  "/login",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Можно ли класть ответ в кэш: только «свои» полноценные 200-ответы. Редиректы
// (напр. неавторизованный /home → /login) в кэш не кладём — из кэша они бросают
// ошибку и путают навигацию.
function isCacheable(resp) {
  return resp && resp.ok && !resp.redirected && resp.type === "basic";
}

// Держим runtime-кэш ограниченным: последние MAX_RUNTIME страниц-планов.
// keys() отдаёт записи в порядке добавления, поэтому старейшие — в начале.
const MAX_RUNTIME = 12;
async function trimRuntime(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_RUNTIME; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Только GET того же origin; POST/server actions и сторонние — как есть (сеть).
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // API не кэшируем — только сеть (решение 10: API network-only).
  if (url.pathname.startsWith("/api")) return;

  // Навигация: сеть в приоритете; успешный ответ кладём в runtime-кэш (последние
  // планы). Офлайн — отдаём кэш этой же страницы, иначе последнюю сохранённую
  // страницу приложения, иначе экран входа.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          if (isCacheable(resp)) {
            const copy = resp.clone();
            caches.open(RUNTIME_CACHE).then(async (c) => {
              await c.put(request, copy);
              await trimRuntime(c);
            });
          }
          return resp;
        })
        .catch(async () => {
          // Офлайн: сперва эта же страница, иначе — САМЫЙ СВЕЖИЙ сохранённый план
          // (последняя запись в порядке добавления), иначе экран входа.
          const cached = await caches.match(request);
          if (cached) return cached;
          const runtime = await caches.open(RUNTIME_CACHE);
          const keys = await runtime.keys();
          const newest = keys[keys.length - 1];
          if (newest) {
            const r = await runtime.match(newest);
            if (r) return r;
          }
          return caches.match("/login");
        }),
    );
    return;
  }

  // Статика (скрипты/стили/иконки/шрифты): сначала кэш, в фоне обновляем.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((resp) => {
          if (isCacheable(resp)) {
            const copy = resp.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
