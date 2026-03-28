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
  const biggestFear = sanitizeUserBits(body.biggestFear, 500);
  const sillyProp = sanitizeUserBits(body.sillyProp);
  const highSchool = sanitizeUserBits(body.highSchool);

  const genderNote =
    gender === "MM"
      ? "Pronouns note: MM (playful science nod — extra chromosome); reflect kindly in personality blurbs only, not as mockery."
      : `Pronouns: ${gender || "unspecified"}.`;

  const egg =
    highSchool && highSchool.trim() === EASTER_EGG_HIGH_SCHOOL
      ? `Easter egg: they guessed the irrelevant high school (${EASTER_EGG_HIGH_SCHOOL}). Add one subtle, kind wink in the oneLiner only.`
      : "High school is irrelevant — do not congratulate or reference guessing games unless the easter egg above applies.";

  const friendOf = sanitizeUserBits(body.friendOfDisplayName, 120).trim();
  const friendModeBlock =
    friendOf.length > 0
      ? `

FRIEND GENERATION MODE — the player asked for a new buddy for "${friendOf}":
- displayName in your JSON MUST be a fresh, original name for this NEW individual — NOT "${friendOf}", not a mere spelling variant, not a placeholder like "Friend" or "Unnamed".
- Creature type is LOCKED to the same species as this line (same body plan and identity): "${creatureType || "abstract whimsy"}". Your imagePrompt MUST lead with this same creature type. Visually distinguish them from "${friendOf}" (different face, markings, palette accents, pose) — a peer of the same species, not a clone.
- Favourite food is LOCKED to: "${favouriteFood || "not given"}" — do not substitute another food; corner inset must show this food when it is not "not given".
- Biggest fear is LOCKED to the player's concept: "${biggestFear || "not given"}" — keep the same core fear in personality and fearImagePrompt (wording may vary slightly but not the idea).
- For blank or vague inputs below, invent new whimsical specifics (colours, song, birthplace, Myers-Briggs, silly prop, pronoun vibe) so this character feels like a distinct person.
- You may lightly nod to friendship with "${friendOf}" in prose if natural; do not let the whole bio be only about them.`
      : "";

  return `You are a creative writer for wholly ORIGINAL whimsical creatures in the spirit of playful rhyming picture books and pocket virtual pets — NOT Dr. Seuss, NOT Tamagotchi, no trademarked names, no distinctive character copies, no recognizable style imitation of any single work. Invent fresh nonsense words sparingly.

IMAGE VS TEXT — priorities (critical):
- Creature type is the PRIMARY driver for the generated picture: body plan, silhouette, anatomy, species vibe, and props that define WHAT it is. Spend most descriptive weight there so the image model locks onto that form.
- Place of birth is the PRIMARY inspiration for the PICTURE BACKGROUND only: environment, skyline, landscape, architecture, weather, or abstract mood of that locale behind the character (gentle, not cluttered). If missing, use a soft generic whimsical outdoor/studio setting.
- Favourite food (when provided): the image must also show a small, clear ILLUSTRATION of that food as a separate inset in the BOTTOM RIGHT corner of the same composition (same storybook art style, like a tiny picture or sticker tucked in the corner — not covering the character). If no favourite food was given, do not add this inset.
- All other fields below mainly shape DEMEANOUR, MOOD, and FACIAL EXPRESSION in the image (and personality in the text): name, pronouns, colours, favourite song, Myers-Briggs, silly prop, high school when relevant. Favourite food still nudges vibe/expression plus the corner inset above. "Biggest fear" must show up in personality text (tone, quirks, worries) and must flow into fearImagePrompt (see JSON field). They should bend eyebrows, smile, posture, and emotional read — not override creature type's body design.

User inputs:
- Name (use in output, light touch on image labeling only): ${name || "Unnamed"}
- Creature type (dominant for image body/species — honor this heavily): ${creatureType || "abstract whimsy"}
- ${genderNote}
- Colour direction (gentle, not garish — coat/markings and palette): ${colours || "soft palette"}
- Favourite song (nudge temperament; show in face and stance): ${favouriteSong || "none given"}
- Place of birth (IMAGE: background scenery from this; TEXT: can still nudge empathy warmth): ${placeOfBirth || "unknown"}
- Myers-Briggs they claim (for humor: often opposite or sideways; face and pose): ${myersBriggs || "not given"}
- Favourite food (vibe + mouth/snout hints; IMAGE: must appear as a small illustrated inset of this food in the bottom right corner): ${favouriteFood || "not given"}
- Biggest fear (TEXT: work this into oneLiner and personalityParagraph — habits, avoidance, comic dread; do not trivialize cruelly): ${biggestFear || "not given — invent a mild whimsical fear consistent with the rest"}
- Silly prop (optional holdable/wearable — secondary to creature type shape): ${sillyProp || "(blank)"}
- High school: ${highSchool || "not given"}
- ${egg}${friendModeBlock}

Return ONLY valid minified JSON with this exact shape (numbers 1-100 inclusive):
{
  "displayName": string,
  "oneLiner": string,
  "personalityParagraph": string,
  "imagePrompt": string,
  "fearImagePrompt": string,
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
- imagePrompt: one English paragraph for a text-to-image model. MUST (1) lead with and emphasize creature type as the main visual identity — full body, clear silhouette; (2) describe expression, pose, and micro-demeanour from the other fields (not generic face); (3) set the scene with a background clearly inspired by place of birth; (4) if favourite food was given above (not "not given" / not blank), explicitly include a small same-style illustration of that food positioned in the bottom right corner of the frame; if no favourite food, skip the inset; (5) children's-book illustration energy, readable shapes, gentle colours; NO text in image, NO logos, NOT Dr Seuss, NOT any existing character
- fearImagePrompt: one English paragraph for a SEPARATE small image. If "Biggest fear" was given above (not "not given"), this paragraph MUST visualize THAT fear in picture-book style — you may add playful visual detail, lighting, and setting, but keep the same core idea as the user's words. If no biggest fear was given, invent one consistent with personality. The feared object/situation only (NOT the creature in frame). Mild "uh-oh" energy — no gore, no realistic horror, no screaming faces; NO text, NO logos`;

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

