import { HttpApi } from "./http";
import { OfflineApi } from "./offline";
import type { ServerApi } from "./types";

export * from "./types";
export { resetOfflineState } from "./offline";

export const IS_OFFLINE = process.env.NEXT_PUBLIC_OFFLINE_MODE === "true";

let singleton: ServerApi | null = null;

export function getApi(): ServerApi {
  if (!singleton) {
    singleton = IS_OFFLINE ? new OfflineApi() : new HttpApi();
  }
  return singleton;
}
