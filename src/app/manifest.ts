import type { MetadataRoute } from "next";

// PWA-манифест (тикет 10). Next отдаёт его как /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Рацион — планировщик питания",
    short_name: "Рацион",
    description: "Генерация рационов под ваши цели по КБЖУ.",
    lang: "ru",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f2f2f7",
    theme_color: "#0a84ff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