/** Vitals (energy, hunger, cleanliness, health) allow 0–100. */
function clampVital(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 50;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function creatureTypeMatchesFavouriteFood(creatureType, favouriteFood) {
  const a = String(creatureType ?? "").trim().toLowerCase();
  const b = String(favouriteFood ?? "").trim().toLowerCase();
  return a.length > 0 && b.length > 0 && a === b;
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
    energy: clampVital(fixedMeters.energy),
    hunger: clampVital(fixedMeters.hunger),
    cleanliness: clampVital(fixedMeters.cleanliness),
    health: clampVital(fixedMeters.health),
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
- Adjust personality axes coherently (empathy, society, informationProcessing, decisionMaking, approach) plus vitals (energy, hunger, cleanliness, health). Health is overall condition (0 = critical).

Return ONLY valid minified JSON with exactly these keys:
{"empathy":number,"society":number,"informationProcessing":number,"decisionMaking":number,"approach":number,"energy":number,"hunger":number,"cleanliness":number,"health":number}`;
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
    const prevFixed = req.body?.fixedMeters && typeof req.body.fixedMeters === "object"
      ? req.body.fixedMeters
      : {};
    const fixedMeters = {
      energy: clampVital(parsed.energy ?? prevFixed.energy),
      hunger: clampVital(parsed.hunger ?? prevFixed.hunger),
      cleanliness: clampVital(parsed.cleanliness ?? prevFixed.cleanliness),
      health: clampVital(parsed.health ?? prevFixed.health ?? 100),
    };

    if (
      action === "feed" &&
      creatureTypeMatchesFavouriteFood(
        req.body?.creatureType,
        req.body?.favouriteFood
      )
    ) {
      fixedMeters.health = 0;
    }

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

    const fbType =
      sanitizeUserBits(req.body?.creatureType, 200) || "whimsical original creature";
    const fbBirth =
      sanitizeUserBits(req.body?.placeOfBirth, 200) || "soft whimsical landscape";
    const fbFood = sanitizeUserBits(req.body?.favouriteFood, 200);
    const foodInset = fbFood
      ? ` small same-style illustrated inset of ${fbFood} in the bottom right corner of the frame,`
      : "";
    const imagePrompt = String(
      parsed.imagePrompt ||
        `Full-body original creature, primary visual identity: ${fbType}, storybook illustration, expressive demeanour and face, background inspired by ${fbBirth},${foodInset} gentle colours, no text, no logos`
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

    const out = {
      displayName,
      oneLiner,
      personalityParagraph,
      imageBase64,
      imageMime,
      meters,
      fixedMeters: { energy: 100, hunger: 100, cleanliness: 100, health: 100 },
    };

    if (fbFood) {
      const foodPrompt = `Single appetizing illustration of ${fbFood}, children's storybook art style, warm and readable shapes, simple soft background, food centered in frame, no characters, no faces, no creatures, no text, no logos`.slice(
        0,
        1500
      );
      try {
        let foodBuffer;
        let foodMime = "image/png";
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const fblob = await hfClient.textToImage({
              model: HF_IMAGE_MODEL,
              inputs: foodPrompt,
              parameters: {
                width: 384,
                height: 384,
                negative_prompt:
                  "text, watermark, signature, logo, character, face, body, blurry, deformed",
              },
            });
            const ab = await fblob.arrayBuffer();
            foodBuffer = Buffer.from(ab);
            foodMime =
              fblob.type && fblob.type.startsWith("image/")
                ? fblob.type
                : "image/png";
            break;
          } catch (e) {
            if (attempt < 1)
              await new Promise((r) => setTimeout(r, 6000));
            else throw e;
          }
        }
        out.foodImageBase64 = foodBuffer.toString("base64");
        out.foodImageMime = foodMime;
      } catch (foodErr) {
        console.warn("[HF food thumb]", foodErr?.message || foodErr);
      }
    }

    const userBiggestFear = sanitizeUserBits(req.body?.biggestFear, 500).trim();
    const fearCore = sanitizeUserBits(parsed.fearImagePrompt, 1200).trim();
    const fearParts = [];
    if (userBiggestFear) {
      fearParts.push(
        `Depict this creature's biggest fear (player-specified): "${userBiggestFear}".`
      );
    }
    if (fearCore) {
      fearParts.push(`Art direction from character writer: ${fearCore}`);
    }
    const fearPrompt = (
      fearParts.join(" ") ||
      `A silly mildly scary thing a ${fbType || "whimsical creature"} might fear — shadows, storm cloud, or stern paperwork — picture-book style`
    ).slice(0, 1500);
    const fearT2I = `Children's storybook illustration: ${fearPrompt} Single clear subject or scene, simple soft background, centered, whimsical not horrific, no creature protagonist, no human faces, no text, no logos`.slice(
      0,
      1500
    );
    try {
      let fearBuffer;
      let fearMime = "image/png";
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const fblob = await hfClient.textToImage({
            model: HF_IMAGE_MODEL,
            inputs: fearT2I,
            parameters: {
              width: 384,
              height: 384,
              negative_prompt:
                "text, watermark, logo, gore, photorealistic horror, screaming, gory, sharp teeth close-up, deformed",
            },
          });
          const ab = await fblob.arrayBuffer();
          fearBuffer = Buffer.from(ab);
          fearMime =
            fblob.type && fblob.type.startsWith("image/")
              ? fblob.type
              : "image/png";
          break;
        } catch (e) {
          if (attempt < 1)
            await new Promise((r) => setTimeout(r, 6000));
          else throw e;
        }
      }
      out.fearImageBase64 = fearBuffer.toString("base64");
      out.fearImageMime = fearMime;
    } catch (fearErr) {
      console.warn("[HF fear thumb]", fearErr?.message || fearErr);
    }

    return res.json(out);
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
