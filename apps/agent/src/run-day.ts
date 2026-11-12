import { type Day, dayOf } from "./day";
import * as store from "./store";

/**
 * The day a run belongs to: the user's day it started on. Undefined for a consult run, which
 * reads its whole consult, and for no such run.
 */
export function dayOfRun(storage: DurableObjectStorage, runId: string): Day | undefined {
  const setting = store.runSetting(storage, runId);
  if (setting === undefined || setting.thread.askerName !== null) {
    return undefined;
  }
  return dayOf(setting.startedAt, store.userTimeZone(storage));
}
