// Публичный интерфейс модуля генератора (тикет 14, «тонкий» слой уровня дня).
export * from "./types";
export * from "./portions";
export * from "./constraints";
export * from "./keywords";
export * from "./generate";
export * from "./week";
export * from "./custom";
export * from "./custom-input";
// Хеш строки — для стабильного seed дня от (userId + дата).
export { hashString } from "./rng";
