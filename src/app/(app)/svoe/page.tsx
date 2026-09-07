import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import { listCustomProducts, listCustomRecipes } from "@/lib/customFood";
import { SvoeContent } from "./SvoeContent";

// «Своё» (тикет 17): кастом-продукты, кастом-рецепты, персонализация. КБЖУ
// рецептов считается из состава на сервере (listCustomRecipes).
export default async function SvoePage() {
  const user = await requireUser();
  const [products, recipes] = await Promise.all([
    listCustomProducts(user.id),
    listCustomRecipes(user.id),
  ]);

  return (
    <>
      <LargeTitleHeader
        title="Своё"
        leading={
          <Link href="/baza" className="back-link">
            ‹ База
          </Link>
        }
      />
      <SvoeContent products={products} recipes={recipes} />
    </>
  );
}
