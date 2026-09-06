import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("хеш не совпадает с исходным паролем", async () => {
    const hash = await hashPassword("password1");
    expect(hash).not.toBe("password1");
    expect(hash.length).toBeGreaterThan(0);
  });

  it("verifyPassword возвращает true для верного пароля", async () => {
    const hash = await hashPassword("password1");
    expect(await verifyPassword("password1", hash)).toBe(true);
  });

  it("verifyPassword возвращает false для неверного пароля", async () => {
    const hash = await hashPassword("password1");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("для одного пароля хеши разные (соль)", async () => {
    const a = await hashPassword("password1");
    const b = await hashPassword("password1");
    expect(a).not.toBe(b);
  });
});
