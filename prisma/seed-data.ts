// Стартовый набор данных базы (тикет 13): продукты + рецепты, достаточные для
// сборки недели. Чистый модуль без импортов — его используют и сид (prisma/seed.ts),
// и тест на правдоподобность КБЖУ (src/core/nutrition/recipe.test.ts).
//
// КБЖУ/клетчатка/натрий на 100 г — справочные значения каталога из
// research/products-ru.md. Это осознанно табличные, а не пересчитанные факторами
// Атуотера значения: kbju-master.md D1 прямо назначает USDA/РФ-таблицы основным
// источником состава продуктов на 100 г («USDA — основной источник значений на
// 100 г для наполнения каталога»), а формула энергии A1 рассчитана на USDA-
// конвенцию углеводов (включают клетчатку), тогда как в нашей таблице «У» уже без
// клетчатки — прямое применение A1 дало бы двойной вычет и занижение. Итог блюда
// собирается из этих значений линейно (см. /core/nutrition/recipe.ts).
// Цены — ориентир (тикет 01, ненадёжны). Полное наполнение — тикет 21.

export type Unit = "g" | "ml" | "pcs";
export type Allergen =
  | "milk"
  | "gluten"
  | "egg"
  | "fish"
  | "meat"
  | "poultry"
  | "nuts"
  | "soy";
export type Slot = "breakfast" | "lunch" | "dinner" | "snack";
export type DietTag = "vegetarian" | "vegan" | "pescatarian";
export type Equipment = "stove" | "oven" | "blender" | "multicooker" | "none";

export interface SeedIngredient {
  /** Стабильный ключ = id в БД (идемпотентность сида). */
  slug: string;
  name: string;
  group: string;
  unit: Unit;
  kcal: number;
  protein: number;
  fat: number;
  carb: number;
  fiber: number;
  /** натрий, мг на 100 г */
  sodium: number;
  packSize: number;
  pricePerPack: number;
  shelfLifeDays: number;
  /** Масса одной штуки, г — только для штучных (unit="pcs"); для г/мл не задаётся. */
  gramsPerPiece?: number;
  allergens: Allergen[];
}

export interface SeedRecipeItem {
  /** slug ингредиента из INGREDIENTS */
  ingredient: string;
  /** масса на всё блюдо, г (для мл — миллилитры) */
  grams: number;
}

export interface SeedRecipe {
  slug: string;
  name: string;
  steps: string[];
  timeMin: number;
  difficulty: number;
  servings: number;
  slots: Slot[];
  diet: DietTag[];
  equipment: Equipment[];
  items: SeedRecipeItem[];
}

const G = {
  cereal: "Крупы и макароны",
  dairy: "Молочные продукты",
  meat: "Мясо и птица",
  fish: "Рыба и морепродукты",
  veg: "Овощи",
  fruit: "Фрукты и ягоды",
  grocery: "Бакалея",
  egg: "Яйца",
  nuts: "Орехи и семечки",
  bread: "Хлеб и выпечка",
  canned: "Консервы",
} as const;

