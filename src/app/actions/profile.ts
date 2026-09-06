"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { targetsToRecord } from "@/lib/profile";
import {
  computeTargets,
  validateBodyInput,
  validateTargetsDraft,
  type BodyInputDraft,
  type BodyInputErrors,
  type TargetsDraft,
  type TargetsErrors,
} from "@/core/nutrition";

export interface ProfileFormState {
  errors: BodyInputErrors & { form?: string };
  values: BodyInputDraft;
  saved?: boolean;
}

/** Читает строковое поле формы (или undefined, если пусто/нет). */
function field(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return v == null ? undefined : String(v);
}

function readBodyDraft(formData: FormData): BodyInputDraft {
  return {
    sex: field(formData, "sex"),
    age: field(formData, "age"),
    heightCm: field(formData, "heightCm"),
    weightKg: field(formData, "weightKg"),
    activityLevel: field(formData, "activityLevel"),
    goal: field(formData, "goal"),
    bodyFatPct: field(formData, "bodyFatPct"),
  };
}

/**
 * Сохраняет физданные (UserProfile) и пересчитывает активную норму
 * (NutritionProfile). Пересчёт перезаписывает ранее рассчитанные диапазоны —
 * ручные правки делаются отдельным действием (saveTargetsAction).
 */
export async function saveProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const user = await requireUser();
  const draft = readBodyDraft(formData);

  const { errors, value } = validateBodyInput(draft);
  if (!value) return { errors, values: draft };

  const targets = computeTargets(value);
  const record = targetsToRecord(targets);

  await prisma.$transaction(async (tx) => {
    await tx.userProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        sex: value.sex,
        age: value.age,
        heightCm: value.heightCm,
        weightKg: value.weightKg,
        bodyFatPct: value.bodyFatPct,
        activityLevel: value.activityLevel,
        goal: value.goal,
      },
      update: {
        sex: value.sex,
        age: value.age,
        heightCm: value.heightCm,
        weightKg: value.weightKg,
        bodyFatPct: value.bodyFatPct,
        activityLevel: value.activityLevel,
        goal: value.goal,
      },
    });

    const active = await tx.nutritionProfile.findFirst({
      where: { userId: user.id, isActive: true },
      orderBy: { createdAt: "desc" },
    });

    if (active) {
      await tx.nutritionProfile.update({
        where: { id: active.id },
        data: record,
      });
    } else {
      await tx.nutritionProfile.create({
        data: { userId: user.id, isActive: true, ...record },
      });
    }
  });

  revalidatePath("/profil");
  revalidatePath("/home");
  return { errors: {}, values: draft, saved: true };
}

export interface TargetsFormState {
  errors: TargetsErrors & { form?: string };
  values: TargetsDraft;
  saved?: boolean;
}

function readTargetsDraft(formData: FormData): TargetsDraft {
  return {
    kcalMin: field(formData, "kcalMin"),
    kcalMax: field(formData, "kcalMax"),
    proteinMin: field(formData, "proteinMin"),
    proteinMax: field(formData, "proteinMax"),
    fatMin: field(formData, "fatMin"),
    fatMax: field(formData, "fatMax"),
    carbMin: field(formData, "carbMin"),
    carbMax: field(formData, "carbMax"),
    fiberMin: field(formData, "fiberMin"),
  };
}

/** Сохраняет ручную подстройку диапазонов активной нормы (до грамма). */
export async function saveTargetsAction(
  _prev: TargetsFormState,
  formData: FormData,
): Promise<TargetsFormState> {
  const user = await requireUser();
  const draft = readTargetsDraft(formData);

  const { errors, value } = validateTargetsDraft(draft);
  if (!value) return { errors, values: draft };

  const active = await prisma.nutritionProfile.findFirst({
    where: { userId: user.id, isActive: true },
    orderBy: { createdAt: "desc" },
  });
  if (!active) {
    return {
      errors: { form: "Сначала заполните физданные и рассчитайте норму" },
      values: draft,
    };
  }

  await prisma.nutritionProfile.update({
    where: { id: active.id },
    data: value,
  });

  revalidatePath("/profil");
  revalidatePath("/home");
  return { errors: {}, values: draft, saved: true };
}
