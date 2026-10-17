"use client";

import { RefreshCw } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { seatSnapshotAgeMinutes } from "@/lib/seat-refresh";

const FreshnessClock = createContext<number | undefined>(undefined);

export function SeatFreshnessClock({ children }: { children: ReactNode }) {
  const [now, setNow] = useState<number>();
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <FreshnessClock.Provider value={now}>{children}</FreshnessClock.Provider>
  );
}

export function SeatFreshnessLabel({ checkedAt }: { checkedAt: string }) {
  const now = useContext(FreshnessClock);
  return (
    <time dateTime={checkedAt} title={new Date(checkedAt).toLocaleString()}>
      {now === undefined
        ? "Last checked recently"
        : `Last checked ${seatSnapshotAgeMinutes(checkedAt, now)} min ago`}
    </time>
  );
}

export function SeatRefreshButton({
  disabled,
  refreshing,
  onClick,
  fun = false,
}: {
  disabled: boolean;
  refreshing: boolean;
  onClick: () => void;
  fun?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-busy={refreshing}
      className={fun
        ? "focus-ring inline-flex min-h-11 items-center justify-center gap-2 border-4 border-black bg-[#f7e900] px-4 py-2 text-sm font-black uppercase text-black shadow-[5px_5px_0_#111111] disabled:opacity-60"
        : "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"}
    >
      <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
      {refreshing ? "Refreshing seats…" : "Refresh seats"}
    </button>
  );
}