export const INGREDIENTS: SeedIngredient[] = [
  // --- Крупы, макароны, бобовые ---
  { slug: "grechka", name: "Гречка ядрица", group: G.cereal, unit: "g", kcal: 343, protein: 12.6, fat: 3.3, carb: 62, fiber: 11, sodium: 3, packSize: 900, pricePerPack: 95, shelfLifeDays: 540, allergens: [] },
  { slug: "ris-kruglyy", name: "Рис круглозёрный", group: G.cereal, unit: "g", kcal: 344, protein: 7.0, fat: 1.0, carb: 76, fiber: 1.4, sodium: 2, packSize: 900, pricePerPack: 90, shelfLifeDays: 540, allergens: [] },
  { slug: "ovsyanka", name: "Овсяные хлопья «Геркулес»", group: G.cereal, unit: "g", kcal: 355, protein: 12.3, fat: 6.2, carb: 62, fiber: 6.0, sodium: 5, packSize: 500, pricePerPack: 75, shelfLifeDays: 180, allergens: ["gluten"] },
  { slug: "makarony", name: "Макароны рожки", group: G.cereal, unit: "g", kcal: 344, protein: 11, fat: 1.3, carb: 70, fiber: 3.0, sodium: 5, packSize: 400, pricePerPack: 60, shelfLifeDays: 720, allergens: ["gluten"] },
  { slug: "chechevica", name: "Чечевица сухая", group: G.cereal, unit: "g", kcal: 314, protein: 24.6, fat: 1.5, carb: 46, fiber: 11, sodium: 6, packSize: 450, pricePerPack: 95, shelfLifeDays: 540, allergens: [] },
  { slug: "perlovka", name: "Перловая крупа", group: G.cereal, unit: "g", kcal: 320, protein: 9.3, fat: 1.1, carb: 67, fiber: 7.8, sodium: 4, packSize: 800, pricePerPack: 55, shelfLifeDays: 450, allergens: ["gluten"] },

  // --- Молочные продукты ---
  { slug: "moloko", name: "Молоко 2.5%", group: G.dairy, unit: "ml", kcal: 52, protein: 2.9, fat: 2.5, carb: 4.7, fiber: 0, sodium: 43, packSize: 930, pricePerPack: 75, shelfLifeDays: 10, allergens: ["milk"] },
  { slug: "kefir", name: "Кефир 1%", group: G.dairy, unit: "ml", kcal: 40, protein: 3.0, fat: 1.0, carb: 4.0, fiber: 0, sodium: 50, packSize: 900, pricePerPack: 70, shelfLifeDays: 14, allergens: ["milk"] },
  { slug: "tvorog5", name: "Творог 5%", group: G.dairy, unit: "g", kcal: 121, protein: 17.2, fat: 5.0, carb: 3.0, fiber: 0, sodium: 41, packSize: 200, pricePerPack: 90, shelfLifeDays: 10, allergens: ["milk"] },
  { slug: "smetana", name: "Сметана 15%", group: G.dairy, unit: "g", kcal: 158, protein: 2.6, fat: 15.0, carb: 3.6, fiber: 0, sodium: 35, packSize: 315, pricePerPack: 90, shelfLifeDays: 14, allergens: ["milk"] },
  { slug: "syr", name: "Сыр «Российский» 50%", group: G.dairy, unit: "g", kcal: 363, protein: 23.0, fat: 29.5, carb: 0, fiber: 0, sodium: 820, packSize: 200, pricePerPack: 220, shelfLifeDays: 120, allergens: ["milk"] },
  { slug: "maslo-slivochnoe", name: "Масло сливочное 82.5%", group: G.dairy, unit: "g", kcal: 748, protein: 0.5, fat: 82.5, carb: 0.8, fiber: 0, sodium: 15, packSize: 180, pricePerPack: 195, shelfLifeDays: 120, allergens: ["milk"] },
  { slug: "yogurt", name: "Йогурт натуральный 3.2%", group: G.dairy, unit: "g", kcal: 66, protein: 5.0, fat: 3.2, carb: 3.5, fiber: 0, sodium: 50, packSize: 290, pricePerPack: 70, shelfLifeDays: 21, allergens: ["milk"] },

  // --- Яйца ---
  { slug: "yaytso", name: "Яйцо куриное С1", group: G.egg, unit: "pcs", kcal: 157, protein: 12.7, fat: 11.5, carb: 0.7, fiber: 0, sodium: 134, packSize: 10, pricePerPack: 110, shelfLifeDays: 25, gramsPerPiece: 55, allergens: ["egg"] },

  // --- Мясо и птица ---
  { slug: "kur-file", name: "Куриное филе грудки", group: G.meat, unit: "g", kcal: 113, protein: 23.5, fat: 1.9, carb: 0, fiber: 0, sodium: 60, packSize: 800, pricePerPack: 260, shelfLifeDays: 5, allergens: ["poultry"] },
  { slug: "kur-bedro", name: "Куриное бедро (мякоть)", group: G.meat, unit: "g", kcal: 185, protein: 18.0, fat: 12.5, carb: 0, fiber: 0, sodium: 75, packSize: 900, pricePerPack: 230, shelfLifeDays: 5, allergens: ["poultry"] },
  { slug: "govyadina", name: "Говядина (лопатка)", group: G.meat, unit: "g", kcal: 187, protein: 19.0, fat: 12.0, carb: 0, fiber: 0, sodium: 65, packSize: 1000, pricePerPack: 550, shelfLifeDays: 5, allergens: ["meat"] },
  { slug: "farsh-govyazhiy", name: "Фарш говяжий", group: G.meat, unit: "g", kcal: 254, protein: 17.0, fat: 20.0, carb: 0, fiber: 0, sodium: 70, packSize: 500, pricePerPack: 320, shelfLifeDays: 3, allergens: ["meat"] },

  // --- Рыба ---
  { slug: "mintay", name: "Минтай (филе)", group: G.fish, unit: "g", kcal: 72, protein: 16.0, fat: 0.9, carb: 0, fiber: 0, sodium: 70, packSize: 800, pricePerPack: 220, shelfLifeDays: 180, allergens: ["fish"] },
  { slug: "gorbusha", name: "Горбуша", group: G.fish, unit: "g", kcal: 142, protein: 20.5, fat: 6.5, carb: 0, fiber: 0, sodium: 60, packSize: 1000, pricePerPack: 450, shelfLifeDays: 180, allergens: ["fish"] },

  // --- Овощи ---
  { slug: "kartofel", name: "Картофель", group: G.veg, unit: "g", kcal: 77, protein: 2.0, fat: 0.4, carb: 16.0, fiber: 1.4, sodium: 6, packSize: 2500, pricePerPack: 100, shelfLifeDays: 60, allergens: [] },
  { slug: "morkov", name: "Морковь", group: G.veg, unit: "g", kcal: 35, protein: 1.3, fat: 0.1, carb: 6.9, fiber: 2.4, sodium: 60, packSize: 1000, pricePerPack: 50, shelfLifeDays: 60, allergens: [] },
  { slug: "luk", name: "Лук репчатый", group: G.veg, unit: "g", kcal: 41, protein: 1.4, fat: 0.2, carb: 8.2, fiber: 1.7, sodium: 4, packSize: 1000, pricePerPack: 45, shelfLifeDays: 90, allergens: [] },
  { slug: "kapusta", name: "Капуста белокочанная", group: G.veg, unit: "g", kcal: 28, protein: 1.8, fat: 0.1, carb: 4.7, fiber: 2.0, sodium: 18, packSize: 1000, pricePerPack: 40, shelfLifeDays: 60, allergens: [] },
  { slug: "pomidory", name: "Помидоры", group: G.veg, unit: "g", kcal: 20, protein: 1.1, fat: 0.2, carb: 3.7, fiber: 1.2, sodium: 5, packSize: 1000, pricePerPack: 180, shelfLifeDays: 10, allergens: [] },
  { slug: "ogurcy", name: "Огурцы", group: G.veg, unit: "g", kcal: 15, protein: 0.8, fat: 0.1, carb: 2.8, fiber: 0.7, sodium: 2, packSize: 1000, pricePerPack: 130, shelfLifeDays: 10, allergens: [] },
  { slug: "perec", name: "Перец болгарский", group: G.veg, unit: "g", kcal: 27, protein: 1.3, fat: 0.1, carb: 5.3, fiber: 1.9, sodium: 3, packSize: 500, pricePerPack: 150, shelfLifeDays: 12, allergens: [] },
  { slug: "brokkoli", name: "Брокколи", group: G.veg, unit: "g", kcal: 34, protein: 2.8, fat: 0.4, carb: 4.0, fiber: 2.6, sodium: 30, packSize: 400, pricePerPack: 130, shelfLifeDays: 10, allergens: [] },
  { slug: "kabachok", name: "Кабачок", group: G.veg, unit: "g", kcal: 24, protein: 0.6, fat: 0.3, carb: 4.6, fiber: 1.0, sodium: 3, packSize: 700, pricePerPack: 90, shelfLifeDays: 21, allergens: [] },
  { slug: "chesnok", name: "Чеснок", group: G.veg, unit: "g", kcal: 143, protein: 6.5, fat: 0.5, carb: 30.0, fiber: 1.5, sodium: 17, packSize: 200, pricePerPack: 90, shelfLifeDays: 90, allergens: [] },
  { slug: "shampinony", name: "Шампиньоны", group: G.veg, unit: "g", kcal: 22, protein: 3.1, fat: 0.3, carb: 3.3, fiber: 1.0, sodium: 5, packSize: 400, pricePerPack: 120, shelfLifeDays: 7, allergens: [] },
  { slug: "zelen", name: "Зелень (укроп/петрушка)", group: G.veg, unit: "g", kcal: 43, protein: 3.5, fat: 0.5, carb: 6.3, fiber: 3.0, sodium: 40, packSize: 100, pricePerPack: 60, shelfLifeDays: 7, allergens: [] },
  { slug: "salat", name: "Салат листовой", group: G.veg, unit: "g", kcal: 15, protein: 1.4, fat: 0.2, carb: 2.9, fiber: 1.3, sodium: 28, packSize: 150, pricePerPack: 90, shelfLifeDays: 7, allergens: [] },

  // --- Фрукты ---
  { slug: "yabloki", name: "Яблоки", group: G.fruit, unit: "g", kcal: 47, protein: 0.4, fat: 0.4, carb: 9.8, fiber: 2.4, sodium: 1, packSize: 1000, pricePerPack: 110, shelfLifeDays: 30, allergens: [] },
  { slug: "banany", name: "Бананы", group: G.fruit, unit: "g", kcal: 96, protein: 1.5, fat: 0.5, carb: 21.0, fiber: 1.7, sodium: 1, packSize: 1000, pricePerPack: 100, shelfLifeDays: 7, allergens: [] },

  // --- Бакалея ---
  { slug: "maslo-podsolnechnoe", name: "Масло подсолнечное", group: G.grocery, unit: "ml", kcal: 899, protein: 0, fat: 99.9, carb: 0, fiber: 0, sodium: 0, packSize: 1000, pricePerPack: 120, shelfLifeDays: 540, allergens: [] },
  { slug: "maslo-olivkovoe", name: "Масло оливковое", group: G.grocery, unit: "ml", kcal: 898, protein: 0, fat: 99.8, carb: 0, fiber: 0, sodium: 2, packSize: 500, pricePerPack: 500, shelfLifeDays: 540, allergens: [] },
  { slug: "muka", name: "Мука пшеничная в/с", group: G.grocery, unit: "g", kcal: 342, protein: 10.3, fat: 1.1, carb: 70.6, fiber: 3.5, sodium: 2, packSize: 2000, pricePerPack: 90, shelfLifeDays: 365, allergens: ["gluten"] },
  { slug: "sahar", name: "Сахар-песок", group: G.grocery, unit: "g", kcal: 399, protein: 0, fat: 0, carb: 99.8, fiber: 0, sodium: 1, packSize: 900, pricePerPack: 75, shelfLifeDays: 720, allergens: [] },
  { slug: "sol", name: "Соль поваренная", group: G.grocery, unit: "g", kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, sodium: 38700, packSize: 1000, pricePerPack: 25, shelfLifeDays: 1800, allergens: [] },
  { slug: "tomat-pasta", name: "Томатная паста", group: G.grocery, unit: "g", kcal: 92, protein: 4.3, fat: 0.5, carb: 19.0, fiber: 3.5, sodium: 40, packSize: 500, pricePerPack: 100, shelfLifeDays: 360, allergens: [] },
  { slug: "med", name: "Мёд натуральный", group: G.grocery, unit: "g", kcal: 329, protein: 0.8, fat: 0, carb: 81.5, fiber: 0.2, sodium: 4, packSize: 500, pricePerPack: 350, shelfLifeDays: 730, allergens: [] },

  // --- Орехи ---
  { slug: "greckiy-orekh", name: "Грецкий орех (ядро)", group: G.nuts, unit: "g", kcal: 654, protein: 15.2, fat: 65.2, carb: 7.0, fiber: 6.7, sodium: 2, packSize: 150, pricePerPack: 200, shelfLifeDays: 180, allergens: ["nuts"] },

  // --- Хлеб ---
  { slug: "hleb-cz", name: "Хлеб цельнозерновой", group: G.bread, unit: "g", kcal: 229, protein: 8.5, fat: 3.5, carb: 40.0, fiber: 6.5, sodium: 400, packSize: 400, pricePerPack: 70, shelfLifeDays: 6, allergens: ["gluten"] },

  // --- Консервы ---
  { slug: "goroshek", name: "Горошек зелёный консерв.", group: G.canned, unit: "g", kcal: 55, protein: 3.6, fat: 0.2, carb: 9.8, fiber: 3.5, sodium: 250, packSize: 400, pricePerPack: 80, shelfLifeDays: 1080, allergens: [] },
];

