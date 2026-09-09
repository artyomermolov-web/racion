# 02 — Модель данных дневника: DiaryEntry, gramsPerPiece, типы /core/diary, единицы

Type: grilling
Status: resolved
HITL/AFK: HITL

Resolved: свёрнут в [spec.md](../spec.md) через `to-spec` (индивидуальный HITL-прогон не выполнялся) — решения по этому тикету в разделах Implementation/Testing Decisions спеки. Уточнение против дока: `Ingredient.gramsPerPiece` уже есть в схеме, единственная новая таблица — `DiaryEntry`; снапшот хранит 5 нутриентов (без натрия).

## Question

Зафиксировать модель данных под-проекта A так, чтобы её можно было прямо перенести в спеку. Спина всей карты — почти всё блокируется этим тикетом.

**1. Prisma-модель `DiaryEntry`** (единственная новая таблица). Подтвердить/уточнить поля из дизайна:
`id`, `userId`, `date` (String `YYYY-MM-DD`, локальная дата), `slot` (`breakfast|lunch|dinner|snack`), `source` (`ingredient|recipe`), `refId` (`Ingredient.id | Recipe.id`), `grams?` (source=ingredient или pcs→граммы), `servings?` (source=recipe), снапшот КБЖУ `kcal/protein/fat/carb/fiber` (Float), `suggestedRecipeId?` («план vs факт»), `createdAt`, relation к `User` (onDelete Cascade), `@@index([userId, date])`. Сверить с реальной `prisma/schema.prisma` (имена моделей/связей, стиль id — cuid?).

**2. Аддитивная миграция `Ingredient.gramsPerPiece Float?`** — штуки как первоклассная единица. Если не задано у продукта → ввод «шт» недоступен, только граммы. Сид проставит популярные (данные из тикета 01). Подтвердить, что миграция аддитивна и не ломает существующее.

**3. Типы `/core/diary/types.ts`** (чистый модуль, без Prisma/Next): `DiaryEntry`, `DiarySource`, `LoggedAmount`, `DayLog`, `DayProgress`, `SuggestedMeal`. Определить поля каждого; переиспользовать `FoodNutrients` из `@/core/nutrition`.

**4. Единицы и конверсия (`amount.ts`).** Каноническая единица — граммы/мл (для ml плотность ~1). Правила: продукт → `per100 × grams/100`; штуки → `1 шт × gramsPerPiece → граммы`; рецепт → `КБЖУ порции × servings`. Пресеты-чипсы (½/1/1½, «1 шт», «100 г») — над теми же полями, не отдельная модель. Зафиксировать сигнатуру `nutrientsForAmount(food, amount)` и набор пресетов.

**5. Снапшот-неизменяемость.** Запись хранит посчитанные `nutrients` на момент добавления; правка еды в базе **не меняет** прошлые записи (принцип неизменяемости из тикета 19 `racion-mvp`). Правка количества записи пересчитывает снапшот из текущих данных; прошлые дни неизменны.

Вызвать навыки `grilling` + `domain-modeling`; новые термины дневника занести в `CONTEXT.md`.
