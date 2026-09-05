import { getAppTimezone } from "@/lib/env";
import { dueImportSourceIds, syncImportSource, updateWorkerHeartbeat } from "@/lib/online-import-service";

const schedule = process.env.IMPORT_SYNC_TIME?.trim() || "04:15";
if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule)) {
  throw new Error("IMPORT_SYNC_TIME muss HH:MM enthalten.");
}

const [scheduledHour, scheduledMinute] = schedule.split(":").map(Number);
const timeZone = getAppTimezone();
let stopping = false;

function zonedNow(date = new Date()): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, hour: Number(values.hour), minute: Number(values.minute) };
}

async function tick(): Promise<void> {
  let heartbeatError: string | null = null;
  try {
    const now = zonedNow();
    if (now.hour > scheduledHour || now.hour === scheduledHour && now.minute >= scheduledMinute) {
      const sourceIds = await dueImportSourceIds(now.date);
      for (const sourceId of sourceIds) {
        if (stopping) break;
        try {
          await syncImportSource(sourceId, "scheduled", now.date);
        } catch (error) {
          heartbeatError = error instanceof Error ? error.message : "Unbekannter Synchronisierungsfehler";
          console.error(`[import-worker] ${sourceId}: ${heartbeatError}`);
        }
      }
    }
  } catch (error) {
    heartbeatError = error instanceof Error ? error.message : "Unbekannter Workerfehler";
    console.error(`[import-worker] ${heartbeatError}`);
  }
  await updateWorkerHeartbeat(heartbeatError).catch((error) => console.error("[import-worker] Heartbeat:", error));
}

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

console.log(`[import-worker] tägliche Synchronisierung um ${schedule} (${timeZone})`);
while (!stopping) {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 60_000));
}
process.exit(0);
