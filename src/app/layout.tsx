import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "Рацион",
  description: "Планировщик питания под ваши цели по КБЖУ.",
  manifest: "/manifest.webmanifest",
  applicationName: "Рацион",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Рацион",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

// Ставит выбранную тему до первой отрисовки — без мигания при загрузке.
const themeScript = `(function(){try{var t=localStorage.getItem("racion-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: тему проставляет инлайн-скрипт до гидрации,
    // поэтому атрибут data-theme на <html> заведомо отличается от серверного.
    <html lang="ru" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
