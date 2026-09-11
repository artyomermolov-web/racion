// Публичный интерфейс ядра дневника (тикеты 08–10).
export * from "./types";
export * from "./aggregate";
export * from "./progress";
// Расчёт КБЖУ записи по количеству + пресеты (тикет 09).
export * from "./amount";
// Подсказки «Что поесть сейчас» + идемпотентность лога подсказки (тикет 10).
export * from "./suggest";
