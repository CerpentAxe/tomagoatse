import "dotenv/config";
import { InferenceClient } from "@huggingface/inference";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const HF_API_KEY = process.env.HF_API_KEY;
/**
 * Chat model for Inference Providers. If you omit `:fastest` / `:cheapest` / `:provider`,
 * we append `:fastest` so the router can pick a backend (raw `org/model` often returns 400).
 */
const HF_TEXT_MODEL =
  process.env.HF_TEXT_MODEL || "Qwen/Qwen2.5-7B-Instruct:fastest";
const HF_IMAGE_MODEL =
  process.env.HF_IMAGE_MODEL || "stabilityai/stable-diffusion-xl-base-1.0";
/** Comma-separated chat models to try after the primary fails (optional). */
const HF_TEXT_MODEL_FALLBACKS = process.env.HF_TEXT_MODEL_FALLBACKS;

const hfClient = HF_API_KEY ? new InferenceClient(HF_API_KEY) : null;

/** Append `:fastest` when the id has no routing suffix (`namespace/model:policy`). */
function withInferenceRoutingPolicy(modelId) {
  if (!modelId || typeof modelId !== "string") return modelId;
  const m = modelId.trim();
  if (m.startsWith("http://") || m.startsWith("https://")) return m;
  const slash = m.indexOf("/");
  if (slash === -1) return m;
  const tail = m.slice(slash + 1);
  if (tail.includes(":")) return m;
  return `${m}:fastest`;
}

