import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk@0.127.0";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * The poet's assistant, and the journal's.
 *
 * One function, several actions, all of them a single Claude call with a
 * JSON schema on the answer. The Anthropic key lives here and never on a
 * phone; a person reaches this only signed in (the gateway checks the
 * JWT), and every call is counted in `ai_usage` under their own id, with
 * a daily cap so one account cannot run up the bill.
 */

const MODEL = "claude-opus-5";
const DAILY_CAP = 80;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `أنت مساعد شاعر عربي متمرّس في الشعر النبطي (الخليجي) والفصيح، وتعمل داخل تطبيق «أوراق» لتدوين المذكرات والقصائد.
قواعدك:
- عند ترتيب نصٍ ملصوق: لا تغيّر كلمات الشاعر ولا تُصلح لغته؛ مهمتك التوزيع فقط: كل بيت صدرٌ وعجز، وحذف الفواصل الزخرفية (نجوم، شرطات، أرقام الأبيات) وتصحيح المسافات والتشكيل الزائد فقط. إن كان النص شعراً حرّاً فاجعل كل سطر «صدراً» واترك العجز فارغاً واختر النوع free.
- استنتج النوع (nabati أو fusha أو free) والبحر أو اللحن إن ظهر لك بثقة (مثل: مسحوب، هجيني، صخري، هلالي، الطويل، الكامل…) وإلا اتركه فارغاً، والغرض (غزل، مدح، رثاء، حكمة، وصف، فخر، هجاء، حماسة…)، وحرف القافية من أواخر الأعجاز.
- عند اقتراح بدائل أو إكمال شطر: التزم بوزن القصيدة وقافيتها وروحها ولهجتها (نبطي أو فصيح)، وقدّم بدائل قصيرة جاهزة للاستعمال مع سبب موجز لكل بديل.
- عند النقد: كن لطيفاً ومحدداً وعملياً، بلا مبالغة في المدح ولا قسوة.
- عند التأمل في المذكرات: اكتب بضمير المخاطب بلغة دافئة موجزة، ولا تخترع أحداثاً لم تُذكر.
- أجب دائماً بالعربية، وبالصيغة المطلوبة فقط.`;

const verseSchema = {
  type: "object",
  properties: { sadr: { type: "string" }, ajuz: { type: "string" } },
  required: ["sadr", "ajuz"],
  additionalProperties: false,
};

