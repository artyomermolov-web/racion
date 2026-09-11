-- CreateIndex
-- БД-guard идемпотентности лога подсказки «Что поесть сейчас» (тикет 10):
-- одна подсказка (date|slot|suggestedRecipeId) логируется не более раза.
-- В SQLite NULL в уникальном индексе различны → ручные записи
-- (suggestedRecipeId = NULL) под ограничение не попадают.
CREATE UNIQUE INDEX "DiaryEntry_userId_date_slot_suggestedRecipeId_key" ON "DiaryEntry"("userId", "date", "slot", "suggestedRecipeId");