function chatModelCandidates() {
  const primary = withInferenceRoutingPolicy(HF_TEXT_MODEL);
  const userExtra = (HF_TEXT_MODEL_FALLBACKS || "")
    .split(",")
    .map((s) => withInferenceRoutingPolicy(s.trim()))
    .filter(Boolean);
  const builtIns = [
    "Qwen/Qwen2.5-7B-Instruct:fastest",
    "meta-llama/Llama-3.2-3B-Instruct:fastest",
    "openai/gpt-oss-120b:fastest",
  ];
  const out = [];
  for (const id of [primary, ...userExtra, ...builtIns]) {
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

async function chatCompletionWithFallbacks(hf, userPrompt) {
  const models = chatModelCandidates();
  let lastErr;
  for (const model of models) {
    try {
      return await hf.chatCompletion({
        model,
        messages: [{ role: "user", content: userPrompt }],
        max_tokens: 1024,
        temperature: 0.75,
      });
    } catch (e) {
      lastErr = e;
      const detail = e?.httpResponse?.body;
      console.warn(`[HF chat] ${model} failed:`, detail ?? e?.message ?? e);
    }
  }
  throw lastErr;
}

function formatProviderError(err) {
  const base = err?.message || "Unknown error";
  const body = err?.httpResponse?.body;
  if (body == null) return base;
  try {
    const extra = typeof body === "string" ? body : JSON.stringify(body);
    return `${base} — ${extra}`.slice(0, 1200);
  } catch {
    return base;
  }
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function sanitizeUserBits(str, max = 400) {
  if (str == null || str === "") return "";
  return String(str)
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .slice(0, max);
}

/** Irrelevant unless the player types this exact string (trimmed). */
const EASTER_EGG_HIGH_SCHOOL = "North Seabury Prep";

function buildCharacterPrompt(body) {
  const name = sanitizeUserBits(body.name, 120);
  const creatureType = sanitizeUserBits(body.creatureType);
  const gender = sanitizeUserBits(body.gender, 80);
  const colours = sanitizeUserBits(body.colours);
  const favouriteSong = sanitizeUserBits(body.favouriteSong);
  const placeOfBirth = sanitizeUserBits(body.placeOfBirth);
  const myersBriggs = sanitizeUserBits(body.myersBriggs, 40);
  const favouriteFood = sanitizeUserBits(body.favouriteFood);
  const sillyProp = sanitizeUserBits(body.sillyProp);
  const highSchool = sanitizeUserBits(body.highSchool);

  const genderNote =
    gender === "MM"
      ? "Gender note: MM (playful science nod — extra chromosome); reflect kindly in personality blurbs only, not as mockery."
      : `Gender: ${gender || "unspecified"}.`;

  const egg =
    highSchool && highSchool.trim() === EASTER_EGG_HIGH_SCHOOL
      ? `Easter egg: they guessed the irrelevant high school (${EASTER_EGG_HIGH_SCHOOL}). Add one subtle, kind wink in the oneLiner only.`
      : "High school is irrelevant — do not congratulate or reference guessing games unless the easter egg above applies.";

  return `You are a creative writer for wholly ORIGINAL whimsical creatures in the spirit of playful rhyming picture books and pocket virtual pets — NOT Dr. Seuss, NOT Tamagotchi, no trademarked names, no distinctive character copies, no recognizable style imitation of any single work. Invent fresh nonsense words sparingly.

User inputs:
- Name (use in output): ${name || "Unnamed"}
- Creature type: ${creatureType || "abstract whimsy"}
- ${genderNote}
- Colour direction (gentle, not garish): ${colours || "soft palette"}
- Favourite song (influences temperament / "anger" tendency in backstory only): ${favouriteSong || "none given"}
- Place of birth (nudge empathy / warmth in backstory): ${placeOfBirth || "unknown"}
- Myers-Briggs they claim (for humor: personality often leans opposite or sideways): ${myersBriggs || "not given"}
- Favourite food (if oddly suggestive, bump outward social energy in backstory): ${favouriteFood || "not given"}
- Silly prop (if blank, neutrality for agreeableness tone): ${sillyProp || "(blank)"}
- High school: ${highSchool || "not given"}
- ${egg}

Return ONLY valid minified JSON with this exact shape (numbers 1-100 inclusive):
{
  "displayName": string,
  "oneLiner": string,
  "personalityParagraph": string,
  "imagePrompt": string,
  "empathy": number,
  "society": number,
  "informationProcessing": number,
  "decisionMaking": number,
  "approach": number
}

Where:
- society: 1 = very reserved/solo, 100 = very outgoing/social
- informationProcessing: 1 = concrete/sensing flavor, 100 = imaginative/intuition flavor
- decisionMaking: 1 = analytical head-first, 100 = heart-first/harmony
- approach: 1 = structured/planned, 100 = spontaneous/go-with-flow
- imagePrompt: a single English prompt for a text-to-image model: full-body original character, plain backdrop, children's-book illustration energy, bold friendly shapes, NO text in image, NO logos, NOT Dr Seuss, NOT any existing character`;

}

function extractAssistantJson(raw) {
  let text = "";
  if (typeof raw === "string") text = raw;
  else if (Array.isArray(raw) && raw[0]?.generated_text)
    text = raw[0].generated_text;
  else if (raw?.generated_text) text = raw.generated_text;
  else if (Array.isArray(raw) && raw[0]?.summary_text)
    text = raw[0].summary_text;
  else text = JSON.stringify(raw);

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) text = text.slice(start, end + 1);

  return JSON.parse(text);
}

function clampMeter(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 50;
  return Math.max(1, Math.min(100, Math.round(x)));
}

const CARE_ACTIONS = new Set(["feed", "discipline", "encourage"]);

function buildMeterAdjustPrompt(body) {
  const action = String(body.action || "").toLowerCase();
  const displayName = sanitizeUserBits(body.displayName, 120);
  const creatureType = sanitizeUserBits(body.creatureType, 200);
  const favouriteFood = sanitizeUserBits(body.favouriteFood, 200);
  const meters = body.meters && typeof body.meters === "object" ? body.meters : {};
  const fixedMeters =
    body.fixedMeters && typeof body.fixedMeters === "object"
      ? body.fixedMeters
      : {};

  const current = {
    empathy: clampMeter(meters.empathy),
    society: clampMeter(meters.society),
    informationProcessing: clampMeter(meters.informationProcessing),
    decisionMaking: clampMeter(meters.decisionMaking),
    approach: clampMeter(meters.approach),
    energy: clampMeter(fixedMeters.energy),
    hunger: clampMeter(fixedMeters.hunger),
    cleanliness: clampMeter(fixedMeters.cleanliness),
  };

  const actionNarrative =
    action === "feed"
      ? `FEED — the owner offered this favourite food: "${favouriteFood || "a treat"}". Expect hunger to improve; energy and mood often rise slightly.`
      : action === "discipline"
        ? `DISCIPLINE — firm correction or boundaries. May sharpen structure (approach toward planning), can ding empathy or society briefly, might affect cleanliness or energy.`
        : `ENCOURAGE — warm praise and support. Tend to raise empathy, society, and energy; may soften harsh edges on decision-making toward harmony.`;

  return `You are the game engine for a whimsical virtual pet named "${displayName || "pet"}" (creature type: ${creatureType || "unknown"}).

The owner chose ONE caretaking action. Interpret how it would realistically shift the pet's stats.

Action:
${actionNarrative}

Current stats (integers 1-100): ${JSON.stringify(current)}

Rules:
- Output NEW absolute values (not deltas), each 1-100 inclusive.
- Base changes on the action: Feed nourishes; Discipline is stern and structuring; Encourage is affectionate and uplifting.
- Adjust personality axes coherently (empathy, society, informationProcessing, decisionMaking, approach) plus vitals (energy, hunger, cleanliness).

Return ONLY valid minified JSON with exactly these keys:
{"empathy":number,"society":number,"informationProcessing":number,"decisionMaking":number,"approach":number,"energy":number,"hunger":number,"cleanliness":number}`;
}

app.post("/api/adjust-meters", async (req, res) => {
  if (!HF_API_KEY || HF_API_KEY === "hf_your_token_here") {
    return res.status(500).json({
      error: "missing_api_key",
      message: "Set HF_API_KEY in .env (see .env.example).",
    });
  }

  const action = String(req.body?.action || "").toLowerCase();
  if (!CARE_ACTIONS.has(action)) {
    return res.status(400).json({
      error: "invalid_action",
      message: "action must be feed, discipline, or encourage",
    });
  }

  try {
    const userPrompt = buildMeterAdjustPrompt({ ...req.body, action });

    let parsed;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const completion = await chatCompletionWithFallbacks(
          hfClient,
          userPrompt
        );
        const content = completion?.choices?.[0]?.message?.content ?? "";
        parsed = extractAssistantJson(content);
        break;
      } catch (e) {
        if (e instanceof SyntaxError && attempt < 2) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        throw e;
      }
    }

    const meters = {
      empathy: clampMeter(parsed.empathy),
      society: clampMeter(parsed.society),
      informationProcessing: clampMeter(parsed.informationProcessing),
      decisionMaking: clampMeter(parsed.decisionMaking),
      approach: clampMeter(parsed.approach),
    };
    const fixedMeters = {
      energy: clampMeter(parsed.energy),
      hunger: clampMeter(parsed.hunger),
      cleanliness: clampMeter(parsed.cleanliness),
    };

    return res.json({ meters, fixedMeters });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "meter_adjust_failed",
      message: formatProviderError(err),
    });
  }
});

