# Продакшн-образ «Рациона» (тикеты 10, 21). Next.js + Prisma + PostgreSQL.
# Turnkey: `docker compose up -d --build` — без ручных правок файлов. Провайдер БД
# в git остаётся `sqlite` (dev на SQLite не ломается), а на PostgreSQL образ
# переключается сам при сборке (sed в build-стадии). На старте контейнер создаёт
# схему в целевой БД (`prisma db push`) и наполняет каталог (идемпотентный сид).
FROM node:20-alpine AS base
WORKDIR /app

# --- Зависимости (включая dev: Prisma CLI и tsx нужны для db push и сида) ---
# Схему копируем ДО `npm ci`, иначе postinstall (`prisma generate`) не найдёт её.
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --include=dev

# --- Сборка Next.js (standalone) под PostgreSQL ---
FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Прод — PostgreSQL: переключаем провайдера в схеме (в git она остаётся sqlite).
RUN sed -i 's|provider = "sqlite"|provider = "postgresql"|' prisma/schema.prisma
# Дамми-URL: ни `prisma generate`, ни `next build` к БД не подключаются, но URL
# должен резолвиться. Реальный DATABASE_URL приходит из docker-compose в рантайме.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
# Только generate + build: `migrate deploy` намеренно НЕ вызываем — SQLite-миграции
# к Postgres не применяются, схему на старте разворачивает `db push` (см. CMD ниже).
RUN npx prisma generate && npx next build

# --- Рантайм ---
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1
# Полные node_modules (Prisma CLI + tsx для db push/seed) и артефакты сборки.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
# Схема здесь уже переключена на postgresql (скопирована из build-стадии).
COPY --from=build /app/prisma ./prisma
COPY package.json next.config.mjs tsconfig.json ./
EXPOSE 3000
# На старте: сгенерировать клиента под postgresql, развернуть схему в целевой БД
# (`db push`, не `migrate deploy` — решение 10), наполнить каталог, поднять сервер.
CMD ["sh", "-c", "npx prisma generate && npx prisma db push --skip-generate && npm run seed && npm run start"]
