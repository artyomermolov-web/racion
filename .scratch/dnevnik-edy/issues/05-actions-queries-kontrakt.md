# 05 — Actions/queries: контракт лога и подсказок (идемпотентность, таймзона, guard)

Type: grilling
Status: resolved
HITL/AFK: HITL

Resolved: свёрнут в [spec.md](../spec.md) через `to-spec` — контракт actions/`src/lib/diary.ts` (`getDayLog`/`getSuggestions`/`addEntry`/`updateEntry`/`deleteEntry`/`logSuggestion`), идемпотентность через `@@unique([userId,date,slot,suggestedRecipeId])` поверх чистого `logDecision` (аналог `MealWriteOff`), локальная дата `YYYY-MM-DD` без UTC-дрейфа. Уточнение: серверная логика живёт в `src/lib`, а не в actions напрямую.

Blocked by: 02, 04

## Question

Зафиксировать серверный контракт `src/app/actions/diary.ts` и запросы. Actions делают Prisma-I/O и зовут `/core/diary`; вся арифметика/скоринг — в чистом ядре.

**1. Actions.** `addEntry`, `updateEntry`, `deleteEntry`, `logSuggestion`. Определить вход/выход каждого; `logSuggestion` превращает подсказку в реальный `DiaryEntry` с `suggestedRecipeId`.

**2. Queries.**
- `getDayLog(date) → { entries, progress }` — один индексный запрос (`@@index([userId, date])`) + агрегация в ядре (`aggregate`/`progress`).
- `getSuggestions(date, filters) → SuggestedMeal[]` — считает остаток и зовёт `suggest.ts` с кандидатами/ограничениями/предпочтениями пользователя (собранными из существующих моделей).

**3. Идемпотентность / guard двойного списания.** `logSuggestion` идемпотентен по `(date, slot, suggestedRecipeId)` — повтор не дублирует; удаление возвращает подсказку. Зафиксировать механизм (уникальный ключ vs проверка перед вставкой) и его тест.

**4. Дата/таймзона.** `date` — локальная календарная дата (`YYYY-MM-DD`) **с клиента**; граница «сегодня» — локальная полночь, без UTC-дрейфа. Зафиксировать, как клиент передаёт локальную дату и как сервер её не переинтерпретирует.

**5. Связь план↔факт.** Дельта всегда из реальных `DiaryEntry` против `DayTarget`; связки «предложение = факт» в данных нет (только `suggestedRecipeId` как пометка происхождения). Ядро генератора не трогаем.

**Тесты (action-уровень):** add/update/delete/logSuggestion + guard двойного списания (повтор не дублирует, удаление возвращает подсказку); неизменяемость снапшота при правке исходной еды.

Вызвать `grilling` + `domain-modeling`.
