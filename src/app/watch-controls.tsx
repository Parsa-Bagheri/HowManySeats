"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { SearchCandidate } from "@/lib/types";
import type { Watch } from "@/lib/watches/model";

const STORAGE_KEY = "howmanyseats:watches:v1";
type WatchView = Watch & { state: string; fixture: boolean };
type Context = { enabled: boolean; fixture: boolean; accepting: boolean; endDate: string | null; ids: string[]; add: (theatreId: string, showtimeId: string) => Promise<void>; remove: (id: string) => void };
const WatchContext = createContext<Context | null>(null);
export function WatchProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);
  const [configuration, setConfiguration] = useState({ enabled: false, fixture: false, accepting: false, endDate: null as string | null });
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      if (Array.isArray(saved)) setIds(saved.filter((id): id is string => typeof id === "string" && /^cineplex-\d{1,10}-\d{1,20}$/.test(id)).slice(0, 10));
    } catch { /* A blocked/corrupt browser store does not prevent using this page. */ }
    const controller = new AbortController();
    fetch("/api/watches?status=1", { signal: controller.signal }).then((response) => response.ok ? response.json() : Promise.reject(new Error("Watch service unavailable"))).then(setConfiguration).catch(() => {});
    return () => controller.abort();
  }, []);
  const save = useCallback((change: (current: string[]) => string[]) => {
    setIds((current) => {
      const next = change(current);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Keep session favorites when persistence is unavailable. */ }
      return next;
    });
  }, []);
  const add = useCallback(async (theatreId: string, showtimeId: string) => {
    const id = `cineplex-${theatreId}-${showtimeId}`;
    if (ids.length >= 10 && !ids.includes(id)) throw new Error("This browser can save up to ten watches. Remove a favorite first.");
    const response = await fetch("/api/watches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theatreId, showtimeId }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not watch this screening.");
    save((current) => current.includes(id) ? current : [...current, id].slice(0, 10));
  }, [ids, save]);
  const remove = useCallback((id: string) => save((current) => current.filter((entry) => entry !== id)), [save]);
  return <WatchContext.Provider value={{ ...configuration, ids, add, remove }}>{children}</WatchContext.Provider>;
}

export function WatchAction({ screening, fun = false }: { screening: SearchCandidate; fun?: boolean }) {
  const context = useContext(WatchContext);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (!context?.enabled || screening.theatre.provider !== "cineplex") return null;
  const saved = context.ids.includes(screening.showtime.id);
  return <div className={`mt-3 text-sm ${fun ? "font-bold text-black" : "text-neutral-100"}`}>
    {saved ? <a className="focus-ring underline" href="/watches">View watched screening</a> : <button className={`focus-ring min-h-11 rounded border px-3 py-2 ${fun ? "border-black bg-[#00e676]" : "border-neutral-600"}`} disabled={pending || !context.accepting} onClick={async () => {
      setPending(true); setError("");
      try { await context.add(screening.theatre.providerTheatreId, screening.showtime.providerShowtimeId); }
      catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save this watch."); }
      finally { setPending(false); }
    }}>{pending ? "Saving watch…" : !context.accepting ? "Collection paused" : "Watch availability"}</button>}
    {error ? <p role="alert" className="mt-2">{error}</p> : null}
  </div>;
}

export function WatchNavigation() {
  const context = useContext(WatchContext);
  return context?.enabled ? <nav aria-label="Screening watches" className="bg-neutral-950 px-4 py-3 text-center text-sm text-white"><a className="focus-ring underline" href="/watches">Watched screenings ({context.ids.length})</a></nav> : null;
}

