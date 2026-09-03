"use client";

import { useEffect, useState } from "react";
import {
  fetchLandmarkSeatPreview,
  type LandmarkSeatPreview,
} from "@/lib/landmark-seats";

type SeatMapClientProps = {
  cinemaId: string;
  sessionId: string;
  timeZone: string;
};

export default function SeatMapClient({
  cinemaId,
  sessionId,
  timeZone,
}: SeatMapClientProps) {
  const [preview, setPreview] = useState<LandmarkSeatPreview>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    void fetchLandmarkSeatPreview(cinemaId, sessionId)
      .then((nextPreview) => {
        if (active) {
          setPreview(nextPreview);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });

    return () => {
      active = false;
    };
  }, [cinemaId, sessionId]);

  if (failed) {
    return (
      <PreviewMessage
        title="Landmark could not load this seat preview"
        message="The preview might be disabled or temporarily unavailable. You can still buy tickets through Landmark Cinemas."
      />
    );
  }

  if (!preview) {
    return (
      <div
        className="my-6 rounded-lg border border-neutral-700 bg-neutral-950 p-5"
        role="status"
      >
        <p className="font-semibold text-white">Loading seat preview…</p>
      </div>
    );
  }

  return <SeatMap preview={preview} timeZone={timeZone} />;
}

function PreviewMessage({
  message,
  title,
}: {
  message: string;
  title: string;
}) {
  return (
    <div
      className="my-6 rounded-lg border border-neutral-700 bg-neutral-950 p-5"
      role="status"
    >
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <p className="mt-2 max-w-2xl leading-6 text-neutral-300">{message}</p>
    </div>
  );
}

function SeatMap({
  preview,
  timeZone,
}: {
  preview: LandmarkSeatPreview;
  timeZone: string;
}) {
  const openSeats = Math.max(
    0,
    preview.snapshot.sellableSeats - preview.snapshot.occupiedEstimate,
  );

  return (
    <div className="mt-6 grid gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <SeatStat label="Open standard seats" value={openSeats} />
        <SeatStat
          label="Occupied estimate"
          value={preview.snapshot.occupiedEstimate}
        />
        <SeatStat
          label="Accessible seats"
          value={preview.snapshot.accessibilityCount}
        />
      </div>

      <div className="rounded-lg border border-neutral-800 bg-black p-3 sm:p-6">
        <div className="mx-auto mb-8 max-w-2xl rounded-b-[100%] border-t-4 border-amber-300 pt-3 text-center text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">
          Screen
        </div>

        <div className="grid gap-3 overflow-x-auto pb-2">
          {preview.rows.map((row) => (
            <div
              className="grid min-w-max grid-cols-[2rem_1fr] items-center gap-3"
              key={row.label}
            >
              <span className="text-right text-xs font-semibold text-neutral-500">
                {row.label}
              </span>
              <div
                className="flex min-h-7 items-center justify-center gap-1"
                role="list"
                aria-label={`Row ${row.label}`}
              >
                {row.seats.map((seat) => (
                  <span
                    className={seatClassName(seat.status, seat.accessible)}
                    key={seat.id}
                    role="listitem"
                    title={`${seat.label}: ${seat.accessible ? "accessible, " : ""}${seat.status}`}
                    aria-label={`${seat.label}: ${seat.accessible ? "accessible, " : ""}${seat.status}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-neutral-400">
        <Legend swatch="border-emerald-300 bg-emerald-300/25" label="Available" />
        <Legend swatch="border-neutral-700 bg-neutral-800" label="Unavailable" />
        <Legend swatch="border-sky-300 bg-sky-300/25" label="Accessible" />
      </div>

      <p className="text-xs leading-5 text-neutral-500">
        Checked {formatCheckedAt(preview.checkedAt, timeZone)}. Seat availability
        can change before you complete your purchase.
      </p>
    </div>
  );
}

function formatCheckedAt(value: string, timeZone: string): string {
  return new Date(value)
    .toLocaleString("en-CA", { timeZone })
    .replace(/\.$/, "");
}

function SeatStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-sm text-neutral-400">{label}</p>
    </div>
  );
}

function Legend({ label, swatch }: { label: string; swatch: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`h-3 w-3 rounded-sm border ${swatch}`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

function seatClassName(
  status: "available" | "unavailable",
  accessible: boolean,
): string {
  const color = accessible
    ? "border-sky-300 bg-sky-300/25"
    : status === "available"
      ? "border-emerald-300 bg-emerald-300/25"
      : "border-neutral-700 bg-neutral-800";

  return `h-5 w-5 rounded-t-md border ${color}`;
}
