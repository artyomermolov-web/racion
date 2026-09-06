import { requireUser } from "@/lib/auth";
import { TabBar } from "@/components/ios/TabBar";

// Весь раздел за таб-баром доступен только после входа (тикет 08/11).
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();

  return (
    <div className="app with-tabbar">
      {children}
      <TabBar />
    </div>
  );
}
