import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Оставляем задел под перенос на Postgres/Docker (Next.js standalone, тикет 10).
  output: "standalone",
  // В домашней папке есть посторонний package-lock.json — фиксируем корень явно.
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
