// Хеширование пароля (тикет 08). bcrypt через bcryptjs — без нативной сборки,
// стабильно на Windows и в контейнере.
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Выравнивание времени ответа: когда пользователь не найден, всё равно
// выполняем сравнение bcrypt против фиктивного хеша, чтобы по времени ответа
// нельзя было отличить существующую почту от несуществующей.
let dummyHash: Promise<string> | null = null;
export function fakeVerify(plain: string): Promise<boolean> {
  if (!dummyHash) dummyHash = bcrypt.hash("racion-dummy-password", SALT_ROUNDS);
  return dummyHash.then((h) => bcrypt.compare(plain, h));
}
