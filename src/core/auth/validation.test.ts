import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  validateEmail,
  validatePassword,
  validateRegistration,
} from "./validation";

describe("normalizeEmail", () => {
  it("обрезает пробелы и приводит к нижнему регистру", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
  });
});

describe("validateEmail", () => {
  it("принимает корректный адрес", () => {
    expect(validateEmail("user@example.com")).toBeNull();
  });

  it("отклоняет пустое значение", () => {
    expect(validateEmail("")).toBe("Введите электронную почту");
  });

  it("отклоняет адрес без @", () => {
    expect(validateEmail("userexample.com")).toBe("Некорректная электронная почта");
  });

  it("отклоняет адрес без домена", () => {
    expect(validateEmail("user@")).toBe("Некорректная электронная почта");
  });
});

describe("validatePassword", () => {
  it("принимает пароль от 8 символов", () => {
    expect(validatePassword("password1")).toBeNull();
  });

  it("отклоняет пустой пароль", () => {
    expect(validatePassword("")).toBe("Введите пароль");
  });

  it("отклоняет слишком короткий пароль", () => {
    expect(validatePassword("short")).toBe("Пароль должен быть не короче 8 символов");
  });
});

describe("validateRegistration", () => {
  it("для корректных данных ошибок нет", () => {
    const errors = validateRegistration({
      email: "user@example.com",
      password: "password1",
      consent: true,
    });
    expect(errors).toEqual({});
  });

  it("требует согласие на обработку данных", () => {
    const errors = validateRegistration({
      email: "user@example.com",
      password: "password1",
      consent: false,
    });
    expect(errors.consent).toBe("Нужно согласиться на обработку данных");
  });

  it("собирает ошибки по каждому полю независимо", () => {
    const errors = validateRegistration({
      email: "bad",
      password: "x",
      consent: false,
    });
    expect(errors.email).toBeTruthy();
    expect(errors.password).toBeTruthy();
    expect(errors.consent).toBeTruthy();
  });
});