export const RECIPES: SeedRecipe[] = [
  {
    slug: "ovsyanka-banan",
    name: "Овсянка на молоке с бананом",
    steps: [
      "Довести молоко до кипения, всыпать хлопья, помешивать.",
      "Варить 5–7 минут на слабом огне до загустения.",
      "Снять с огня, добавить нарезанный банан и мёд.",
    ],
    timeMin: 12,
    difficulty: 1,
    servings: 1,
    slots: ["breakfast"],
    diet: ["vegetarian"],
    equipment: ["stove"],
    items: [
      { ingredient: "ovsyanka", grams: 60 },
      { ingredient: "moloko", grams: 200 },
      { ingredient: "banany", grams: 100 },
      { ingredient: "med", grams: 10 },
    ],
  },
  {
    slug: "tvorog-banan-orehi",
    name: "Творог с бананом и грецким орехом",
    steps: [
      "Размять творог вилкой.",
      "Добавить нарезанный банан, орехи и мёд, перемешать.",
    ],
    timeMin: 5,
    difficulty: 1,
    servings: 1,
    slots: ["breakfast", "snack"],
    diet: ["vegetarian"],
    equipment: ["none"],
    items: [
      { ingredient: "tvorog5", grams: 200 },
      { ingredient: "banany", grams: 80 },
      { ingredient: "greckiy-orekh", grams: 15 },
      { ingredient: "med", grams: 10 },
    ],
  },
  {
    slug: "yaichnica-ovoshchi",
    name: "Яичница с овощами",
    steps: [
      "Разогреть масло на сковороде, обжарить нарезанный перец 3 минуты.",
      "Добавить помидоры, готовить ещё 2 минуты.",
      "Влить взбитые яйца, посолить, довести до готовности под крышкой.",
    ],
    timeMin: 12,
    difficulty: 1,
    servings: 1,
    slots: ["breakfast"],
    diet: ["vegetarian"],
    equipment: ["stove"],
    items: [
      { ingredient: "yaytso", grams: 110 },
      { ingredient: "pomidory", grams: 100 },
      { ingredient: "perec", grams: 50 },
      { ingredient: "maslo-podsolnechnoe", grams: 5 },
      { ingredient: "sol", grams: 1 },
    ],
  },
  {
    slug: "omlet-syr",
    name: "Омлет с сыром",
    steps: [
      "Взбить яйца с молоком и солью.",
      "Вылить на разогретую сковороду со сливочным маслом.",
      "Посыпать тёртым сыром, готовить под крышкой до схватывания.",
    ],
    timeMin: 10,
    difficulty: 1,
    servings: 1,
    slots: ["breakfast"],
    diet: ["vegetarian"],
    equipment: ["stove"],
    items: [
      { ingredient: "yaytso", grams: 165 },
      { ingredient: "moloko", grams: 50 },
      { ingredient: "syr", grams: 40 },
      { ingredient: "maslo-slivochnoe", grams: 5 },
      { ingredient: "sol", grams: 1 },
    ],
  },
  {
    slug: "grechka-yabloko",
    name: "Гречневая каша с яблоком",
    steps: [
      "Промыть гречку, залить водой 1:2, довести до кипения.",
      "Варить под крышкой 15 минут до впитывания воды.",
      "Вмешать натёртое яблоко и мёд.",
    ],
    timeMin: 20,
    difficulty: 1,
    servings: 2,
    slots: ["breakfast"],
    // Не веганское: содержит мёд.
    diet: ["vegetarian"],
    equipment: ["stove"],
    items: [
      { ingredient: "grechka", grams: 150 },
      { ingredient: "yabloki", grams: 150 },
      { ingredient: "med", grams: 20 },
    ],
  },
  {
    slug: "tost-yaytso",
    name: "Тост цельнозерновой с яйцом",
    steps: [
      "Отварить яйцо вкрутую, очистить и нарезать.",
      "Подсушить хлеб, выложить листья салата и помидор.",
      "Сверху разложить яйцо, посолить.",
    ],
    timeMin: 12,
    difficulty: 1,
    servings: 1,
    slots: ["breakfast", "snack"],
    diet: ["vegetarian"],
    equipment: ["stove"],
    items: [
      { ingredient: "hleb-cz", grams: 80 },
      { ingredient: "yaytso", grams: 55 },
      { ingredient: "pomidory", grams: 60 },
      { ingredient: "salat", grams: 20 },
    ],
  },
  {
    slug: "yogurt-banan-orehi",
    name: "Йогурт с бананом и орехами",
    steps: ["Нарезать банан.", "Смешать йогурт с бананом, орехами и мёдом."],
    timeMin: 4,
    difficulty: 1,
    servings: 1,
    slots: ["snack", "breakfast"],
    diet: ["vegetarian"],
    equipment: ["none"],
    items: [
      { ingredient: "yogurt", grams: 200 },
      { ingredient: "banany", grams: 100 },
      { ingredient: "greckiy-orekh", grams: 15 },
      { ingredient: "med", grams: 10 },
    ],
  },
  {
    slug: "sup-kurinyy",
    name: "Куриный суп с лапшой",
    steps: [
      "Отварить куриное филе 20 минут, вынуть и нарезать.",
      "В бульон добавить картофель кубиками, варить 10 минут.",
      "Спассеровать лук и морковь на масле, добавить в суп.",
      "Всыпать макароны, вернуть курицу, варить 8 минут.",
      "Посолить, добавить зелень, дать настояться.",
    ],
    timeMin: 45,
    difficulty: 2,
    servings: 4,
    slots: ["lunch"],
    diet: [],
    equipment: ["stove"],
    items: [
      { ingredient: "kur-file", grams: 400 },
      { ingredient: "kartofel", grams: 300 },
      { ingredient: "morkov", grams: 100 },
      { ingredient: "luk", grams: 80 },
      { ingredient: "makarony", grams: 100 },
      { ingredient: "maslo-podsolnechnoe", grams: 15 },
      { ingredient: "zelen", grams: 20 },
      { ingredient: "sol", grams: 4 },
    ],
  },
  {
    slug: "shchi-govyadina",
    name: "Щи из свежей капусты с говядиной",
    steps: [
      "Отварить говядину до готовности, нарезать, бульон сохранить.",
      "Добавить в бульон картофель, варить 10 минут.",
      "Спассеровать лук, морковь и томатную пасту, добавить в кастрюлю.",
      "Всыпать нашинкованную капусту, вернуть мясо, варить 15 минут.",
      "Посолить по вкусу.",
    ],
    timeMin: 70,
    difficulty: 2,
    servings: 4,
    slots: ["lunch"],
    diet: [],
    equipment: ["stove"],
    items: [
      { ingredient: "govyadina", grams: 400 },
      { ingredient: "kapusta", grams: 300 },
      { ingredient: "kartofel", grams: 200 },
      { ingredient: "morkov", grams: 100 },
      { ingredient: "luk", grams: 80 },
      { ingredient: "tomat-pasta", grams: 40 },
      { ingredient: "maslo-podsolnechnoe", grams: 15 },
      { ingredient: "sol", grams: 4 },
    ],
  },
  {
    slug: "sup-chechevica",
    name: "Чечевичный суп",
    steps: [
      "Промыть чечевицу, залить водой, довести до кипения.",
      "Добавить картофель, варить 15 минут.",
      "Спассеровать лук, морковь и томатную пасту, добавить в суп.",
      "Варить до мягкости чечевицы, посолить.",
    ],
    timeMin: 40,
    difficulty: 2,
    servings: 3,
    slots: ["lunch"],
    diet: ["vegan", "vegetarian"],
    equipment: ["stove"],
    items: [
      { ingredient: "chechevica", grams: 200 },
      { ingredient: "kartofel", grams: 200 },
      { ingredient: "morkov", grams: 100 },
      { ingredient: "luk", grams: 80 },
      { ingredient: "tomat-pasta", grams: 40 },
      { ingredient: "maslo-podsolnechnoe", grams: 15 },
      { ingredient: "sol", grams: 3 },
    ],
  },
  {
    slug: "grechka-kurica",
    name: "Гречка с куриным бедром и овощами",
    steps: [
      "Отварить гречку до готовности.",
      "Обжарить куриное бедро на масле до румяности.",
      "Добавить лук и морковь, тушить 10 минут.",
      "Подавать курицу с овощами на гречке.",
    ],
    timeMin: 35,
    difficulty: 2,
    servings: 2,
    slots: ["lunch", "dinner"],
    diet: [],
    equipment: ["stove"],
    items: [
      { ingredient: "grechka", grams: 150 },
      { ingredient: "kur-bedro", grams: 300 },
      { ingredient: "morkov", grams: 80 },
      { ingredient: "luk", grams: 60 },
      { ingredient: "maslo-podsolnechnoe", grams: 10 },
    ],
  },
  {
    slug: "ris-ryba",
    name: "Рис с минтаем и овощами",
    steps: [
      "Отварить рис до готовности.",
      "Припустить минтай с луком и морковью на масле под крышкой 15 минут.",
      "Подавать рыбу с овощами на рисе.",
    ],
    timeMin: 30,
    difficulty: 2,
    servings: 2,
    slots: ["dinner", "lunch"],
    diet: ["pescatarian"],
    equipment: ["stove"],
    items: [
      { ingredient: "ris-kruglyy", grams: 150 },
      { ingredient: "mintay", grams: 300 },
      { ingredient: "morkov", grams: 80 },
      { ingredient: "luk", grams: 60 },
      { ingredient: "maslo-podsolnechnoe", grams: 10 },
    ],
  },
  {
    slug: "pasta-bolognese",
    name: "Паста с фаршем по-болонски",
    steps: [
      "Отварить макароны до состояния аль денте.",
      "Обжарить лук и морковь на оливковом масле.",
      "Добавить фарш, обжарить до румяности.",
      "Влить томатную пасту с водой, тушить 15 минут, посолить.",
      "Смешать соус с макаронами.",
    ],
    timeMin: 35,
    difficulty: 2,
    servings: 3,
    slots: ["lunch", "dinner"],
    diet: [],
    equipment: ["stove"],
    items: [
      { ingredient: "makarony", grams: 250 },
      { ingredient: "farsh-govyazhiy", grams: 300 },
      { ingredient: "tomat-pasta", grams: 80 },
      { ingredient: "luk", grams: 80 },
      { ingredient: "morkov", grams: 80 },
      { ingredient: "maslo-olivkovoe", grams: 15 },
    ],
  },
  {
    slug: "kapusta-tushenaya-kurica",
    name: "Тушёная капуста с курицей",
    steps: [
      "Нашинковать капусту, нарезать куриное филе.",
      "Обжарить курицу на масле, добавить лук и морковь.",
      "Добавить капусту и томатную пасту, тушить под крышкой 25 минут.",
      "Посолить по вкусу.",
    ],
    timeMin: 40,
    difficulty: 2,
    servings: 3,
    slots: ["dinner", "lunch"],
    diet: [],
    equipment: ["stove"],
    items: [
      { ingredient: "kapusta", grams: 500 },
      { ingredient: "kur-file", grams: 400 },
      { ingredient: "morkov", grams: 100 },
      { ingredient: "luk", grams: 100 },
      { ingredient: "tomat-pasta", grams: 40 },
      { ingredient: "maslo-podsolnechnoe", grams: 15 },
    ],
  },
  {
    slug: "ovoshchnoe-ragu",
    name: "Овощное рагу с кабачком",
    steps: [
      "Нарезать все овощи кубиками.",
      "Обжарить лук и морковь на масле.",
      "Добавить картофель, кабачок, перец и помидоры.",
      "Тушить под крышкой 25 минут, посолить.",
    ],
    timeMin: 40,
    difficulty: 1,
    servings: 3,
    slots: ["dinner", "lunch"],
    diet: ["vegan", "vegetarian"],
    equipment: ["stove"],
    items: [
      { ingredient: "kabachok", grams: 300 },
      { ingredient: "kartofel", grams: 300 },
      { ingredient: "morkov", grams: 100 },
      { ingredient: "luk", grams: 100 },
      { ingredient: "pomidory", grams: 200 },
      { ingredient: "perec", grams: 100 },
      { ingredient: "maslo-podsolnechnoe", grams: 20 },
    ],
  },
  {
    slug: "kurica-grill-brokkoli",
    name: "Куриная грудка с брокколи",
    steps: [
      "Нарезать филе, обжарить на оливковом масле с чесноком.",
      "Отварить или приготовить на пару брокколи 5–7 минут.",
      "Подавать курицу с брокколи, посолить.",
    ],
    timeMin: 25,
    difficulty: 1,
    servings: 2,
    slots: ["dinner"],
    diet: [],
    equipment: ["stove"],
    items: [
      { ingredient: "kur-file", grams: 400 },
      { ingredient: "brokkoli", grams: 300 },
      { ingredient: "maslo-olivkovoe", grams: 15 },
      { ingredient: "chesnok", grams: 10 },
    ],
  },
  {
    slug: "ryba-tushenaya-ovoshchi",
    name: "Тушёная горбуша с овощами",
    steps: [
      "Нарезать горбушу порционно.",
      "Выложить в сотейник с луком, морковью и картофелем.",
      "Добавить немного воды и масло, тушить под крышкой 25 минут.",
    ],
    timeMin: 35,
    difficulty: 2,
    servings: 2,
    slots: ["dinner"],
    diet: ["pescatarian"],
    equipment: ["stove"],
    items: [
      { ingredient: "gorbusha", grams: 300 },
      { ingredient: "kartofel", grams: 200 },
      { ingredient: "morkov", grams: 80 },
      { ingredient: "luk", grams: 60 },
      { ingredient: "maslo-podsolnechnoe", grams: 10 },
    ],
  },
  {
    slug: "salat-ovoshchi-syr",
    name: "Овощной салат с сыром",
    steps: [
      "Нарезать помидоры, огурцы и перец.",
      "Порвать листья салата, добавить кубики сыра.",
      "Заправить оливковым маслом, посолить.",
    ],
    timeMin: 10,
    difficulty: 1,
    servings: 2,
    slots: ["lunch", "snack"],
    diet: ["vegetarian"],
    equipment: ["none"],
    items: [
      { ingredient: "pomidory", grams: 200 },
      { ingredient: "ogurcy", grams: 200 },
      { ingredient: "perec", grams: 100 },
      { ingredient: "salat", grams: 60 },
      { ingredient: "syr", grams: 60 },
      { ingredient: "maslo-olivkovoe", grams: 20 },
    ],
  },
];
