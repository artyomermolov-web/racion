# 04 — Модель данных MVP: сущности и поля

Type: grilling
Status: resolved
HITL/AFK: HITL

## Question

Какой минимальный, но расширяемый набор сущностей Prisma закрывает объём MVP и оставляет задел под волны 2+? Зафиксировать сущности и ключевые поля для: users, user_profiles, nutrition_profiles, meal_types, week_layouts, ingredients (с pack_size / price_per_pack / shelf_life_days), recipes (+ ингредиенты с граммовками, техника, совместимые слоты, теги), plans + plan_items, favorites, blocks, recurring_foods, keyword_filters, pantry_lots (реальные vs pending — строго раздельно), grocery_lists + items (+ снапшот). Отложенные сущности (leftovers_patterns, saved_plans, weight_log, custom_*, personalized_recipes) — как задел/интерфейс, без полной реализации. Требование: схема на SQLite, совместимая с переносом на PostgreSQL одной строкой. Вызвать навыки `grilling` + `domain-modeling`; расхождения с `CONTEXT.md` фиксировать в глоссарии.

## Answer

**Продуктовые решения (подтверждено с пользователем):**
- Одна активная цель КБЖУ на юзера в MVP; схема поддерживает несколько `NutritionProfile` (переключение — позже).
- Одинаковая раскладка на все дни + включение/выключение приёмов; разные раскладки по дням — задел в схеме, не в UI.
- Приёмы по умолчанию: Завтрак, Обед, Ужин, Перекус (перекус опционально включён).

**Сущности MVP (Prisma-модели, ключевые поля):**

*Аккаунт*
- `User`: id, email (unique), passwordHash, createdAt. (Сессии — см. тикет 08.)

*Профиль и цели*
- `UserProfile` (1:1 к User): sex, age, heightCm, weightKg, bodyFatPct?, activityLevel (enum: sedentary/light/moderate/high), goal (enum: lose/maintain/gain), shoppingWeekday (0–6).
- `NutritionProfile`: userId, name, kcalMin/Max, proteinMin/Max, fatMin/Max, carbMin/Max, fiberMin, sodiumMax?, cholesterolMax?, isActive. (В MVP ровно один isActive.)

*Раскладка и приёмы*
- `MealType`: userId, name, orderIndex, cookTimeMin, canCook, difficulty (1–3), kcalShare (float), allowBreakfastDishes, people (int ≥1, дефолт 1), onlyRecurring.
- `DaySetting`: userId, weekday (0–6), enabled, nutritionProfileId? (в MVP null = активный профиль; задел под «разные дни»).

*Еда*
- `Ingredient`: name, group, kcal/protein/fat/carb/fiber/sodium на 100, unit (enum g/ml/pcs), packSize, pricePerPack, shelfLifeDays, isCustom, ownerUserId? (null = базовый). Custom food = isCustom + ownerUserId.
- `Recipe`: name, steps (text), timeMin, difficulty (1–3), isCustom, ownerUserId?, baseRecipeId? (персонализация базового рецепта). КБЖУ вычисляется из состава (кэш-поля допустимы).
- `RecipeIngredient`: recipeId, ingredientId, grams.
- Теги через join-таблицы (портируемо SQLite↔PG, см. ниже): `IngredientAllergen` (ingredientId, allergen), `RecipeSlot` (recipeId, slot: breakfast/lunch/dinner/snack), `RecipeDietTag`, `RecipeEquipment` (stove/oven/blender/multicooker/none).

*План*
- `Plan`: userId, weekStartDate (понедельник).
- `PlanItem`: planId, date, mealTypeId, recipeId? XOR ingredientId?, portion (0.25–2.0), eaten (bool), leftoverLinkId? (self-relation, задел).

*Вкусы*
- `Favorite`, `Block`: userId + recipeId? / ingredientId?.
- `RecurringFood`: userId, recipeId, frequency (often/always), mealTypeId?.
- `KeywordFilter`: userId, keyword.

*Покупки и кладовка*
- `GroceryList`: userId, fromDate, toDate, confirmedAt? (наличие = снапшот).
- `GroceryItem`: listId, ingredientId, neededQty, packsToBuy, priceSnapshot?, purchased, manuallyEdited.
- `PantryLot`: userId, ingredientId, qty, expiresAt?, kind (enum real/pending — строго раздельно), sourceGroceryListId?.

*Задел (модели есть, UI позже):* `LeftoverPattern`, `SavedPlan`, `WeightLog`, `Subscription`. (Custom food/recipe и персонализация покрыты флагами isCustom / baseRecipeId, отдельные таблицы не нужны.)

**Техническое решение — портируемость SQLite↔PostgreSQL:**
- Prisma **не поддерживает scalar-списки (`String[]`) на SQLite**, поэтому все наборы тегов (аллергены, слоты, диеты, техника) — через **join-таблицы**, а не массивы. Это даёт одинаковую схему на обоих движках и удобные запросы для фильтров/аллергенов.
- Enum'ы: на SQLite Prisma хранит как TEXT, на PG — как native enum; в схеме описываем как `enum`, миграция на PG без изменений.
- Денежные/нутриентные значения — Float/Decimal (на PG — Decimal). Даты — DateTime (UTC).
- Итог: одна `schema.prisma`, переключение SQLite→PostgreSQL — сменой `provider` + `DATABASE_URL` (требование «одной строкой» выполнимо).

Все сущности соответствуют глоссарию `CONTEXT.md`; новых терминов не потребовалось.
