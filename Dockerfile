# Продакшн-образ «Рациона» (тикеты 10, 21). Next.js + Prisma.
# Многостадийная сборка; на старте контейнер применяет схему к целевой БД
# (в docker-compose это PostgreSQL) и наполняет каталог продуктов/рецептов.
FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# --- Зависимости (включая dev: Prisma CLI и tsx нужны для схемы и сида) ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- Сборка Next.js ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# --- Рантайм ---
FROM base AS runner
ENV PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY package.json next.config.mjs tsconfig.json ./
EXPOSE 3000
# На старте: сгенерировать клиента под целевую БД, создать/обновить схему и
# наполнить каталог (идемпотентный сид), затем поднять сервер. Используем
# `db push`, а не `migrate deploy` из решения 10: миграции в prisma/migrations —
# в диалекте SQLite и не воспроизводятся на Postgres; db push разворачивает
# провайдер-независимую схему напрямую (подробнее — в README).
CMD ["sh", "-c", "npx prisma generate && npx prisma db push --skip-generate && npm run seed && npm run start"]
