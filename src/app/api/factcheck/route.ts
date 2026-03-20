import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY 미설정" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { label, narrative, source_url } = await request.json();

    const client = new Anthropic({ apiKey });

    const systemPrompt =
      "당신은 'AI시대 부모를 위한 책' 원고의 팩트체커입니다.\n" +
      "아래 기사 원고를 읽고 사실 여부를 검증하세요.\n" +
      "웹 검색을 활용하여 각 주장을 확인하세요.\n\n" +
      "반드시 아래 형식으로 결과를 정리하세요:\n" +
      "- ✅ 확인됨: (정확한 사실)\n" +
      "- ❌ 오류: (원문) → (수정안)\n" +
      "- ⚠️ 불확실: (확인 불가 내용과 이유)\n" +
      "- 📎 참고 출처: (검증에 사용한 URL)\n\n" +
      "한국어로 작성하세요.";

    const userMsg = `제목: ${label}\n출처: ${source_url}\n\n기사 원고:\n${narrative}`;

    const stream = await client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: systemPrompt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: "web_search_20250305", name: "web_search" } as any],
      messages: [{ role: "user", content: userMsg }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              "delta" in event &&
              event.delta.type === "text_delta"
            ) {
              const text = event.delta.text;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (e) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: String(e) })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    console.error("Factcheck error:", e);
    return new Response(JSON.stringify({ error: "팩트체크 오류" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
