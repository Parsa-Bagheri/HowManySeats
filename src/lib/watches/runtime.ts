import { resolve } from "node:path";
import { CineplexClient } from "../cineplex-client";
import { fixtureScreening } from "./fixtures";
import { WatchError } from "./model";
import { WatchService } from "./service";

export async function watchRuntime() {
  if (process.env.WATCH_BACKEND === "aws") {
    const { awsRuntime } = await import("./aws");
    return awsRuntime();
  }
  if (process.env.WATCH_BACKEND !== "local") throw new WatchError(503, "Background watches are not enabled on this server.");
  const { LocalStore } = await import("./local");
  // The local adapter belongs on a persistent local host, never a serverless temporary filesystem.
  const store = new LocalStore(resolve(process.env.WATCH_DB_PATH ?? ".watch-data/watches.sqlite"));
  return { service: new WatchService(store, store), close: () => store.close() };
}

export async function resolveScreening(theatreId: string, showtimeId: string) {
  if (process.env.WATCH_MODE === "fixture") {
    if (theatreId !== "7402" || !/^90000[1-5]$/.test(showtimeId)) throw new WatchError(400, "Choose one of the demo screenings.");
    return fixtureScreening(showtimeId);
  }
  const screening = await new CineplexClient().resolveScreening(theatreId, showtimeId);
  if (!screening) throw new WatchError(404, "Cineplex did not confirm this screening.");
  return screening;
}
