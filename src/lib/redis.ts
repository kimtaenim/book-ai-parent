import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  automaticDeserialization: true,
  enableAutoPipelining: false,
});

/** Load a single QA entry by index. */
export async function getItemByIdx(idx: number): Promise<{
  item: any | null;
  total: number;
}> {
  const ids: string[] | null = await redis.get("qa:ids");
  if (!ids || ids.length === 0) return { item: null, total: 0 };

  const safeIdx = Math.max(0, Math.min(idx, ids.length - 1));
  const item: any = await redis.get(`qa:${ids[safeIdx]}`);
  if (item && !item.status) item.status = "pending";
  return { item, total: ids.length };
}

/** Save a single edited entry + incrementally update stats. */
export async function saveItem(
  entry: { id: string; [key: string]: any },
  reviewIdx: number
): Promise<void> {
  // Read old item to get previous status
  const oldItem: any = await redis.get(`qa:${entry.id}`);
  const oldStatus = oldItem?.status || "pending";
  const newStatus = entry.status || "pending";

  const pipeline = redis.pipeline();
  pipeline.set(`qa:${entry.id}`, entry);
  pipeline.set("qa:position", { idx: reviewIdx });
  await pipeline.exec();

  // Increment stats only if status changed
  if (oldStatus !== newStatus) {
    const stats = await getStats();
    const key = (s: string) =>
      s === "edited" ? "edited" : s === "updated" ? "updated" : "pending";
    const oldKey = key(oldStatus);
    const newKey = key(newStatus);
    (stats as any)[oldKey] = Math.max(0, (stats as any)[oldKey] - 1);
    (stats as any)[newKey] = (stats as any)[newKey] + 1;
    await redis.set("qa:stats", stats);
  }
}

/** Load position. */
export async function loadPosition(): Promise<{ idx: number }> {
  const pos: { idx: number } | null = await redis.get("qa:position");
  return pos ?? { idx: 0 };
}

/** Load stats. */
export async function getStats(): Promise<{
  total: number;
  edited: number;
  pending: number;
  updated: number;
}> {
  const stats = await redis.get("qa:stats");
  if (stats) return stats as any;
  // No full scan fallback — return defaults
  const ids: string[] | null = await redis.get("qa:ids");
  const total = ids?.length ?? 0;
  const defaults = { total, edited: 0, pending: total, updated: 0 };
  await redis.set("qa:stats", defaults);
  return defaults;
}
