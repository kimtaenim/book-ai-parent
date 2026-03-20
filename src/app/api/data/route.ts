import { NextRequest, NextResponse } from "next/server";
import { getItemByIdx, saveItem, loadPosition, getStats } from "@/lib/redis";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");
  try {
    if (action === "position") {
      const pos = await loadPosition();
      return NextResponse.json(pos);
    }
    if (action === "stats") {
      const stats = await getStats();
      return NextResponse.json(stats);
    }

    const idxParam = req.nextUrl.searchParams.get("idx");

    let pos: { idx: number };
    try {
      pos = await loadPosition();
    } catch (e: any) {
      return NextResponse.json({ error: "loadPosition: " + e.message }, { status: 500 });
    }

    const idx = idxParam !== null ? parseInt(idxParam) : pos.idx;

    let item: any, total: number;
    try {
      const result = await getItemByIdx(idx);
      item = result.item;
      total = result.total;
    } catch (e: any) {
      return NextResponse.json({ error: "getItemByIdx: " + e.message }, { status: 500 });
    }

    let stats: any;
    try {
      stats = await getStats();
    } catch (e: any) {
      return NextResponse.json({ error: "getStats: " + e.message }, { status: 500 });
    }

    return NextResponse.json({ item, idx, total, stats, position: pos });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, entry, reviewIdx } = body;
  try {
    if (action === "save") {
      await saveItem(entry, reviewIdx ?? 0);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
