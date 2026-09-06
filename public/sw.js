// Service worker «Рациона» (тикет 10).
// Кэшируем оболочку приложения и статику; API и server actions — network-only.
const CACHE = "racion-shell-v1";
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
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Только GET того же origin; всё остальное (POST/server actions) — как есть.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // API не кэшируем — только сеть.
  if (url.pathname.startsWith("/api")) return;

  // Навигация: сеть в приоритете, при офлайне — кэш оболочки.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((r) => r || caches.match("/login")),
      ),
    );
    return;
  }

  // Статика: сначала кэш, в фоне обновляем.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
