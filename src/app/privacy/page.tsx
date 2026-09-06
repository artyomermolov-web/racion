import Link from "next/link";

export const metadata = {
  title: "Политика конфиденциальности — Рацион",
};

export default function PrivacyPage() {
  return (
    <div className="app">
      <header className="nav">
        <div className="nav-row">
          <h1 className="lt">Конфиденциальность</h1>
          <Link href="/register" className="nav-btn" aria-label="Назад">
            ‹
          </Link>
        </div>
        <div className="lt-sub">Заглушка политики (MVP)</div>
      </header>
      <main>
        <p style={{ color: "var(--label2)", lineHeight: 1.5, fontSize: 15 }}>
          Это черновик политики конфиденциальности для MVP. Полноценная редакция
          с учётом требований 152-ФЗ будет подготовлена при выходе на широкий
          рынок.
        </p>

        <div className="g-title" style={{ marginTop: 20 }}>
          Какие данные мы храним
        </div>
        <div className="group">
          <div className="row">
            <div className="grow">Электронная почта и хеш пароля</div>
          </div>
          <div className="row">
            <div className="grow">
              Параметры для расчёта нормы (пол, возраст, рост, вес, активность)
            </div>
          </div>
          <div className="row">
            <div className="grow">
              Ваши планы питания, предпочтения и список покупок
            </div>
          </div>
        </div>

        <div className="g-title">Как мы их используем</div>
        <div className="group">
          <div className="row">
            <div className="grow">
              Только чтобы строить и хранить ваш персональный рацион
            </div>
          </div>
          <div className="row">
            <div className="grow">
              Данные привязаны к вашему аккаунту и не передаются третьим лицам
            </div>
          </div>
        </div>

        <p style={{ color: "var(--label3)", fontSize: 13, marginTop: 8 }}>
          Данные о поле, возрасте и весе близки к данным о здоровье — мы
          обрабатываем их с осторожностью.
        </p>
      </main>
    </div>
  );
}
