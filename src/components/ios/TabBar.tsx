"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface Tab {
  href: string;
  label: string;
  icon: ReactNode;
}

const TABS: Tab[] = [
  {
    href: "/dnevnik",
    label: "Дневник",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 3v18" />
        <path d="M12 8h4M12 12h4" />
      </svg>
    ),
  },
  {
    href: "/baza",
    label: "База",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 2h12v20l-6-4-6 4z" />
      </svg>
    ),
  },
  {
    href: "/pokupki",
    label: "Покупки",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="21" r="1" />
        <circle cx="19" cy="21" r="1" />
        <path d="M3 4h2l2.5 12h11l2-8H6" />
      </svg>
    ),
  },
  {
    href: "/profil",
    label: "Профиль",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
      </svg>
    ),
  },
];

/** Нижний таб-бар с материалом (blur), тикет 09. */
export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="tabbar" aria-label="Основная навигация">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? "on" : undefined}
            aria-current={active ? "page" : undefined}
          >
            {tab.icon}
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