const SCHEMAS: Record<string, { schema: Record<string, unknown>; effort: "low" | "medium" | "high"; prompt: (p: Payload) => string }> = {
  arrange: {
    effort: "medium",
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        form: { type: "string", enum: ["nabati", "fusha", "free"] },
        meter: { type: "string" },
        purpose: { type: "string" },
        rhyme: { type: "string" },
        verses: { type: "array", items: verseSchema },
        note: { type: "string" },
      },
      required: ["title", "form", "meter", "purpose", "rhyme", "verses", "note"],
      additionalProperties: false,
    },
    prompt: (p) => `رتّب هذا النص قصيدةً: عنوان (من النص إن وُجد، وإلا عنوان قصير مناسب)، والنوع والبحر والغرض والقافية، والأبيات صدراً وعجزاً بلا تغيير في الكلمات. في note اكتب ملاحظة واحدة قصيرة للشاعر إن كان ثمة ما يستحق (بيت ناقص، شطر مكرر…) وإلا اتركها فارغة.\n\nالنص:\n${p.text ?? ""}`,
  },
  suggest: {
    effort: "high",
    schema: {
      type: "object",
      properties: {
        suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: { sadr: { type: "string" }, ajuz: { type: "string" }, why: { type: "string" } },
            required: ["sadr", "ajuz", "why"],
            additionalProperties: false,
          },
        },
      },
      required: ["suggestions"],
      additionalProperties: false,
    },
    prompt: (p) => `القصيدة كاملة (للوزن والقافية والسياق):\n${poemText(p)}\n\nالبيت رقم ${(p.index ?? 0) + 1} هو:\nالصدر: ${p.sadr ?? ""}\nالعجز: ${p.ajuz ?? ""}\n\n${p.instruction?.trim() ? `طلب الشاعر: ${p.instruction.trim()}\n\n` : ""}${
      !(p.ajuz ?? "").trim() ? "العجز ناقص: اقترح ثلاثة أعجاز تكمل البيت على الوزن والقافية، وأعد الصدر كما هو." : "اقترح ثلاث صياغات بديلة للبيت (يجوز تغيير كلمة أو أكثر في أي شطر) تحافظ على الوزن والقافية والمعنى، مع سبب موجز لكل صياغة."
    }`,
  },
  titles: {
    effort: "low",
    schema: {
      type: "object",
      properties: { titles: { type: "array", items: { type: "string" } } },
      required: ["titles"],
      additionalProperties: false,
    },
    prompt: (p) => `اقترح خمسة عناوين قصيرة (كلمة إلى ثلاث كلمات) لهذه القصيدة، من روحها ومفرداتها:\n${poemText(p)}`,
  },
  critique: {
    effort: "high",
    schema: {
      type: "object",
      properties: {
        overall: { type: "string" },
        strengths: { type: "array", items: { type: "string" } },
        improvements: { type: "array", items: { type: "string" } },
        meter_note: { type: "string" },
      },
      required: ["overall", "strengths", "improvements", "meter_note"],
      additionalProperties: false,
    },
    prompt: (p) => `اقرأ هذه القصيدة قراءة ناقدٍ محبّ: انطباع عام في جملتين، ثلاث نقاط قوة محددة، ثلاثة اقتراحات عملية للتحسين (اذكر رقم البيت)، وملاحظة عن الوزن والقافية (هل ثمة كسر أو إقواء؟ وأين؟).\n\nالعنوان: ${p.title ?? ""}\nالنوع: ${p.form ?? ""} · البحر: ${p.meter ?? ""}\n${poemText(p)}`,
  },
  reflect: {
    effort: "medium",
    schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        themes: { type: "array", items: { type: "string" } },
        mood: { type: "string" },
        highlight: { type: "string" },
        question: { type: "string" },
      },
      required: ["summary", "themes", "mood", "highlight", "question"],
      additionalProperties: false,
    },
    prompt: (p) => `هذه مذكرات الأيام الأخيرة لكاتبها. اكتب له تأملاً قصيراً: ملخص في ثلاث جمل بضمير المخاطب، ثلاثة موضوعات تكررت، وصف موجز للمزاج العام، أجمل لحظة أو جملة ذكرها (اقتبسها بحروفها)، وسؤال واحد لطيف يفتح له باب الكتابة الليلة.\n\n${p.text ?? ""}`,
  },
};

interface Payload {
  action: string;
  text?: string;
  title?: string;
  form?: string;
  meter?: string;
  verses?: { sadr: string; ajuz: string }[];
  index?: number;
  sadr?: string;
  ajuz?: string;
  instruction?: string;
}

function poemText(p: Payload): string {
  return (p.verses ?? []).map((v, i) => `${i + 1}. ${v.sadr}${v.ajuz ? ` ✦ ${v.ajuz}` : ""}`).join("\n");
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method" });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json(503, { error: "not-configured" });

  const authorization = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return json(401, { error: "unauthorized" });

  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return json(400, { error: "bad-json" });
  }
  const action = SCHEMAS[payload.action];
  if (!action) return json(400, { error: "unknown-action" });

  // The daily cap, counted from the person's own rows.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase.from("ai_usage").select("id", { count: "exact", head: true }).gte("created_at", since);
  if ((count ?? 0) >= DAILY_CAP) return json(429, { error: "daily-cap", cap: DAILY_CAP });

  const client = new Anthropic({ apiKey });
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: action.prompt(payload) }],
      output_config: { effort: action.effort, format: { type: "json_schema", schema: action.schema } },
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json(429, { error: "busy" });
    if (error instanceof Anthropic.AuthenticationError) return json(503, { error: "not-configured" });
    if (error instanceof Anthropic.APIError) return json(502, { error: "upstream", status: error.status, message: error.message });
    return json(502, { error: "upstream", message: String(error) });
  }

  if (response.stop_reason === "refusal") return json(422, { error: "refused" });
  const text = response.content.find((block) => block.type === "text")?.text ?? "";
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    return json(502, { error: "unparseable" });
  }

  await supabase.from("ai_usage").insert({
    user_id: user.id,
    action: payload.action,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  });

  return json(200, { result, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } });
});
