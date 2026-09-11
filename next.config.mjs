import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Прод-запуск — `next start` с полными node_modules (Dockerfile, тикеты 10/21).
  // `output: "standalone"` намеренно не используем: standalone-сервер здесь не
  // запускается, а `next start` с ним несовместим (варнинг Next). Образ и так
  // копирует полные node_modules, поэтому минимизация standalone ничего не даёт.
  // В домашней папке есть посторонний package-lock.json — фиксируем корень явно.
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
