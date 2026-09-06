import { requireUser } from "@/lib/auth";
import { getProfileData, targetsToRecord } from "@/lib/profile";
import { logoutAction } from "@/app/actions/auth";
import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import { ThemeToggle } from "@/components/ios/ThemeToggle";
import { InsetGroupedList, Row } from "@/components/ios/InsetGroupedList";
import { NormCard } from "@/components/NormCard";
import { ProfileForm } from "./ProfileForm";
import { TargetsForm } from "./TargetsForm";
import {
  computeTargets,
  explainTargets,
  type ActivityLevel,
  type BodyInput,
  type BodyInputDraft,
  type Goal,
  type Sex,
  type TargetsDraft,
} from "@/core/nutrition";

const s = (n: number | null | undefined) => (n == null ? "" : String(n));

export default async function ProfilPage() {
  const user = await requireUser();
  const { profile, nutrition } = await getProfileData(user.id);

  const defaults: BodyInputDraft = {
    sex: profile?.sex,
    age: s(profile?.age),
    heightCm: s(profile?.heightCm),
    weightKg: s(profile?.weightKg),
    activityLevel: profile?.activityLevel,
    goal: profile?.goal,
    bodyFatPct: s(profile?.bodyFatPct),
  };

  // Объяснение расчёта — из текущих физданных (если заполнены). Если сохранённая
  // норма отличается от расчётной (пользователь подстроил вручную), помечаем это,
  // чтобы карточка и текст не противоречили друг другу.
  let explanation: string[] = [];
  let manuallyAdjusted = false;
  if (profile) {
    const body: BodyInput = {
      sex: profile.sex as Sex,
      age: profile.age,
      heightCm: profile.heightCm,
      weightKg: profile.weightKg,
      activityLevel: profile.activityLevel as ActivityLevel,
      goal: profile.goal as Goal,
      bodyFatPct: profile.bodyFatPct,
    };
    const computed = computeTargets(body);
    explanation = explainTargets(body, computed);
    if (nutrition) {
      const record = targetsToRecord(computed);
      manuallyAdjusted = (Object.keys(record) as (keyof typeof record)[]).some(
        (k) => record[k] !== nutrition[k],
      );
    }
  }

  const targetsDefaults: TargetsDraft | null = nutrition
    ? {
        kcalMin: s(nutrition.kcalMin),
        kcalMax: s(nutrition.kcalMax),
        proteinMin: s(nutrition.proteinMin),
        proteinMax: s(nutrition.proteinMax),
        fatMin: s(nutrition.fatMin),
        fatMax: s(nutrition.fatMax),
        carbMin: s(nutrition.carbMin),
        carbMax: s(nutrition.carbMax),
        fiberMin: s(nutrition.fiberMin),
      }
    : null;

  return (
    <>
      <LargeTitleHeader title="Профиль" trailing={<ThemeToggle />} />
      <main>
        {nutrition ? (
          <>
            <div className="g-title">Ваша норма</div>
            <NormCard norm={nutrition} />
            {explanation.length > 0 ? (
              <div className="explain">
                {manuallyAdjusted ? (
                  <p className="warn">
                    Вы подстроили норму вручную — она показана в карточке выше.
                    Ниже — как её посчитал калькулятор по вашим данным.
                  </p>
                ) : null}
                {explanation.map((p, i) => (
                  <p key={i} className={p.startsWith("⚠") ? "warn" : undefined}>
                    {p}
                  </p>
                ))}
              </div>
            ) : null}
            {targetsDefaults ? <TargetsForm defaults={targetsDefaults} /> : null}
          </>
        ) : null}

        <div className="g-title">
          {profile ? "Ваши данные" : "Рассчитать норму"}
        </div>
        <ProfileForm defaults={defaults} />

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
