// Чистая валидация учётных данных (тикет 08). Без зависимостей от Prisma/UI.
// Сообщения об ошибках на русском — показываются пользователю как есть.

export const MIN_PASSWORD_LENGTH = 8;

// Прагматичная проверка email: непустая локальная часть, @, домен с точкой.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): string | null {
  const value = normalizeEmail(email);
  if (value.length === 0) return "Введите электронную почту";
  if (!EMAIL_RE.test(value)) return "Некорректная электронная почта";
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length === 0) return "Введите пароль";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`;
  }
  return null;
}

export interface RegistrationInput {
  email: string;
  password: string;
  consent: boolean;
}

export interface RegistrationErrors {
  email?: string;
  password?: string;
  consent?: string;
}

export function validateRegistration(input: RegistrationInput): RegistrationErrors {
  const errors: RegistrationErrors = {};

  const emailError = validateEmail(input.email);
  if (emailError) errors.email = emailError;

  const passwordError = validatePassword(input.password);
  if (passwordError) errors.password = passwordError;

  if (!input.consent) {
    errors.consent = "Нужно согласиться на обработку данных";
  }

  return errors;
}