export function WatchList() {
  const context = useContext(WatchContext)!;
  const [watches, setWatches] = useState<WatchView[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const idKey = context.ids.join(",");
  useEffect(() => {
    if (!idKey) { setWatches([]); setLoaded(true); return; }
    const controller = new AbortController();
    async function refresh() {
      try {
        const params = new URLSearchParams(idKey.split(",").map((id) => ["id", id]));
        const response = await fetch(`/api/watches?${params}`, { signal: controller.signal, cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load watches.");
        setWatches(body.watches); setError(""); setLoaded(true);
      } catch (failure) {
        if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : "Could not load watches."); setLoaded(true); }
      }
    }
    void refresh(); const timer = setInterval(() => void refresh(), 15_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [idKey]);
  return <main className="mx-auto max-w-5xl px-4 py-8 text-neutral-100">
    <a href="/" className="focus-ring underline">Back to search</a>
    <h1 className="mt-6 text-3xl font-semibold">Watched screenings</h1>
    <p className="mt-3 text-neutral-300">While collection is operating, Cineplex observations refresh about every five minutes until the screening starts, for up to 48 hours. Numbers describe a past observation and can change. Favorites are saved in this browser.</p>
    {context.fixture ? <section className="mt-5 rounded-lg border border-amber-400 p-4"><h2 className="font-semibold">Fixture demo</h2><p className="mt-1 text-sm">Synthetic observations; no cinema requests are made.</p><div className="mt-3 flex flex-wrap gap-3">{[["900001", "Healthy screening"], ["900002", "Partial data"], ["900003", "Timeout"], ["900005", "Malformed data"]].map(([id, label]) => <button key={id} disabled={saving} className="focus-ring min-h-11 rounded border border-neutral-600 px-3" onClick={async () => { setSaving(true); try { await context.add("7402", id); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not add demo."); } finally { setSaving(false); } }}>{label}</button>)}</div></section> : null}
    {context.endDate ? <p className="mt-3 text-neutral-300">This collection window ends {new Date(context.endDate).toLocaleString()}.</p> : null}
    {context.enabled && !context.accepting ? <p role="status" className="mt-3">Background collection is paused or its operating window has ended. Retained observations remain available.</p> : null}
    {!context.enabled ? <p className="mt-6">Background watches are not enabled on this server.</p> : null}
    {error ? <p role="alert" className="mt-5 rounded border border-red-400 p-3">{error} Displayed observations may be stale.</p> : null}
    {!loaded ? <p role="status" className="mt-6">Loading favorites…</p> : null}
    {loaded && !context.ids.length ? <p className="mt-6">Choose “Watch availability” on a Cineplex search result to save your first screening.</p> : null}
    {context.ids.filter((id) => loaded && !watches.some((watch) => watch.id === id)).map((id) => <div key={id} className="mt-5 border border-neutral-600 p-4"><p>This favorite has no retained watch data. Search again to register it.</p><button className="focus-ring mt-2 underline" onClick={() => context.remove(id)}>Remove {id}</button></div>)}
    {watches.map((watch) => <WatchHistory key={watch.id} watch={watch} remove={() => context.remove(watch.id)} />)}
  </main>;
}

function WatchHistory({ watch, remove }: { watch: WatchView; remove: () => void }) {
  const latest = watch.latest;
  const failure = watch.lastFailure;
  const unresolvedFailure = ["stale", "unavailable"].includes(watch.state) && failure && (!latest || failure.scheduledAt > latest.scheduledAt || (failure.scheduledAt === latest.scheduledAt && failure.at > latest.storedAt));
  return <article className="mt-6 rounded-lg border border-neutral-700 bg-neutral-900 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{watch.screening.theatre.name}</h2><p className="mt-1 font-semibold">{watch.screening.showtime.movieTitle}</p><p className="mt-1 text-sm">{new Date(watch.screening.showtime.startsAt).toLocaleString()}</p></div><button className="focus-ring min-h-11 underline" onClick={remove}>Remove favorite</button></div>
    <p className={`mt-4 font-semibold ${["stale", "unavailable", "partial"].includes(watch.state) ? "text-amber-300" : "text-emerald-300"}`} role="status">{watch.state.charAt(0).toUpperCase() + watch.state.slice(1)}{watch.fixture ? " · fixture" : ""}</p>
    {latest ? <p className="mt-2">{latest.seats.occupiedEstimate} occupied / {latest.seats.sellableSeats} standard seats · observed {new Date(latest.observedAt).toLocaleString()}</p> : <p className="mt-2">No seat observation is available yet. Missing data does not mean an empty screening.</p>}
    {watch.state === "partial" ? <p className="mt-2 text-amber-200">Some seat statuses are unknown; the known counts may be incomplete.</p> : null}
    {unresolvedFailure && failure ? <p className="mt-2 text-amber-200">{failure.message} {failure.terminal ? "This refresh stopped after its retry limit or a terminal provider error." : "The service will retry."}</p> : null}
    <p className="mt-2 text-sm text-neutral-400">Removing a favorite affects this browser. Shared refreshes end at {new Date(watch.expiresAt).toLocaleString()}.</p>
    <details className="mt-4" open><summary className="focus-ring cursor-pointer font-semibold">Observation history ({watch.history.length})</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Timestamped seat counts with separate accessibility categories</caption><thead><tr>{["Observed", "Standard occupied / total", "Accessible occupied / total", "Companion occupied / total", "Unknown", "Excluded", "Stored"].map((label) => <th key={label} scope="col" className="whitespace-nowrap p-2">{label}</th>)}</tr></thead><tbody>{watch.history.map((item) => <tr key={item.jobKey} className="border-t border-neutral-700"><td className="whitespace-nowrap p-2">{new Date(item.observedAt).toLocaleTimeString()}</td><td className="p-2">{item.seats.occupiedEstimate} / {item.seats.sellableSeats}</td><td className="p-2">{item.seats.occupiedAccessibleSeats} / {item.seats.accessibleSeats}</td><td className="p-2">{item.seats.occupiedCompanionSeats} / {item.seats.companionSeats}</td><td className="p-2">{item.seats.unknownSeats}</td><td className="p-2">{item.seats.excludedSeats}</td><td className="whitespace-nowrap p-2">{new Date(item.storedAt).toLocaleTimeString()}</td></tr>)}</tbody></table></div></details>
    {watch.failures.length ? <details className="mt-4"><summary className="focus-ring cursor-pointer">Refresh failures ({watch.failures.length})</summary><ul className="mt-2 space-y-2 text-sm">{watch.failures.map((failure, index) => <li key={`${failure.jobKey}:${index}`}>{new Date(failure.at).toLocaleString()} · {failure.code} · {failure.terminal ? "terminal" : "retry scheduled"} · {failure.message}</li>)}</ul></details> : null}
  </article>;
}
