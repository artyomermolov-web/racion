import { requireUser } from "@/lib/auth";
import { logoutAction } from "@/app/actions/auth";
import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import { ThemeToggle } from "@/components/ios/ThemeToggle";
import { InsetGroupedList, Row } from "@/components/ios/InsetGroupedList";

export default async function ProfilPage() {
  const user = await requireUser();

  return (
    <>
      <LargeTitleHeader title="Профиль" trailing={<ThemeToggle />} />
      <main>
        <InsetGroupedList title="Аккаунт">
          <Row>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ color: "var(--label2)" }}>Почта</span>
              <span className="num">{user.email}</span>
            </div>
          </Row>
        </InsetGroupedList>

        <form action={logoutAction}>
          <button type="submit" className="btn gray">
            Выйти
          </button>
        </form>
      </main>
    </>
  );
}
