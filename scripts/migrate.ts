/**
 * Gist → Upstash Redis 1회 마이그레이션 (book-ai-parent)
 * 사용법: npx tsx scripts/migrate.ts
 * 필요 환경변수: GITHUB_TOKEN, GIST_ID, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 *
 * book-reviewer의 Gist에 저장된 current.json (flat list)을 읽어
 * 개별 항목으로 Redis에 저장한다.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import { Redis } from "@upstash/redis";

const GIST_ID = process.env.GIST_ID!;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const headers = {
  Authorization: `token ${GITHUB_TOKEN}`,
  Accept: "application/vnd.github.v3+json",
};

interface GistFile {
  content?: string;
  truncated?: boolean;
  raw_url?: string;
}

async function fetchGistFiles(): Promise<Record<string, string>> {
  const resp = await fetch(`https://api.github.com/gists/${GIST_ID}`, { headers });
  if (!resp.ok) throw new Error(`Gist fetch failed: ${resp.status}`);
  const data = await resp.json();
  const files: Record<string, string> = {};

  for (const [name, info] of Object.entries<GistFile>(data.files)) {
    if (info.truncated && info.raw_url) {
      const raw = await fetch(info.raw_url, { headers });
      if (!raw.ok) throw new Error(`Raw fetch failed: ${name}`);
      files[name] = await raw.text();
    } else {
      files[name] = info.content || "";
    }
  }
  return files;
}

async function main() {
  console.log("1/3  Gist에서 데이터 읽는 중...");
  const files = await fetchGistFiles();

  // Parse base data (already flat list)
  const data: any[] = JSON.parse(files["current.json"]);
  let partNum = 2;
  while (files[`current_part${partNum}.json`]) {
    data.push(...JSON.parse(files[`current_part${partNum}.json`]));
    partNum++;
  }

  // Assign IDs if missing, normalize fields
  for (let i = 0; i < data.length; i++) {
    const entry = data[i];
    if (!entry.id) {
      entry.id = `aip-${String(i).padStart(4, "0")}`;
    }
    entry.global_idx = entry.global_idx ?? i;
    if (!entry.status) entry.status = "pending";
    // Ensure array fields
    if (!Array.isArray(entry.expert_reactions)) entry.expert_reactions = [];
    if (!Array.isArray(entry.related_cases)) entry.related_cases = [];
  }

  console.log(`   항목 수: ${data.length}`);

  // Upload in chunks of 500
  console.log("2/3  Redis에 업로드 중...");
  const CHUNK_SIZE = 500;
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.slice(i, i + CHUNK_SIZE);
    const pipeline = redis.pipeline();
    for (const entry of chunk) {
      pipeline.set(`qa:${entry.id}`, entry);
    }
    await pipeline.exec();
    console.log(`   chunk ${Math.floor(i / CHUNK_SIZE)}: ${chunk.length}개 업로드`);
  }

  // Save ids list
  const ids = data.map((e) => e.id);
  await redis.set("qa:ids", ids);

  // Position
  let position = { idx: 0 };
  if (files["position.json"]) {
    try {
      const p = JSON.parse(files["position.json"]);
      position = { idx: p.idx ?? 0 };
    } catch { /* ignore */ }
  }
  await redis.set("qa:position", position);

  // Stats
  const edited = data.filter((e) => e.status === "edited").length;
  const updated = data.filter((e) => e.status === "updated").length;
  const pending = data.length - edited - updated;
  const stats = { total: data.length, edited, pending, updated };
  await redis.set("qa:stats", stats);

  console.log("3/3  완료!");
  console.log(`   ${data.length}개 항목, position idx=${position.idx}`);
  console.log(`   stats: ${JSON.stringify(stats)}`);
}

main().catch((e) => {
  console.error("마이그레이션 실패:", e);
  process.exit(1);
});
