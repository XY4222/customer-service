import { NextRequest } from "next/server";
import { getSkill } from "@/lib/skills-registry";
import { callLLM } from "@/lib/llm";

export const runtime = "nodejs";

function buildInputString(input: Record<string, unknown>): string {
  return Object.entries(input)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`)
    .join("\n");
}

/**
 * 单 Skill 测试 API（SSE 流式）
 *
 * 约定：
 *   1. 以 SSE 协议返回（Content-Type: text/event-stream）；
 *   2. 事件类型：chunk（流式文本增量） / done（终态含 output） / error（错误）；
 *   3. 若客户端传入 question 则直接作为用户 Prompt，否则把 input 字段序列化为键值对。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as {
    input?: Record<string, unknown>;
    question?: string;
    stream?: boolean;
  };
  const skill = getSkill(id);
  if (!skill) {
    return new Response(
      `event: error\ndata: ${JSON.stringify({ error: "skill not found" })}\n\n`,
      { status: 404, headers: { "Content-Type": "text/event-stream; charset=utf-8" } }
    );
  }

  const userPrompt = body.question ?? buildInputString(body.input ?? {});
  const start = Date.now();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (type: string, payload: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`)
        );
      };
      try {
        // 统一走流式接口；若 provider 不支持流式则 callLLMStream 内部回退到一次性返回
        const expectJson = id !== "response-generator";
        const streamOrText = await callLLM(
          {
            model: skill.model,
            temperature: skill.temperature,
            maxTokens: skill.maxTokens,
            systemPrompt: skill.body,
            userPrompt,
            jsonMode: expectJson,
          },
          request
        );

        let raw = "";
        // callLLM 对 coze/openai-compatible 返回 string；为了兼容未来 streaming，支持 AsyncIterable
        if (
          streamOrText &&
          typeof streamOrText === "object" &&
          Symbol.asyncIterator in (streamOrText as any)
        ) {
          for await (const chunk of streamOrText as any) {
            const piece = typeof chunk === "string" ? chunk : (chunk?.delta ?? chunk?.content ?? "");
            if (piece) {
              raw += piece;
              send("chunk", { content: piece });
            }
          }
        } else {
          raw = String(streamOrText ?? "");
          // 一次性返回：逐字符切分模拟打字机，让前端有流式视觉反馈
          const chars = Array.from(raw);
          const CHUNK = 4;
          for (let i = 0; i < chars.length; i += CHUNK) {
            const piece = chars.slice(i, i + CHUNK).join("");
            send("chunk", { content: piece });
            await new Promise((r) => setTimeout(r, 6));
          }
        }

        // 解析 JSON（非 response-generator 都尝试解析）
        let output: unknown = raw;
        if (id !== "response-generator") {
          try {
            output = JSON.parse(raw);
          } catch {
            const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (m) {
              try { output = JSON.parse(m[1].trim()); } catch { output = { raw }; }
            } else {
              const fb = raw.match(/\{[\s\S]*\}/);
              if (fb) { try { output = JSON.parse(fb[0]); } catch { output = { raw }; } }
            }
          }
        }

        send("done", {
          output,
          raw,
          durationMs: Date.now() - start,
          model: skill.model,
        });
        controller.close();
      } catch (err: any) {
        send("error", {
          error: err?.message ?? String(err),
          durationMs: Date.now() - start,
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
