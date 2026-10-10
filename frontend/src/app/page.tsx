import SystemStatus from "@/components/SystemStatus";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-16">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-lg font-bold text-white">
          Y
        </div>
        <div>
          <p className="text-xl font-bold tracking-wide">YESE</p>
          <p className="text-sm text-muted">OpenTek School Enterprise Management System</p>
        </div>
      </div>
      <SystemStatus />
    </main>
  );
}
