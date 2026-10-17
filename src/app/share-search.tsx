"use client";

import { Share2 } from "lucide-react";
import { useId, useState } from "react";
import {
  buildShareSearchUrl,
  copySearchLink,
  shareSearch,
  type ShareSearchResult,
} from "@/lib/share-search";
import type { SearchState } from "@/lib/search-state";
import type { UiMode } from "@/lib/ui-mode";

export function ShareSearch({ state, mode }: {
  state: SearchState | undefined;
  mode: UiMode;
}) {
  // Key feedback to the shared search so old links and in-flight feedback cannot
  // remain visible after a new search or result filter change.
  const key = buildShareSearchUrl("https://share.invalid", state);
  return key && state ? <ShareSearchControl key={key} state={state} mode={mode} /> : null;
}

function ShareSearchControl({ state, mode }: { state: SearchState; mode: UiMode }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<ShareSearchResult>();
  const [manualUrl, setManualUrl] = useState<string>();
  const fun = mode === "fun";
  const buttonClass = fun
    ? "focus-ring inline-flex min-h-12 items-center justify-center gap-2 border-4 border-white bg-[#f7e900] px-3 py-2 text-sm font-black uppercase text-black shadow-[4px_4px_0_#ffffff] disabled:opacity-60"
    : "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-semibold text-white transition hover:border-neutral-500 hover:bg-neutral-800 disabled:opacity-60";

  async function handleShare(copyOnly = false) {
    const url = buildShareSearchUrl(window.location.origin, state);
    if (!url) return;
    setBusy(true);
    setFeedback(undefined);
    const copy = navigator.clipboard?.writeText
      ? (value: string) => navigator.clipboard.writeText(value)
      : undefined;
    const result = copyOnly
      ? await copySearchLink(url, copy)
      : await shareSearch(url, {
          share: navigator.share ? (data) => navigator.share(data) : undefined,
          copy,
        });
    setFeedback(result);
    setManualUrl(result === "manual" ? url : undefined);
    setBusy(false);
  }

  return (
    <div className="mt-4 grid min-w-0 gap-2">
      <div className="flex flex-wrap gap-3">
        <button type="button" className={buttonClass} disabled={busy}
          onClick={() => void handleShare()} aria-describedby={`${id}-description`}>
          <Share2 className="h-4 w-4" aria-hidden="true" />
          {busy ? "Sharing…" : "Share search"}
        </button>
        {manualUrl ? (
          <button type="button" className={buttonClass} disabled={busy}
            onClick={() => void handleShare(true)}>Copy link</button>
        ) : null}
      </div>
      <p id={`${id}-description`} className={`text-xs ${fun ? "text-white" : "text-neutral-400"}`}>
        Link reopens this search. Seat availability may change.
      </p>
      <p role="status" aria-live="polite" aria-atomic="true" className="text-sm">
        {feedback === "shared" ? "Search shared."
          : feedback === "copied" ? "Search link copied."
          : feedback === "cancelled" ? "Share cancelled."
          : feedback === "manual" ? "Sharing or copying is unavailable. Select and copy the link below."
          : ""}
      </p>
      {manualUrl ? (
        <label className="grid min-w-0 gap-1 text-sm" htmlFor={`${id}-link`}>
          Search link
          <input id={`${id}-link`} type="text" readOnly value={manualUrl}
            className={`focus-ring min-h-11 w-full min-w-0 px-3 py-2 ${fun ? "border-4 border-white bg-white text-black" : "rounded-md border border-neutral-600 bg-black text-white"}`}
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()} />
        </label>
      ) : null}
    </div>
  );
}