app.post("/api/generate", async (req, res) => {
  if (!HF_API_KEY || HF_API_KEY === "hf_your_token_here") {
    return res.status(500).json({
      error: "missing_api_key",
      message: "Set HF_API_KEY in .env (see .env.example).",
    });
  }

  try {
    const userPrompt = buildCharacterPrompt(req.body || {});

    let parsed;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const completion = await chatCompletionWithFallbacks(
          hfClient,
          userPrompt
        );
        const content = completion?.choices?.[0]?.message?.content ?? "";
        parsed = extractAssistantJson(content);
        break;
      } catch (e) {
        if (e instanceof SyntaxError && attempt < 2) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        throw e;
      }
    }

    const displayName = String(parsed.displayName || req.body.name || "Little one").slice(0, 80);
    const oneLiner = String(parsed.oneLiner || "A brand-new face in the nursery of stars.").slice(0, 280);
    const personalityParagraph = String(
      parsed.personalityParagraph || "They hum small songs only snails can hear."
    ).slice(0, 1200);

    const imagePrompt = String(
      parsed.imagePrompt ||
        `Friendly original whimsical creature, full body, soft storybook illustration, white background, no text`
    ).slice(0, 1500);

    let imageBuffer;
    let imageMime = "image/png";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const blob = await hfClient.textToImage({
          model: HF_IMAGE_MODEL,
          inputs: imagePrompt,
          parameters: {
            negative_prompt:
              "text, watermark, signature, logo, blurry, deformed, ugly",
          },
        });
        const ab = await blob.arrayBuffer();
        imageBuffer = Buffer.from(ab);
        imageMime =
          blob.type && blob.type.startsWith("image/") ? blob.type : "image/png";
        break;
      } catch (e) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 8000));
          continue;
        }
        throw e;
      }
    }

    const imageBase64 = imageBuffer.toString("base64");

    const meters = {
      empathy: clampMeter(parsed.empathy),
      society: clampMeter(parsed.society),
      informationProcessing: clampMeter(parsed.informationProcessing),
      decisionMaking: clampMeter(parsed.decisionMaking),
      approach: clampMeter(parsed.approach),
    };

    return res.json({
      displayName,
      oneLiner,
      personalityParagraph,
      imageBase64,
      imageMime,
      meters,
      fixedMeters: { energy: 100, hunger: 100, cleanliness: 100 },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "generation_failed",
      message: formatProviderError(err),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Tomagoatse listening on http://localhost:${PORT}`);
});
