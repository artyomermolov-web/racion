import { redirect } from "next/navigation";

// Тикет 10: «Меню» упразднена — все операции плана живут в ленте Дневника (09).
// Маршрут /home сохранён только как редирект для старых ссылок и PWA-ярлыка,
// чтобы ничего не 404-ило после переезда стартового экрана на /dnevnik.
export default function HomePage() {
  redirect("/dnevnik");
}
