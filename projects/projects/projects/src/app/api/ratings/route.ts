import { NextResponse } from "next/server";
import { appendRating, ratingScore, readRatings } from "@/lib/store";

/** 从 messages 数组里提取最后一条 user / assistant 内容作为 Q/A */
function extractQA(messages: { role: string; content: string }[] = []): {
  question: string;
  reply: string;
} {
  const userMsgs = messages.filter((m) => m.role === "user");
  const asstMsgs = messages.filter((m) => m.role === "assistant");
  return {
    question: (userMsgs[userMsgs.length - 1]?.content ?? "").slice(0, 300),
    reply: (asstMsgs[asstMsgs.length - 1]?.content ?? "").slice(0, 500),
  };
}

export async function GET() {
  const data = await readRatings();
  // 统一输出 score/question/reply 字段，保证前端渲染不出现空 Q/A
  const ratings = data.ratings.map((r) => {
    const score = ratingScore(r);
    const { question, reply } = extractQA(r.messages);
    return {
      ...r,
      score,
      rating: score,
      question: r.question ?? question,
      reply: r.reply ?? reply,
    };
  });
  return NextResponse.json({ ratings });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      conversationId: string;
      rating?: number;
      score?: number;
      comment?: string;
      messages: { role: string; content: string }[];
    };
    if (!body || !body.conversationId) {
      return NextResponse.json({ error: "参数缺失" }, { status: 400 });
    }
    const score = body.score ?? body.rating;
    if (!score || score < 1 || score > 5) {
      return NextResponse.json({ error: "评分必须是 1-5" }, { status: 400 });
    }
    const { question, reply } = extractQA(body.messages);
    const record = appendRating({
      conversationId: body.conversationId,
      rating: score,
      messages: body.messages ?? [],
    });
    // 追加 question/reply/comment 到写回的记录（appendRating 只写基础字段，这里补充）
    const fs = await import("fs");
    const path = await import("path");
    const file = path.join(process.cwd(), "data", "ratings.json");
    try {
      const raw = fs.readFileSync(file, "utf-8");
      const data = JSON.parse(raw);
      const target = (data.ratings || []).find(
        (x: { id: string }) => x.id === record.id,
      );
      if (target) {
        target.question = question;
        target.reply = reply;
        target.comment = body.comment;
        target.score = score;
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
      }
    } catch {}
    return NextResponse.json({ ok: true, id: record.id });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
