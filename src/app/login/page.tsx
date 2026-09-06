import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { loginAction } from "@/app/actions/auth";
import { AuthForm } from "./AuthForm";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/home");

  return (
    <div className="app">
      <div className="auth">
        <div className="brand">
          <div className="logo" aria-hidden="true">
            🥗
          </div>
          <h1>Рацион</h1>
          <p>Питание под ваши цели по КБЖУ</p>
        </div>

        <AuthForm mode="login" action={loginAction} />

        <div className="switch">
          Нет аккаунта? <Link href="/register">Зарегистрироваться</Link>
        </div>
      </div>
    </div>
  );
}
