import { describe, it, expect } from "vitest";
import { stemWord, canonicalStems, matchCatalogIngredient } from "./catalog-match";

// Сопоставление ингредиента рецепта с каталогом по названию (тикет 05, доработка).
// Кейсы — из аудита реального каталога: морфология, родовые слова, синонимы.

describe("stemWord — лёгкий русский стеммер", () => {
  it("сводит словоформы к общему корню", () => {
    expect(stemWord("яблоки")).toBe(stemWord("яблоко"));
    expect(stemWord("помидоры")).toBe("помидор");
    expect(stemWord("бананы")).toBe("банан");
    expect(stemWord("яйца")).toBe(stemWord("яйцо"));
    expect(stemWord("муку")).toBe(stemWord("мука"));
  });

  it("не калечит короткие слова (корень остаётся ≥3)", () => {
    expect(stemWord("рис")).toBe("рис");
    expect(stemWord("сыр")).toBe("сыр");
    expect(stemWord("чай")).toBe("чай");
  });
});

describe("canonicalStems — фразовые и токен-синонимы", () => {
  it("растительное масло → масло подсолнечное", () => {
    expect(canonicalStems("Растительное масло")).toEqual(canonicalStems("Масло подсолнечное"));
  });
  it("томаты → помидор, картошка → картофель", () => {
    expect(canonicalStems("Томаты")).toContain("помидор");
    expect(canonicalStems("Картошка")).toContain("картофел");
  });
  it("служебные слова отбрасываются", () => {
    expect(canonicalStems("Помидоры свежие")).toEqual(["помидор"]);
  });
});

// Срез реального каталога Racion (имя + slug), достаточный для проверки матчера.
const catalog = [
  { name: "Гречка ядрица", slug: "grechka" },
  { name: "Рис круглозёрный", slug: "ris-kruglyy" },
  { name: "Рис длиннозёрный", slug: "ris-dlinnozernyy" },
  { name: "Молоко 2.5%", slug: "moloko" },
  { name: "Молоко 3.2%", slug: "moloko32" },
  { name: "Творог 5%", slug: "tvorog5" },
  { name: "Творог 9%", slug: "tvorog9" },
  { name: "Сыр «Российский» 50%", slug: "syr" },
  { name: "Сыр плавленый", slug: "syr-plavlenyy" },
  { name: "Масло сливочное 82.5%", slug: "maslo-slivochnoe" },
  { name: "Масло подсолнечное", slug: "maslo-podsolnechnoe" },
  { name: "Масло оливковое", slug: "maslo-olivkovoe" },
  { name: "Куриное филе грудки", slug: "kur-file" },
  { name: "Картофель", slug: "kartofel" },
  { name: "Морковь", slug: "morkov" },
  { name: "Лук репчатый", slug: "luk" },
  { name: "Помидоры", slug: "pomidory" },
  { name: "Огурцы", slug: "ogurcy" },
  { name: "Перец болгарский", slug: "perec" },
  { name: "Чеснок", slug: "chesnok" },
  { name: "Яблоки", slug: "yabloki" },
  { name: "Бананы", slug: "banany" },
  { name: "Мука пшеничная в/с", slug: "muka" },
  { name: "Сахар-песок", slug: "sahar" },
  { name: "Сахарная пудра", slug: "sahar-pudra" },
  { name: "Ванильный сахар", slug: "vanilnyy-sahar" },
  { name: "Соль поваренная", slug: "sol" },
  { name: "Томатная паста", slug: "tomat-pasta" },
  { name: "Соус соевый", slug: "soevyy-sous" },
  { name: "Манная крупа", slug: "manka" },
  { name: "Яйцо куриное С1", slug: "yaytso" },
  { name: "Яйцо куриное С0 (отборное)", slug: "yaytso-c0" },
  { name: "Яйцо перепелиное", slug: "yaytso-perepelinoe" },
];

const match = (name: string) => matchCatalogIngredient(name, catalog)?.slug ?? null;

describe("matchCatalogIngredient — морфология (словоформы)", () => {
  it.each([
    ["Яблоко", "yabloki"],
    ["Яблоко зелёное", "yabloki"],
    ["Помидор", "pomidory"],
    ["Огурец", "ogurcy"],
    ["Банан", "banany"],
    ["Морковка", "morkov"],
    ["Луковица", "luk"],
  ])("%s → %s", (probe, slug) => {
    expect(match(probe)).toBe(slug);
  });
});

describe("matchCatalogIngredient — родовое слово → канонический вариант", () => {
  it.each([
    ["Сахар", "sahar"],
    ["Соль", "sol"],
    ["Мука", "muka"],
    ["Рис", "ris-kruglyy"],
    ["Творог", "tvorog5"],
    ["Молоко", "moloko"],
    ["Сыр", "syr"], // канон: «Российский», не «плавленый»
    ["Яйцо", "yaytso"], // канон: куриное С1, не перепелиное
  ])("%s → %s", (probe, slug) => {
    expect(match(probe)).toBe(slug);
  });
});

describe("matchCatalogIngredient — примеры заказчика (одно и то же)", () => {
  it.each([
    ["Сахар", "sahar"],
    ["Сахар-песок", "sahar"],
    ["Сахарный песок", "sahar"],
    ["Соль", "sol"],
    ["Соль морская", "sol"],
    ["Соль поваренная", "sol"],
    ["Яблоко", "yabloki"],
    ["Яблоко зелёное", "yabloki"],
  ])("%s → %s", (probe, slug) => {
    expect(match(probe)).toBe(slug);
  });
});

describe("matchCatalogIngredient — синонимы", () => {
  it.each([
    ["Томаты", "pomidory"],
    ["Картошка", "kartofel"],
    ["Растительное масло", "maslo-podsolnechnoe"],
    ["Сладкий перец", "perec"],
    ["Гречневая крупа", "grechka"],
    ["Сливочное масло", "maslo-slivochnoe"],
    ["Сыр твёрдый", "syr"],
  ])("%s → %s", (probe, slug) => {
    expect(match(probe)).toBe(slug);
  });
});

describe("matchCatalogIngredient — нет разумного совпадения", () => {
  it("экзотика вне каталога → null (в рецепте ингредиент выпадет из состава)", () => {
    expect(match("Тахини")).toBeNull();
    expect(match("Сумах")).toBeNull();
  });

  it("общее родовое слово не даёт ложный матч (порог 0.6)", () => {
    // «Паста мисо» делит с «Томатная паста» лишь «паст» → 0.5 < 0.6, не матч.
    expect(match("Паста мисо")).toBeNull();
    // «Соус терияки» ↔ «Соус соевый» — только «соус» общий → не матч.
    expect(match("Соус терияки")).toBeNull();
  });

  it("«крупа» — филлер: гречневая/манная крупа ложатся на свой продукт", () => {
    expect(match("Гречневая крупа")).toBe("grechka");
    expect(match("Манная крупа")).toBe("manka");
  });

  it("канон не уводит на продукт без корня запроса (яйцо ↦ курица при отсутствии яиц)", () => {
    // Каталог с курицей, но без яиц: подсказка «курин» не должна утащить «Яйцо».
    const noEggs = [
      { name: "Куриное филе грудки", slug: "kur-file" },
      { name: "Гречка ядрица", slug: "grechka" },
    ];
    expect(matchCatalogIngredient("Яйцо", noEggs)).toBeNull();
  });
});
