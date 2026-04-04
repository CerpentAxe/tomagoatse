import "dotenv/config";
import { InferenceClient } from "@huggingface/inference";
import bcrypt from "bcrypt";
import connectPgSimple from "connect-pg-simple";
import express from "express";
import session from "express-session";
import path from "path";
import pg, { escapeLiteral } from "pg";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
/** Render / Heroku / nginx terminate TLS; without this, req.secure is false and session cookies break. */
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

/** Hours after the last simulated reply before “Continue the conversation” (default 12). */
const PORTAL_CONTINUE_HOURS = Number.isFinite(Number(process.env.PORTAL_CONTINUE_HOURS))
  ? Math.max(0, Number(process.env.PORTAL_CONTINUE_HOURS))
  : 12;

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * Supabase (and most cloud Postgres) require TLS. Local dev can set DATABASE_SSL=false.
 * Node + Supabase on Render often throws SELF_SIGNED_CERT_IN_CHAIN if rejectUnauthorized is true;
 * connection is still encrypted. Default for *.supabase.co / pooler.supabase.com is
 * rejectUnauthorized: false. Override with DATABASE_SSL_REJECT_UNAUTHORIZED=true|false.
 */
function buildPgPoolConfig() {
  if (!DATABASE_URL) return null;
  const url = DATABASE_URL;
  const sslOff =
    process.env.DATABASE_SSL === "false" || process.env.DATABASE_SSL === "0";
  const isSupabase = /supabase\.co|pooler\.supabase\.com/i.test(url);
  const sslOn =
    process.env.DATABASE_SSL === "true" ||
    process.env.DATABASE_SSL === "1" ||
    isSupabase ||
    /neon\.tech|render\.com/i.test(url);
  if (sslOff) {
    return { connectionString: url };
  }
  if (sslOn) {
    const e = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
    let rejectUnauthorized;
    if (e === "true" || e === "1") rejectUnauthorized = true;
    else if (e === "false" || e === "0") rejectUnauthorized = false;
    else rejectUnauthorized = !isSupabase;
    return {
      connectionString: url,
      ssl: { rejectUnauthorized },
    };
  }
  return { connectionString: url };
}

const pgPool = DATABASE_URL ? new pg.Pool(buildPgPoolConfig()) : null;

/** Strict UUID string — safe to interpolate in simple queries (poolers that forbid prepared statements). */
function parseUuidParam(s) {
  let t = String(s ?? "").trim();
  if (t.startsWith("{") && t.endsWith("}")) {
    t = t.slice(1, -1).trim();
  }
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(t)) {
    return null;
  }
  return t.toLowerCase();
}

const SOCIAL_REACH_OPTS = ["offline", "family", "town", "anyone"];

function parseSocialReach(s) {
  const v = String(s ?? "").trim();
  return SOCIAL_REACH_OPTS.includes(v) ? v : null;
}

/** Fixed list of towns for hatchlings (must match my-creature UI). */
const TOWN_OPTS = [
  "Grimwhistle",
  "Skulldrip Hollow",
  "Spitebridge",
  "Mucksnack-on-the-Mire",
];
const DEFAULT_TOWN = "Grimwhistle";

function parseTown(s) {
  const v = String(s ?? "").trim();
  return TOWN_OPTS.includes(v) ? v : null;
}

async function resolveTownForNewCreature(userId, bodyTown) {
  const fromBody = parseTown(bodyTown);
  if (fromBody) return fromBody;
  const last = await pgPool.query(
    `SELECT town FROM creatures WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  if (last.rows.length && last.rows[0].town) {
    const t = parseTown(last.rows[0].town);
    if (t) return t;
  }
  return DEFAULT_TOWN;
}

const PgSession = connectPgSimple(session);
const sessionMiddleware = session({
  store: pgPool
    ? new PgSession({ pool: pgPool, createTableIfMissing: true })
    : undefined,
  secret: process.env.SESSION_SECRET || "tomagoatse-dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  name: "tomagoatse.sid",
  cookie: {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: "lax",
    /** `auto` + trust proxy: Secure cookie only when the client used HTTPS (correct on Render). */
    secure: process.env.NODE_ENV === "production" ? "auto" : false,
  },
});

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
  /** Try these soon after primary — widely routed on Inference Providers. */
  const builtIns = [
    "Qwen/Qwen2.5-7B-Instruct:fastest",
    "meta-llama/Llama-3.2-3B-Instruct:fastest",
    "openai/gpt-oss-120b:fastest",
  ];
  const out = [];
  // Order: primary, then curated defaults, then user extras (extras often point at niche models).
  for (const id of [primary, ...builtIns, ...userExtra]) {
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

async function chatCompletionWithFallbacks(hf, userPrompt, opts = {}) {
  const max_tokens = opts.max_tokens ?? 1024;
  const temperature = opts.temperature ?? 0.75;
  const models = chatModelCandidates();
  let lastErr;
  for (const model of models) {
    try {
      return await hf.chatCompletion({
        model,
        messages: [{ role: "user", content: userPrompt }],
        max_tokens,
        temperature,
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

app.use(express.json({ limit: "25mb" }));
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, "public")));

async function initDb() {
  if (!pgPool) {
    console.warn(
      "[db] DATABASE_URL not set — account sign-up and login are disabled."
    );
    return;
  }
  try {
    await pgPool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  } catch (e) {
    console.warn("[db] pgcrypto extension (optional):", e?.message || e);
  }

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(320) NOT NULL UNIQUE,
      username VARCHAR(64) UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS creatures (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'My beautiful child',
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_creatures_user_updated ON creatures (user_id, updated_at DESC);
  `);
  await pgPool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS surname VARCHAR(120);
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS social_reach VARCHAR(32) NOT NULL DEFAULT 'offline';
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS friend_requests_enabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS town VARCHAR(80) NOT NULL DEFAULT 'Grimwhistle';
  `);
  try {
    await pgPool.query(`
      ALTER TABLE creatures ALTER COLUMN social_reach SET DEFAULT 'town';
      ALTER TABLE creatures ALTER COLUMN friend_requests_enabled SET DEFAULT true;
    `);
  } catch (e) {
    console.warn("[db] creature social defaults (town / friend requests):", e?.message || e);
  }
  try {
    await pgPool.query(
      `ALTER TABLE users ALTER COLUMN email DROP NOT NULL`
    );
  } catch (e) {
    console.warn("[db] email nullable (optional):", e?.message || e);
  }
  try {
    await pgPool.query(
      `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_or_username_ck`
    );
    await pgPool.query(
      `ALTER TABLE users ADD CONSTRAINT users_email_or_username_ck
       CHECK (email IS NOT NULL OR username IS NOT NULL)`
    );
  } catch (e) {
    console.warn("[db] users_email_or_username_ck:", e?.message || e);
  }
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      from_creature_id UUID NOT NULL REFERENCES creatures(id) ON DELETE CASCADE,
      to_creature_id UUID NOT NULL REFERENCES creatures(id) ON DELETE CASCADE,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (from_creature_id <> to_creature_id),
      CHECK (status IN ('pending', 'accepted', 'declined'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_pair
      ON friend_requests(from_creature_id, to_creature_id);
    CREATE TABLE IF NOT EXISTS creature_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id TEXT NOT NULL,
      from_creature_id UUID NOT NULL REFERENCES creatures(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_creature_messages_thread_created
      ON creature_messages(thread_id, created_at);
  `);
  await pgPool.query(`
    ALTER TABLE creature_messages ADD COLUMN IF NOT EXISTS is_ai BOOLEAN NOT NULL DEFAULT false;
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS portal_thread_state (
      thread_id TEXT PRIMARY KEY,
      parent_blocked BOOLEAN NOT NULL DEFAULT false,
      continue_available_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS portal_ai_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id TEXT NOT NULL,
      self_creature_id UUID NOT NULL,
      peer_creature_id UUID NOT NULL,
      job_type VARCHAR(16) NOT NULL,
      run_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      CHECK (job_type IN ('peer', 'self'))
    );
  `);
  await pgPool.query(`
    CREATE INDEX IF NOT EXISTS idx_portal_ai_jobs_due
      ON portal_ai_jobs (run_at) WHERE processed_at IS NULL;
  `);
  console.log("[db] Users and creatures tables ready.");
}

function threadIdForCreatures(a, b) {
  const x = String(a || "").toLowerCase();
  const y = String(b || "").toLowerCase();
  return x < y ? `${x}_${y}` : `${y}_${x}`;
}

function displayNameFromCreaturePayload(row) {
  if (!row) return "Creature";
  const p = row.payload;
  if (p && typeof p === "object") {
    const h = p.hatchery;
    const c = p.creator;
    const fromH =
      h && String(h.displayName || "").trim()
        ? String(h.displayName).trim()
        : "";
    const fromC =
      c && c.session && String(c.session.displayName || "").trim()
        ? String(c.session.displayName).trim()
        : "";
    if (fromH) return fromH.slice(0, 120);
    if (fromC) return fromC.slice(0, 120);
  }
  return String(row.title || "Creature").slice(0, 120);
}

function creaturePortalBlurb(row) {
  if (!row || !row.payload) return "";
  const p = row.payload;
  const hatchery = p.hatchery;
  const creator = p.creator;
  const cap =
    (hatchery && String(hatchery.personalityParagraph || "").trim()) ||
    (creator &&
      creator.session &&
      String(creator.session.caption || "").trim()) ||
    "";
  const tag =
    (hatchery && String(hatchery.oneLiner || "").trim()) ||
    (creator &&
      creator.session &&
      String(creator.session.tagline || "").trim()) ||
    "";
  return String(cap || tag || "").slice(0, 600);
}

function formatPortalTranscript(messages, selfId, peerId, selfName, peerName) {
  return messages
    .map((m) => {
      const mine = String(m.from_creature_id) === String(selfId);
      const who = mine ? selfName : peerName;
      const tag = m.is_ai ? `${who} (simulated)` : who;
      return `${tag}: ${String(m.body || "").trim()}`;
    })
    .join("\n");
}

function sanitizePortalReply(text) {
  let t = String(text || "").trim();
  t = t.replace(/^["'«»]+|["'«»]+$/g, "").trim();
  return t.slice(0, 2000);
}

async function generatePortalCreatureLine(hf, prompt) {
  if (!hf) {
    return null;
  }
  try {
    const completion = await chatCompletionWithFallbacks(hf, prompt, {
      max_tokens: 400,
      temperature: 0.85,
    });
    const content = completion?.choices?.[0]?.message?.content ?? "";
    return sanitizePortalReply(content);
  } catch (e) {
    console.warn("[portal AI]", formatProviderError(e));
    return null;
  }
}

async function schedulePortalSelfJob(pool, threadId, selfC, peerC, delayMs) {
  const runAt = new Date(Date.now() + Math.max(1000, delayMs));
  await pool.query(
    `INSERT INTO portal_ai_jobs (thread_id, self_creature_id, peer_creature_id, job_type, run_at)
     VALUES ($1, $2::uuid, $3::uuid, 'self', $4)`,
    [threadId, selfC, peerC, runAt]
  );
}

async function runPortalPeerJob(pool, job) {
  const { thread_id: threadId, self_creature_id: selfC, peer_creature_id: peerC } =
    job;
  const rSelf = await pool.query(
    `SELECT id, title, town, payload FROM creatures WHERE id = $1::uuid`,
    [selfC]
  );
  const rPeer = await pool.query(
    `SELECT id, title, town, payload FROM creatures WHERE id = $1::uuid`,
    [peerC]
  );
  if (!rSelf.rows.length || !rPeer.rows.length) return;

  const selfRow = rSelf.rows[0];
  const peerRow = rPeer.rows[0];
  const selfName = displayNameFromCreaturePayload(selfRow);
  const peerName = displayNameFromCreaturePayload(peerRow);

  const msgs = await pool.query(
    `SELECT from_creature_id, body, is_ai, created_at
     FROM creature_messages WHERE thread_id = $1 ORDER BY created_at ASC`,
    [threadId]
  );
  const transcript = formatPortalTranscript(
    msgs.rows,
    selfC,
    peerC,
    selfName,
    peerName
  );
  const peerBlurb = creaturePortalBlurb(peerRow);
  const prompt = `You are roleplaying as "${peerName}", a hatchling in a whimsical game called Tomagoatse.
Setting: town "${peerRow.town || "unknown"}". Short personality: ${peerBlurb || "quirky and sincere."}

You are texting your friend "${selfName}". Stay in character as ${peerName} only. Write 1–4 short sentences (plain text, no character names prefix, no quotes around the whole message).

Chat so far:
${transcript || "(start of conversation)"}

Reply now as ${peerName}:`;

  let line = await generatePortalCreatureLine(hfClient, prompt);
  if (!line) {
    line = `*${peerName} looks thoughtful and types something small and hopeful.*`;
  }

  await pool.query(
    `INSERT INTO creature_messages (thread_id, from_creature_id, body, is_ai)
     VALUES ($1, $2::uuid, $3, true)`,
    [threadId, peerC, line]
  );

  const delayMs = (5 + Math.random() * 5) * 60 * 1000;
  await schedulePortalSelfJob(pool, threadId, selfC, peerC, delayMs);
}

async function runPortalSelfJob(pool, job) {
  const { thread_id: threadId, self_creature_id: selfC, peer_creature_id: peerC } =
    job;
  const rSelf = await pool.query(
    `SELECT id, title, town, payload FROM creatures WHERE id = $1::uuid`,
    [selfC]
  );
  const rPeer = await pool.query(
    `SELECT id, title, town, payload FROM creatures WHERE id = $1::uuid`,
    [peerC]
  );
  if (!rSelf.rows.length || !rPeer.rows.length) return;

  const selfRow = rSelf.rows[0];
  const peerRow = rPeer.rows[0];
  const selfName = displayNameFromCreaturePayload(selfRow);
  const peerName = displayNameFromCreaturePayload(peerRow);

  const msgs = await pool.query(
    `SELECT from_creature_id, body, is_ai, created_at
     FROM creature_messages WHERE thread_id = $1 ORDER BY created_at ASC`,
    [threadId]
  );
  const transcript = formatPortalTranscript(
    msgs.rows,
    selfC,
    peerC,
    selfName,
    peerName
  );
  const selfBlurb = creaturePortalBlurb(selfRow);
  const prompt = `You are simulating "${selfName}", a hatchling in Tomagoatse, continuing a text chat with "${peerName}".
The parent already sent their real first message; you are the AI voice of ${selfName} for this beat.
Town: "${selfRow.town || "unknown"}". Personality: ${selfBlurb || "earnest and odd."}

Stay in character as ${selfName} only. Write 1–4 short sentences (plain text, no names prefix).

Chat so far:
${transcript}

Reply now as ${selfName} (simulated):`;

  let line = await generatePortalCreatureLine(hfClient, prompt);
  if (!line) {
    line = `*${selfName} pauses, then adds something awkward and sweet.*`;
  }

  await pool.query(
    `INSERT INTO creature_messages (thread_id, from_creature_id, body, is_ai)
     VALUES ($1, $2::uuid, $3, true)`,
    [threadId, selfC, line]
  );

  const continueAt = new Date(
    Date.now() + PORTAL_CONTINUE_HOURS * 60 * 60 * 1000
  );
  await pool.query(
    `INSERT INTO portal_thread_state (thread_id, parent_blocked, continue_available_at, updated_at)
     VALUES ($1, true, $2, NOW())
     ON CONFLICT (thread_id) DO UPDATE SET
       parent_blocked = true,
       continue_available_at = $2,
       updated_at = NOW()`,
    [threadId, continueAt]
  );
}

async function processPortalAiJobs() {
  if (!pgPool) return;
  const r = await pgPool.query(
    `SELECT id, thread_id, self_creature_id, peer_creature_id, job_type
     FROM portal_ai_jobs
     WHERE processed_at IS NULL AND run_at <= NOW()
     ORDER BY run_at ASC
     LIMIT 1`
  );
  if (!r.rows.length) return;
  const job = r.rows[0];
  try {
    if (job.job_type === "peer") {
      await runPortalPeerJob(pgPool, job);
    } else if (job.job_type === "self") {
      await runPortalSelfJob(pgPool, job);
    }
    await pgPool.query(
      `UPDATE portal_ai_jobs SET processed_at = NOW() WHERE id = $1::uuid`,
      [job.id]
    );
  } catch (e) {
    console.error("[processPortalAiJobs]", job.id, e);
  }
}

async function loadPortalStateRow(threadId) {
  if (!pgPool) return null;
  const r = await pgPool.query(
    `SELECT parent_blocked, continue_available_at FROM portal_thread_state WHERE thread_id = $1`,
    [threadId]
  );
  return r.rows[0] || null;
}

function portalStatePayload(row) {
  if (!row) {
    return {
      parent_blocked: false,
      continue_available_at: null,
      can_continue: false,
    };
  }
  const blocked = Boolean(row.parent_blocked);
  const at = row.continue_available_at;
  const can =
    blocked &&
    at != null &&
    new Date(at).getTime() <= Date.now();
  return {
    parent_blocked: blocked,
    continue_available_at: at ? new Date(at).toISOString() : null,
    can_continue: can,
  };
}

function normalizeEmail(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .slice(0, 320);
}

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "unauthorized", message: "Sign in required." });
  }
  next();
}

function validateUsername(u) {
  if (u == null || u === "") return null;
  const t = String(u).trim();
  if (t.length < 3 || t.length > 32) return false;
  if (!/^[a-zA-Z0-9_]+$/.test(t)) return false;
  return t;
}

app.post("/api/auth/register", async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({
      error: "db_unavailable",
      message: "Set DATABASE_URL to enable accounts.",
    });
  }
  const body = req.body || {};
  const password = String(body.password || "");
  const usernameRaw = validateUsername(body.username);
  if (usernameRaw === false) {
    return res.status(400).json({
      error: "invalid_username",
      message: "Username must be 3–32 characters: letters, numbers, underscores.",
    });
  }

  const emailInput = String(body.email || "").trim();
  const emailNormalized = emailInput ? normalizeEmail(emailInput) : null;
  let email =
    emailNormalized && emailNormalized.includes("@") ? emailNormalized : null;
  if (emailInput && !email && !usernameRaw) {
    return res.status(400).json({
      error: "invalid_email",
      message:
        "That doesn’t look like an email. Use a unique username instead, or leave the email field empty.",
    });
  }
  if (!email && !usernameRaw) {
    return res.status(400).json({
      error: "invalid_identity",
      message:
        "Provide a unique username (3–32 characters: letters, numbers, underscores). Email is optional.",
    });
  }

  const initialCreature = body.initialCreature;
  let title = "My beautiful child";
  let payloadObj = null;
  if (initialCreature && typeof initialCreature === "object") {
    title = String(initialCreature.title || title).slice(0, 200);
    payloadObj = initialCreature.payload;
    if (payloadObj == null || typeof payloadObj !== "object") {
      return res.status(400).json({
        error: "invalid_payload",
        message: "initialCreature.payload must be an object.",
      });
    }
  }

  const hash = await bcrypt.hash(password, 12);
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const u = await client.query(
      `INSERT INTO users (email, username, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, username`,
      [email, usernameRaw, hash]
    );
    const user = u.rows[0];
    if (payloadObj) {
      await client.query(
        `INSERT INTO creatures (user_id, title, payload)
         VALUES ($1, $2, $3::jsonb)`,
        [user.id, title, JSON.stringify(payloadObj)]
      );
    }
    await client.query("COMMIT");
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.username = user.username;
    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
      },
    });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.code === "23505") {
      return res.status(409).json({
        error: "email_or_username_taken",
        message: "That email or username is already registered.",
      });
    }
    console.error(e);
    return res.status(500).json({ error: "register_failed", message: String(e.message) });
  } finally {
    client.release();
  }
});

app.post("/api/auth/login", async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({
      error: "db_unavailable",
      message: "Set DATABASE_URL to enable accounts.",
    });
  }
  const raw = String((req.body || {}).emailOrUsername || "").trim();
  const password = String((req.body || {}).password ?? "");
  if (!raw) {
    return res.status(400).json({
      error: "invalid_body",
      message: "Email or username required.",
    });
  }
  const r = await pgPool.query(
    `SELECT id, email, username, password_hash FROM users
     WHERE lower(trim(email)) = lower(trim($1::text))
        OR (username IS NOT NULL AND length(trim(username)) > 0
            AND lower(trim(username)) = lower(trim($1::text)))
     LIMIT 1`,
    [raw]
  );
  const row = r.rows[0];
  if (!row) {
    return res.status(401).json({ error: "invalid_credentials", message: "Could not sign you in." });
  }
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "invalid_credentials", message: "Could not sign you in." });
  }
  req.session.userId = row.id;
  req.session.email = row.email;
  req.session.username = row.username;
  return res.json({
    user: {
      id: row.id,
      email: row.email,
      username: row.username,
    },
  });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "logout_failed" });
    }
    res.json({ ok: true });
  });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return res.json({
    user: {
      id: req.session.userId,
      email: req.session.email,
      username: req.session.username,
    },
  });
});

app.get("/api/settings", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  const sessionUserId = req.session.userId;
  try {
    const userRow = await pgPool.query(
      `SELECT id, email, username, surname FROM users WHERE id = $1::uuid`,
      [sessionUserId]
    );
    if (!userRow.rows.length) {
      return res.status(404).json({
        error: "not_found",
        message: "User not found. Try signing out and signing in again.",
      });
    }
    const creatureRows = await pgPool.query(
      `SELECT id, title, town, social_reach, friend_requests_enabled,
        COALESCE(
          NULLIF(trim(payload #>> '{hatchery,displayName}'), ''),
          NULLIF(trim(payload #>> '{creator,session,displayName}'), ''),
          title
        ) AS display_name,
        updated_at
      FROM creatures WHERE user_id = $1::uuid ORDER BY updated_at DESC`,
      [sessionUserId]
    );
    return res.json({
      user: userRow.rows[0],
      creatures: creatureRows.rows,
    });
  } catch (e) {
    console.error("[GET /api/settings]", e);
    return res.status(500).json({
      error: "settings_load_failed",
      message: String(e?.message || e),
    });
  }
});

app.patch("/api/settings/profile", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  const surname = String(req.body?.surname ?? "").trim().slice(0, 120);
  const surnameVal = surname === "" ? null : surname;
  try {
    const r = await pgPool.query(
      `UPDATE users SET surname = $1 WHERE id = $2::uuid RETURNING surname`,
      [surnameVal, req.session.userId]
    );
    if (!r.rows.length) {
      return res.status(404).json({
        error: "not_found",
        message: "User not found. Try signing out and signing in again.",
      });
    }
    return res.json({ ok: true, surname: r.rows[0].surname });
  } catch (e) {
    console.error("[PATCH /api/settings/profile]", e);
    return res.status(500).json({
      error: "profile_update_failed",
      message: String(e?.message || e),
    });
  }
});

app.get("/api/creatures", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  const r = await pgPool.query(
    `SELECT id, title, town, updated_at,
      COALESCE(
        NULLIF(trim(payload #>> '{hatchery,displayName}'), ''),
        NULLIF(trim(payload #>> '{creator,session,displayName}'), ''),
        title
      ) AS display_name,
      COALESCE(
        NULLIF(trim(payload #>> '{profilePictureDataUrl}'), ''),
        NULLIF(trim(payload #>> '{hatchery,portraitDataUrl}'), '')
      ) AS portrait_data_url
    FROM creatures
    WHERE user_id = $1
    ORDER BY updated_at DESC`,
    [req.session.userId]
  );
  return res.json({ creatures: r.rows });
});

app.post("/api/creatures", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  const body = req.body || {};
  const payload = body.payload;
  if (payload == null || typeof payload !== "object") {
    return res.status(400).json({
      error: "invalid_payload",
      message: "payload object required.",
    });
  }
  const title = String(body.title || "My beautiful child").slice(0, 200);
  try {
    const town = await resolveTownForNewCreature(req.session.userId, body.town);
    const r = await pgPool.query(
      `INSERT INTO creatures (user_id, title, payload, town, social_reach, friend_requests_enabled)
       VALUES ($1, $2, $3::jsonb, $4, 'town', true)
       RETURNING id, title, town, created_at, updated_at`,
      [req.session.userId, title, JSON.stringify(payload), town]
    );
    return res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "save_failed", message: String(e.message) });
  }
});

app.get("/api/creatures/me", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  const r = await pgPool.query(
    `SELECT id, title, town, friend_requests_enabled, payload, created_at, updated_at
     FROM creatures
     WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [req.session.userId]
  );
  if (!r.rows.length) {
    return res.status(404).json({ error: "no_creature", message: "No saved creature yet." });
  }
  return res.json(r.rows[0]);
});

app.patch("/api/creatures/:id/settings", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  const creatureId = parseUuidParam(req.params.id);
  const userId = parseUuidParam(req.session.userId);
  if (!creatureId || !userId) {
    return res.status(400).json({
      error: "invalid_id",
      message: "Invalid creature or session id.",
    });
  }
  const body = req.body || {};
  const sets = [];
  if (Object.prototype.hasOwnProperty.call(body, "social_reach")) {
    const sr = parseSocialReach(body.social_reach);
    if (sr === null) {
      return res.status(400).json({
        error: "invalid_social_reach",
        message: `Must be one of: ${SOCIAL_REACH_OPTS.join(", ")}`,
      });
    }
    sets.push(`social_reach = ${escapeLiteral(sr)}`);
  }
  if (Object.prototype.hasOwnProperty.call(body, "friend_requests_enabled")) {
    const fr = Boolean(body.friend_requests_enabled);
    sets.push(`friend_requests_enabled = ${fr ? "true" : "false"}`);
  }
  if (Object.prototype.hasOwnProperty.call(body, "town")) {
    const t = parseTown(body.town);
    if (t === null) {
      return res.status(400).json({
        error: "invalid_town",
        message: `Town must be one of: ${TOWN_OPTS.join(", ")}`,
      });
    }
    sets.push(`town = ${escapeLiteral(t)}`);
  }
  if (!sets.length) {
    return res.status(400).json({
      error: "no_updates",
      message: "Provide social_reach, friend_requests_enabled, and/or town.",
    });
  }
  sets.push("updated_at = NOW()");
  try {
    const sql = `UPDATE creatures SET ${sets.join(", ")} WHERE id = '${creatureId}'::uuid AND user_id = '${userId}'::uuid RETURNING id, town, social_reach, friend_requests_enabled`;
    const r = await pgPool.query(sql);
    if (!r.rows.length) {
      return res.status(404).json({ error: "not_found", message: "Creature not found." });
    }
    return res.json(r.rows[0]);
  } catch (e) {
    console.error("[PATCH /api/creatures/:id/settings]", e);
    return res.status(500).json({
      error: "settings_update_failed",
      message: String(e?.message || e),
    });
  }
});

/** Upload or clear custom profile picture (data URL). Falls back to hatchery portrait when cleared. */
app.patch("/api/creatures/:id/profile-picture", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  const creatureId = parseUuidParam(req.params.id);
  const userId = parseUuidParam(req.session.userId);
  if (!creatureId || !userId) {
    return res.status(400).json({
      error: "invalid_id",
      message: "Invalid creature or session id.",
    });
  }
  const raw = req.body?.profilePictureDataUrl;
  const clear =
    raw === null ||
    raw === undefined ||
    (typeof raw === "string" && raw.trim() === "");
  try {
    if (!clear) {
      const s = String(raw).trim();
      if (!s.startsWith("data:image/")) {
        return res.status(400).json({
          error: "invalid_image",
          message: "Image must be a data:image/ URL.",
        });
      }
      if (s.length > 6_000_000) {
        return res.status(400).json({
          error: "image_too_large",
          message: "Image is too large (max ~6MB).",
        });
      }
      const r = await pgPool.query(
        `UPDATE creatures SET
          payload = jsonb_set(
            COALESCE(payload::jsonb, '{}'::jsonb),
            '{profilePictureDataUrl}',
            to_jsonb($1::text),
            true
          ),
          updated_at = NOW()
        WHERE id = $2::uuid AND user_id = $3::uuid
        RETURNING id, title, town, payload`,
        [s, creatureId, userId]
      );
      if (!r.rows.length) {
        return res.status(404).json({ error: "not_found", message: "Creature not found." });
      }
      return res.json({ ok: true, creature: r.rows[0] });
    }
    const r = await pgPool.query(
      `UPDATE creatures SET
        payload = (COALESCE(payload::jsonb, '{}'::jsonb) - 'profilePictureDataUrl'),
        updated_at = NOW()
       WHERE id = $1::uuid AND user_id = $2::uuid
       RETURNING id, title, town, payload`,
      [creatureId, userId]
    );
    if (!r.rows.length) {
      return res.status(404).json({ error: "not_found", message: "Creature not found." });
    }
    return res.json({ ok: true, creature: r.rows[0] });
  } catch (e) {
    console.error("[PATCH /api/creatures/:id/profile-picture]", e);
    return res.status(500).json({
      error: "profile_picture_update_failed",
      message: String(e?.message || e),
    });
  }
});

/**
 * All creatures in a town except one id (same-server neighbors). Logged-in users only.
 * Query: ?town=...&exclude=<uuid>
 */
app.get("/api/towns/mates", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  const townRaw = String(req.query.town || "").trim();
  const town =
    parseTown(townRaw) || String(townRaw || "").trim() || DEFAULT_TOWN;
  const exclude = parseUuidParam(req.query.exclude);
  if (!exclude) {
    return res.status(400).json({
      error: "invalid_params",
      message: "Query parameter exclude (creature UUID) is required.",
    });
  }
  const viewerCreatureId = parseUuidParam(req.query.viewerCreatureId);
  try {
    const r = await pgPool.query(
      `SELECT c.id, c.title,
        COALESCE(
          NULLIF(trim(c.payload #>> '{hatchery,displayName}'), ''),
          NULLIF(trim(c.payload #>> '{creator,session,displayName}'), ''),
          c.title
        ) AS display_name,
        COALESCE(
          NULLIF(trim(c.payload #>> '{profilePictureDataUrl}'), ''),
          NULLIF(trim(c.payload #>> '{hatchery,portraitDataUrl}'), '')
        ) AS portrait_data_url,
        u.username AS owner_username
      FROM creatures c
      INNER JOIN users u ON u.id = c.user_id
      WHERE c.town = $1 AND c.id <> $2::uuid
      ORDER BY c.updated_at DESC
      LIMIT 100`,
      [town, exclude]
    );
    const rows = r.rows;
    if (viewerCreatureId && rows.length) {
      const own = await pgPool.query(
        `SELECT 1 FROM creatures WHERE id = $1::uuid AND user_id = $2::uuid`,
        [viewerCreatureId, req.session.userId]
      );
      if (!own.rows.length) {
        return res.status(403).json({
          error: "forbidden",
          message: "viewerCreatureId must be one of your creatures.",
        });
      }
      const ids = rows.map((x) => x.id);
      const fr = await pgPool.query(
        `SELECT id, from_creature_id, to_creature_id, status
         FROM friend_requests
         WHERE (from_creature_id = $1::uuid AND to_creature_id = ANY($2::uuid[]))
            OR (to_creature_id = $1::uuid AND from_creature_id = ANY($2::uuid[]))`,
        [viewerCreatureId, ids]
      );
      const rel = new Map();
      for (const f of fr.rows) {
        const other =
          f.from_creature_id === viewerCreatureId
            ? f.to_creature_id
            : f.from_creature_id;
        let key = "none";
        if (f.status === "accepted") key = "friends";
        else if (f.status === "pending") {
          key =
            f.from_creature_id === viewerCreatureId
              ? "pending_out"
              : "pending_in";
        } else if (f.status === "declined") {
          key = "declined";
        }
        rel.set(String(other), {
          request_id: f.id,
          relationship: key,
        });
      }
      for (const row of rows) {
        const x = rel.get(String(row.id));
        row.friendship = x || { relationship: "none" };
      }
    }
    return res.json({ town, creatures: rows });
  } catch (e) {
    console.error("[GET /api/towns/mates]", e);
    return res.status(500).json({
      error: "townmates_failed",
      message: String(e?.message || e),
    });
  }
});

app.post("/api/friend-requests", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  const fromId = parseUuidParam(req.body?.fromCreatureId);
  const toId = parseUuidParam(req.body?.toCreatureId);
  if (!fromId || !toId || fromId === toId) {
    return res.status(400).json({
      error: "invalid_body",
      message: "fromCreatureId and toCreatureId (different) required.",
    });
  }
  try {
    const own = await pgPool.query(
      `SELECT id, town FROM creatures WHERE id = $1::uuid AND user_id = $2::uuid`,
      [fromId, req.session.userId]
    );
    if (!own.rows.length) {
      return res.status(403).json({
        error: "forbidden",
        message: "You can only send requests from your own hatchlings.",
      });
    }
    const toR = await pgPool.query(
      `SELECT id, friend_requests_enabled, town FROM creatures WHERE id = $1::uuid`,
      [toId]
    );
    if (!toR.rows.length) {
      return res.status(404).json({ error: "not_found", message: "Creature not found." });
    }
    if (!toR.rows[0].friend_requests_enabled) {
      return res.status(400).json({
        error: "requests_disabled",
        message: "That hatchling is not accepting friend requests.",
      });
    }
    const fromTown = String(own.rows[0].town || "").trim();
    const toTown = String(toR.rows[0].town || "").trim();
    const sameTown =
      fromTown.length > 0 && fromTown === toTown;
    const status = sameTown ? "accepted" : "pending";
    const ins = await pgPool.query(
      `INSERT INTO friend_requests (from_creature_id, to_creature_id, status)
       VALUES ($1::uuid, $2::uuid, $3)
       RETURNING id, from_creature_id, to_creature_id, status, created_at`,
      [fromId, toId, status]
    );
    return res.status(201).json(ins.rows[0]);
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({
        error: "duplicate_request",
        message: "A friend request already exists between these hatchlings.",
      });
    }
    console.error("[POST /api/friend-requests]", e);
    return res.status(500).json({
      error: "friend_request_failed",
      message: String(e?.message || e),
    });
  }
});

app.get("/api/friend-requests", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  const uid = req.session.userId;
  try {
    const r = await pgPool.query(
      `SELECT fr.id, fr.status, fr.created_at, fr.updated_at,
        fr.from_creature_id, fr.to_creature_id,
        fc.title AS from_title,
        tc.title AS to_title,
        COALESCE(
          NULLIF(trim(fc.payload #>> '{hatchery,displayName}'), ''),
          NULLIF(trim(fc.payload #>> '{creator,session,displayName}'), ''),
          fc.title
        ) AS from_display_name,
        COALESCE(
          NULLIF(trim(tc.payload #>> '{hatchery,displayName}'), ''),
          NULLIF(trim(tc.payload #>> '{creator,session,displayName}'), ''),
          tc.title
        ) AS to_display_name,
        COALESCE(
          NULLIF(trim(fc.payload #>> '{profilePictureDataUrl}'), ''),
          NULLIF(trim(fc.payload #>> '{hatchery,portraitDataUrl}'), '')
        ) AS from_portrait_data_url,
        COALESCE(
          NULLIF(trim(tc.payload #>> '{profilePictureDataUrl}'), ''),
          NULLIF(trim(tc.payload #>> '{hatchery,portraitDataUrl}'), '')
        ) AS to_portrait_data_url,
        fu.username AS from_owner_username,
        tu.username AS to_owner_username,
        fc.user_id AS from_user_id,
        tc.user_id AS to_user_id
      FROM friend_requests fr
      INNER JOIN creatures fc ON fc.id = fr.from_creature_id
      INNER JOIN creatures tc ON tc.id = fr.to_creature_id
      INNER JOIN users fu ON fu.id = fc.user_id
      INNER JOIN users tu ON tu.id = tc.user_id
      WHERE fr.status = 'pending'
        AND (fc.user_id = $1::uuid OR tc.user_id = $1::uuid)
      ORDER BY fr.updated_at DESC`,
      [uid]
    );
    const incoming = [];
    const outgoing = [];
    for (const row of r.rows) {
      const item = {
        id: row.id,
        status: row.status,
        created_at: row.created_at,
        from_creature_id: row.from_creature_id,
        to_creature_id: row.to_creature_id,
        from_display_name: row.from_display_name,
        to_display_name: row.to_display_name,
        from_portrait_data_url: row.from_portrait_data_url,
        to_portrait_data_url: row.to_portrait_data_url,
        from_owner_username: row.from_owner_username,
        to_owner_username: row.to_owner_username,
      };
      if (String(row.to_user_id) === String(uid)) {
        incoming.push(item);
      } else {
        outgoing.push(item);
      }
    }
    return res.json({ incoming, outgoing });
  } catch (e) {
    console.error("[GET /api/friend-requests]", e);
    return res.status(500).json({
      error: "friend_requests_failed",
      message: String(e?.message || e),
    });
  }
});

app.patch("/api/friend-requests/:id", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  const rid = parseUuidParam(req.params.id);
  const action = String((req.body || {}).action || "").toLowerCase();
  const uid = req.session.userId;
  if (!rid || !["accept", "decline", "cancel"].includes(action)) {
    return res.status(400).json({
      error: "invalid_body",
      message: "action must be accept, decline, or cancel.",
    });
  }
  try {
    const r = await pgPool.query(
      `SELECT fr.id, fr.from_creature_id, fr.to_creature_id, fr.status,
        fc.user_id AS from_user_id, tc.user_id AS to_user_id
      FROM friend_requests fr
      INNER JOIN creatures fc ON fc.id = fr.from_creature_id
      INNER JOIN creatures tc ON tc.id = fr.to_creature_id
      WHERE fr.id = $1::uuid`,
      [rid]
    );
    if (!r.rows.length) {
      return res.status(404).json({ error: "not_found" });
    }
    const row = r.rows[0];
    if (row.status !== "pending") {
      return res.status(400).json({ error: "not_pending", message: "Request is no longer pending." });
    }
    if (action === "accept" || action === "decline") {
      if (String(row.to_user_id) !== String(uid)) {
        return res.status(403).json({ error: "forbidden" });
      }
      const next = action === "accept" ? "accepted" : "declined";
      await pgPool.query(
        `UPDATE friend_requests SET status = $1, updated_at = NOW() WHERE id = $2::uuid`,
        [next, rid]
      );
      return res.json({ ok: true, status: next });
    }
    if (action === "cancel") {
      if (String(row.from_user_id) !== String(uid)) {
        return res.status(403).json({ error: "forbidden" });
      }
      await pgPool.query(`DELETE FROM friend_requests WHERE id = $1::uuid`, [rid]);
      return res.json({ ok: true, status: "cancelled" });
    }
    return res.status(400).json({ error: "invalid_action" });
  } catch (e) {
    console.error("[PATCH /api/friend-requests/:id]", e);
    return res.status(500).json({
      error: "friend_request_update_failed",
      message: String(e?.message || e),
    });
  }
});

app.get("/api/creatures/:id/friends", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  const cid = parseUuidParam(req.params.id);
  if (!cid) {
    return res.status(400).json({ error: "invalid_id" });
  }
  try {
    const own = await pgPool.query(
      `SELECT 1 FROM creatures WHERE id = $1::uuid AND user_id = $2::uuid`,
      [cid, req.session.userId]
    );
    if (!own.rows.length) {
      return res.status(404).json({ error: "not_found" });
    }
    const r = await pgPool.query(
      `SELECT fr.id AS request_id,
        CASE
          WHEN fr.from_creature_id = $1::uuid THEN fr.to_creature_id
          ELSE fr.from_creature_id
        END AS other_creature_id
      FROM friend_requests fr
      WHERE fr.status = 'accepted'
        AND (fr.from_creature_id = $1::uuid OR fr.to_creature_id = $1::uuid)`,
      [cid]
    );
    const ids = r.rows.map((x) => x.other_creature_id);
    if (!ids.length) {
      return res.json({ friends: [] });
    }
    const d = await pgPool.query(
      `SELECT c.id, c.title,
        COALESCE(
          NULLIF(trim(c.payload #>> '{hatchery,displayName}'), ''),
          NULLIF(trim(c.payload #>> '{creator,session,displayName}'), ''),
          c.title
        ) AS display_name,
        COALESCE(
          NULLIF(trim(c.payload #>> '{profilePictureDataUrl}'), ''),
          NULLIF(trim(c.payload #>> '{hatchery,portraitDataUrl}'), '')
        ) AS portrait_data_url,
        u.username AS owner_username
      FROM creatures c
      INNER JOIN users u ON u.id = c.user_id
      WHERE c.id = ANY($1::uuid[])`,
      [ids]
    );
    const reqByOther = new Map(r.rows.map((x) => [String(x.other_creature_id), x.request_id]));
    const friends = d.rows.map((row) => ({
      ...row,
      request_id: reqByOther.get(String(row.id)),
    }));
    return res.json({ friends });
  } catch (e) {
    console.error("[GET /api/creatures/:id/friends]", e);
    return res.status(500).json({
      error: "friends_load_failed",
      message: String(e?.message || e),
    });
  }
});

app.get("/api/portal/messages", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  const selfC = parseUuidParam(req.query.selfCreatureId);
  const peerC = parseUuidParam(req.query.peerCreatureId);
  if (!selfC || !peerC) {
    return res.status(400).json({
      error: "invalid_params",
      message: "selfCreatureId and peerCreatureId required.",
    });
  }
  try {
    const own = await pgPool.query(
      `SELECT 1 FROM creatures WHERE id = $1::uuid AND user_id = $2::uuid`,
      [selfC, req.session.userId]
    );
    if (!own.rows.length) {
      return res.status(403).json({ error: "forbidden" });
    }
    const fr = await pgPool.query(
      `SELECT 1 FROM friend_requests
       WHERE status = 'accepted'
         AND ((from_creature_id = $1::uuid AND to_creature_id = $2::uuid)
           OR (from_creature_id = $2::uuid AND to_creature_id = $1::uuid))`,
      [selfC, peerC]
    );
    if (!fr.rows.length) {
      return res.status(403).json({
        error: "not_friends",
        message: "You can only message accepted friends.",
      });
    }
    const threadId = threadIdForCreatures(selfC, peerC);
    const m = await pgPool.query(
      `SELECT id, from_creature_id, body, created_at, is_ai
       FROM creature_messages
       WHERE thread_id = $1
       ORDER BY created_at ASC
       LIMIT 200`,
      [threadId]
    );
    const st = await loadPortalStateRow(threadId);
    return res.json({
      messages: m.rows,
      thread_id: threadId,
      portal: portalStatePayload(st),
    });
  } catch (e) {
    console.error("[GET /api/portal/messages]", e);
    return res.status(500).json({
      error: "messages_failed",
      message: String(e?.message || e),
    });
  }
});

app.post("/api/portal/messages", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  const selfC = parseUuidParam(req.body?.selfCreatureId);
  const peerC = parseUuidParam(req.body?.peerCreatureId);
  const body = String(req.body?.body ?? "").trim().slice(0, 2000);
  if (!selfC || !peerC || !body) {
    return res.status(400).json({
      error: "invalid_body",
      message: "selfCreatureId, peerCreatureId, and non-empty body required.",
    });
  }
  try {
    const own = await pgPool.query(
      `SELECT 1 FROM creatures WHERE id = $1::uuid AND user_id = $2::uuid`,
      [selfC, req.session.userId]
    );
    if (!own.rows.length) {
      return res.status(403).json({ error: "forbidden" });
    }
    const fr = await pgPool.query(
      `SELECT 1 FROM friend_requests
       WHERE status = 'accepted'
         AND ((from_creature_id = $1::uuid AND to_creature_id = $2::uuid)
           OR (from_creature_id = $2::uuid AND to_creature_id = $1::uuid))`,
      [selfC, peerC]
    );
    if (!fr.rows.length) {
      return res.status(403).json({ error: "not_friends" });
    }
    const threadId = threadIdForCreatures(selfC, peerC);
    const st = await loadPortalStateRow(threadId);
    if (st && st.parent_blocked) {
      return res.status(403).json({
        error: "portal_parent_blocked",
        message:
          "Wait for the AI replies and the 12-hour pause, then use “Continue the conversation” before sending again.",
      });
    }
    const ins = await pgPool.query(
      `INSERT INTO creature_messages (thread_id, from_creature_id, body, is_ai)
       VALUES ($1, $2::uuid, $3, false)
       RETURNING id, from_creature_id, body, created_at, is_ai`,
      [threadId, selfC, body]
    );
    await pgPool.query(
      `INSERT INTO portal_thread_state (thread_id, parent_blocked, continue_available_at, updated_at)
       VALUES ($1, true, NULL, NOW())
       ON CONFLICT (thread_id) DO UPDATE SET
         parent_blocked = true,
         continue_available_at = NULL,
         updated_at = NOW()`,
      [threadId]
    );
    const runPeerAt = new Date(Date.now() + 15000);
    await pgPool.query(
      `INSERT INTO portal_ai_jobs (thread_id, self_creature_id, peer_creature_id, job_type, run_at)
       VALUES ($1, $2::uuid, $3::uuid, 'peer', $4)`,
      [threadId, selfC, peerC, runPeerAt]
    );
    const st2 = await loadPortalStateRow(threadId);
    return res.status(201).json({
      ...ins.rows[0],
      portal: portalStatePayload(st2),
    });
  } catch (e) {
    console.error("[POST /api/portal/messages]", e);
    return res.status(500).json({
      error: "message_send_failed",
      message: String(e?.message || e),
    });
  }
});

app.post("/api/portal/continue", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  const selfC = parseUuidParam(req.body?.selfCreatureId);
  const peerC = parseUuidParam(req.body?.peerCreatureId);
  if (!selfC || !peerC) {
    return res.status(400).json({
      error: "invalid_body",
      message: "selfCreatureId and peerCreatureId required.",
    });
  }
  try {
    const own = await pgPool.query(
      `SELECT 1 FROM creatures WHERE id = $1::uuid AND user_id = $2::uuid`,
      [selfC, req.session.userId]
    );
    if (!own.rows.length) {
      return res.status(403).json({ error: "forbidden" });
    }
    const fr = await pgPool.query(
      `SELECT 1 FROM friend_requests
       WHERE status = 'accepted'
         AND ((from_creature_id = $1::uuid AND to_creature_id = $2::uuid)
           OR (from_creature_id = $2::uuid AND to_creature_id = $1::uuid))`,
      [selfC, peerC]
    );
    if (!fr.rows.length) {
      return res.status(403).json({ error: "not_friends" });
    }
    const threadId = threadIdForCreatures(selfC, peerC);
    const st = await loadPortalStateRow(threadId);
    if (!st || !st.parent_blocked) {
      return res.status(400).json({
        error: "nothing_to_continue",
        message: "There is no paused conversation to continue.",
      });
    }
    const at = st.continue_available_at;
    if (!at || new Date(at).getTime() > Date.now()) {
      return res.status(403).json({
        error: "continue_not_ready",
        message: "The continue option unlocks 12 hours after the last AI reply.",
      });
    }
    await pgPool.query(
      `UPDATE portal_thread_state
       SET parent_blocked = false, continue_available_at = NULL, updated_at = NOW()
       WHERE thread_id = $1`,
      [threadId]
    );
    const st2 = await loadPortalStateRow(threadId);
    return res.json({ ok: true, portal: portalStatePayload(st2) });
  } catch (e) {
    console.error("[POST /api/portal/continue]", e);
    return res.status(500).json({
      error: "continue_failed",
      message: String(e?.message || e),
    });
  }
});

/** Clears parent_blocked so the owner can send again without waiting for Continue / timers. */
app.post("/api/portal/unblock", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  const selfC = parseUuidParam(req.body?.selfCreatureId);
  const peerC = parseUuidParam(req.body?.peerCreatureId);
  if (!selfC || !peerC) {
    return res.status(400).json({
      error: "invalid_body",
      message: "selfCreatureId and peerCreatureId required.",
    });
  }
  try {
    const own = await pgPool.query(
      `SELECT 1 FROM creatures WHERE id = $1::uuid AND user_id = $2::uuid`,
      [selfC, req.session.userId]
    );
    if (!own.rows.length) {
      return res.status(403).json({ error: "forbidden" });
    }
    const fr = await pgPool.query(
      `SELECT 1 FROM friend_requests
       WHERE status = 'accepted'
         AND ((from_creature_id = $1::uuid AND to_creature_id = $2::uuid)
           OR (from_creature_id = $2::uuid AND to_creature_id = $1::uuid))`,
      [selfC, peerC]
    );
    if (!fr.rows.length) {
      return res.status(403).json({ error: "not_friends" });
    }
    const threadId = threadIdForCreatures(selfC, peerC);
    await pgPool.query(
      `INSERT INTO portal_thread_state (thread_id, parent_blocked, continue_available_at, updated_at)
       VALUES ($1, false, NULL, NOW())
       ON CONFLICT (thread_id) DO UPDATE SET
         parent_blocked = false,
         continue_available_at = NULL,
         updated_at = NOW()`,
      [threadId]
    );
    const st2 = await loadPortalStateRow(threadId);
    return res.json({ ok: true, portal: portalStatePayload(st2) });
  } catch (e) {
    console.error("[POST /api/portal/unblock]", e);
    return res.status(500).json({
      error: "unblock_failed",
      message: String(e?.message || e),
    });
  }
});

/** Read-only creature payload for any saved hatchling (viewer must be logged in). */
app.get("/api/creatures/public/:id", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  try {
    const r = await pgPool.query(
      `SELECT c.id, c.title, c.town, c.payload, c.created_at, c.updated_at,
        c.user_id, u.username AS owner_username
      FROM creatures c
      INNER JOIN users u ON u.id = c.user_id
      WHERE c.id = $1::uuid`,
      [req.params.id]
    );
    if (!r.rows.length) {
      return res.status(404).json({ error: "not_found" });
    }
    const row = r.rows[0];
    const ownerId = row.user_id;
    const sessionId = req.session.userId;
    const isOwner =
      ownerId != null &&
      sessionId != null &&
      String(ownerId) === String(sessionId);
    delete row.user_id;
    return res.json({ ...row, is_owner: isOwner });
  } catch (e) {
    console.error("[GET /api/creatures/public/:id]", e);
    return res.status(500).json({
      error: "public_load_failed",
      message: String(e?.message || e),
    });
  }
});

app.get("/api/creatures/:id", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  const r = await pgPool.query(
    `SELECT id, title, town, friend_requests_enabled, payload, created_at, updated_at
     FROM creatures
     WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.session.userId]
  );
  if (!r.rows.length) {
    return res.status(404).json({ error: "not_found" });
  }
  return res.json(r.rows[0]);
});

app.delete("/api/creatures/:id", requireAuth, async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "db_unavailable" });
  }
  const creatureId = parseUuidParam(req.params.id);
  const userId = parseUuidParam(req.session.userId);
  if (!creatureId || !userId) {
    return res.status(400).json({
      error: "invalid_id",
      message: "Invalid creature or session id.",
    });
  }
  try {
    // No parameter array: simple query protocol (works with Supabase transaction pooler / PgBouncer).
    const r = await pgPool.query(
      `DELETE FROM creatures WHERE id = '${creatureId}'::uuid AND user_id = '${userId}'::uuid RETURNING id`
    );
    if (!r.rows.length) {
      return res
        .status(404)
        .json({ error: "not_found", message: "Creature not found." });
    }
    return res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    console.error("[DELETE /api/creatures/:id]", e);
    return res.status(500).json({
      error: "delete_failed",
      message: e?.message || "Could not delete creature.",
    });
  }
});

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

const CREATOR_BODY_PLANS = new Set([
  "Quadruped",
  "Serpentine",
  "Bipedal",
  "Humanoid",
  "Avian/Flying",
  "Aquatic",
  "Arthropod-like",
]);

const CREATOR_GENDERS = new Set(["Male", "Female", "Other"]);

const CREATOR_NOSE = new Set([
  "Nose",
  "Snout",
  "Beak",
  "Proboscis",
]);

const CREATOR_MOUTH = new Set([
  "Normal",
  "Teeth",
  "Tusks",
  "Fangs",
  "Mandibles",
  "Jaws",
  "Tongue",
  "whiskers",
]);

const CREATOR_ARM_TYPES = new Set([
  "none",
  "human",
  "wings",
  "fins",
  "flippers",
  "tentacles",
  "hooves",
  "paws",
  "talons",
  "claws",
]);

const CREATOR_BACK_TYPES = new Set([
  "none",
  "wings",
  "dorsal fin",
  "dermal plates",
  "shell",
  "quills",
]);

const CREATOR_TAIL_TYPES = new Set([
  "none",
  "normal",
  "tentacles",
  "dragon",
  "nubbin",
]);

const CREATOR_HAIRCUTS = new Set([
  "Bald",
  "Long and flowing",
  "Curly",
  "Spiky",
  "Mohawk",
  "Braided",
  "Buzz cut",
  "Afro/fluffy",
  "Dreadlocks/matted",
  "Layered",
]);

function pickEnum(val, allowed, fallback) {
  const s = String(val ?? "").trim();
  if (allowed.has(s)) return s;
  return fallback;
}

/** Torso scale sliders in the creator (client uses same range). */
function clampCreatorBodyProp(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 1;
  return Math.max(0.45, Math.min(2.2, Math.round(x * 100) / 100));
}

function pickSizeEnum(val, fallback = "medium") {
  return pickEnum(val, new Set(["small", "medium", "large"]), fallback);
}

function pickLocationFrontSide(val, fallback = "front") {
  return pickEnum(val, new Set(["front", "side"]), fallback);
}

function pickLocationTopSide(val, fallback = "top") {
  return pickEnum(val, new Set(["top", "side"]), fallback);
}

function pickArmLength(val, fallback = "medium") {
  return pickEnum(val, new Set(["short", "medium", "long"]), fallback);
}

function pickBackSize(val, fallback = "medium") {
  return pickEnum(val, new Set(["small", "medium", "large"]), fallback);
}

function pickBackPosition(val, fallback = "upper") {
  return pickEnum(val, new Set(["upper", "mid", "lower"]), fallback);
}

function pickTailLength(val, fallback = "medium") {
  return pickEnum(val, new Set(["short", "medium", "long"]), fallback);
}

/** Map hatch form gender to creator enum. */
function mapFormGenderToCreator(g) {
  const x = String(g ?? "").trim().toLowerCase();
  if (x === "male") return "Male";
  if (x === "female") return "Female";
  return "Other";
}

/** Deterministic spec when no LLM is available (keyword heuristics on creature type). */
function buildHeuristicCreatorSpec(body) {
  const ct = String(body?.creatureType || "creature").toLowerCase();
  const coloursHint = String(body?.colours || "").toLowerCase();
  let h = 0;
  for (let i = 0; i < ct.length; i++) h = (h * 31 + ct.charCodeAt(i)) | 0;
  h = Math.abs(h);
  const pick = (arr, i) => arr[i % arr.length];

  let bodyPlan = "Bipedal";
  if (/snake|serpent|worm|eel|anaconda|python|naga/.test(ct)) {
    bodyPlan = "Serpentine";
  } else if (/bird|avian|owl|hawk|wing|fly|crow|raven|parrot|bat/.test(ct)) {
    bodyPlan = "Avian/Flying";
  } else if (
    /fish|aquatic|frog|newt|crab|shrimp|jelly|squid|octopus|whale|dolphin|otter|seal|shark|ray|turtle|axolotl|newt/.test(
      ct
    )
  ) {
    bodyPlan = "Aquatic";
  } else if (
    /spider|insect|beetle|ant|arthropod|crustacean|lobster|mite|tick/.test(ct)
  ) {
    bodyPlan = "Arthropod-like";
  } else if (/wolf|cat|dog|fox|horse|deer|lion|tiger|bear|quad|paw|hoof/.test(ct)) {
    bodyPlan = "Quadruped";
  } else if (/human|person|goblin|troll|fairy|elf|orc|biped|knight|wizard/.test(ct)) {
    bodyPlan = "Humanoid";
  }

  const palette = ["#88aa99", "#aa8877", "#6688cc", "#99aa66", "#cc9966", "#8899aa"];
  let skin = pick(palette, h);
  if (/mint|green/.test(coloursHint)) skin = "#7daa88";
  if (/lavender|purple|violet/.test(coloursHint)) skin = "#9988bb";
  if (/apricot|orange|peach/.test(coloursHint)) skin = "#ccaa88";

  const tailTypes = ["normal", "none", "dragon", "nubbin"];
  const haircuts = [
    "Layered",
    "Spiky",
    "Curly",
    "Bald",
    "Mohawk",
    "Long and flowing",
  ];

  const isFlyer = bodyPlan === "Avian/Flying";
  const isSnake = bodyPlan === "Serpentine";
  const isWater = bodyPlan === "Aquatic";
  const isQuad = bodyPlan === "Quadruped";
  const isHumanoid = bodyPlan === "Humanoid";

  let bodyWidth = 1;
  let bodyHeight = 1;
  let bodyLength = 1;
  if (isQuad) {
    bodyHeight = 0.76;
    bodyLength = 1.38;
  } else if (isWater) {
    bodyHeight = 0.8;
    bodyLength = 1.32;
  } else if (isHumanoid) {
    bodyWidth = 0.82;
    bodyHeight = 1.18;
    bodyLength = 1.14;
  }

  return {
    bodyPlan,
    gender: mapFormGenderToCreator(body?.gender),
    bodyColour: skin,
    bodyWidth,
    bodyHeight,
    bodyLength,
    head: {
      eyes: {
        count: /cyclops|one eye|single eye/.test(ct) ? 1 : 2,
        colour: "#3344aa",
        size: "medium",
        location: /side|lizard|chameleon/.test(ct) ? "side" : "front",
      },
      antennae: {
        count: /moth|ant|bee|bug|insect/.test(ct) ? 2 : h % 5 === 0 ? 2 : 0,
        colour: "#665544",
        size: "small",
        location: "top",
      },
      ears: {
        count: /earless|no ears/.test(ct)
          ? 0
          : /cat|dog|fox|bunny|rabbit|bear|mouse/.test(ct)
            ? 2
            : h % 2,
        colour: skin,
        size: "medium",
        location: "side",
      },
      nose: /beak|bird|duck|hawk/.test(ct)
        ? "Beak"
        : /snout|boar|pig|tapir/.test(ct)
          ? "Snout"
          : "Nose",
      mouth: "Normal",
    },
    arms: {
      count: isSnake ? 0 : 2,
      length: "medium",
      colour: skin,
      type: isFlyer
        ? "wings"
        : isWater
          ? "fins"
          : "paws",
    },
    backAttachment: {
      size: "medium",
      colour: "#778899",
      position: "upper",
      type: isFlyer
        ? "none"
        : isWater
          ? "dorsal fin"
          : h % 4 === 0
            ? "quills"
            : "none",
    },
    tail: {
      count: isSnake ? 0 : 1,
      colour: skin,
      length: /long tail|dragon/.test(ct) ? "long" : "medium",
      type: isSnake ? "none" : /dragon|drake/.test(ct) ? "dragon" : pick(tailTypes, h),
    },
    haircut: pick(haircuts, h),
  };
}

function normalizeCreatorSpec(raw, ctx = {}) {
  const o = raw && typeof raw === "object" ? raw : {};
  const headIn = o.head && typeof o.head === "object" ? o.head : {};
  const eyesIn = headIn.eyes && typeof headIn.eyes === "object" ? headIn.eyes : {};
  const antIn =
    headIn.antennae && typeof headIn.antennae === "object"
      ? headIn.antennae
      : {};
  const earsIn = headIn.ears && typeof headIn.ears === "object" ? headIn.ears : {};
  const armsIn = o.arms && typeof o.arms === "object" ? o.arms : {};
  const backIn =
    o.backAttachment && typeof o.backAttachment === "object"
      ? o.backAttachment
      : {};
  const tailIn = o.tail && typeof o.tail === "object" ? o.tail : {};

  let bodyPlan = pickEnum(o.bodyPlan, CREATOR_BODY_PLANS, "Bipedal");
  let gender = pickEnum(o.gender, CREATOR_GENDERS, mapFormGenderToCreator(ctx.gender));

  const eyeCount = Math.max(
    0,
    Math.min(8, Math.round(Number(eyesIn.count) || 2))
  );
  const antCount = Math.max(
    0,
    Math.min(8, Math.round(Number(antIn.count) || 0))
  );
  const earCount = Math.max(
    0,
    Math.min(8, Math.round(Number(earsIn.count) || 2))
  );

  const defaultArmColour = String(armsIn.colour || "#ccaa88").slice(0, 32);
  const bodyColour = String(
    o.bodyColour != null && o.bodyColour !== ""
      ? o.bodyColour
      : defaultArmColour
  ).slice(0, 32);

  return {
    bodyPlan,
    gender,
    bodyColour,
    bodyWidth: clampCreatorBodyProp(o.bodyWidth),
    bodyHeight: clampCreatorBodyProp(o.bodyHeight),
    bodyLength: clampCreatorBodyProp(o.bodyLength),
    head: {
      eyes: {
        count: eyeCount,
        colour: String(eyesIn.colour || "#3344aa").slice(0, 32),
        size: pickSizeEnum(eyesIn.size, "medium"),
        location: pickLocationFrontSide(eyesIn.location, "front"),
      },
      antennae: {
        count: antCount,
        colour: String(antIn.colour || "#666666").slice(0, 32),
        size: pickSizeEnum(antIn.size, "small"),
        location: pickLocationTopSide(antIn.location, "top"),
      },
      ears: {
        count: earCount,
        colour: String(earsIn.colour || "#aa8866").slice(0, 32),
        size: pickSizeEnum(earsIn.size, "medium"),
        location: pickLocationFrontSide(earsIn.location, "side"),
      },
      nose: pickEnum(headIn.nose, CREATOR_NOSE, "Nose"),
      mouth: pickEnum(headIn.mouth, CREATOR_MOUTH, "Normal"),
    },
    arms: {
      count: Math.max(0, Math.min(6, Math.round(Number(armsIn.count) || 2))),
      length: pickArmLength(armsIn.length, "medium"),
      colour: String(armsIn.colour || "#ccaa88").slice(0, 32),
      type: pickEnum(armsIn.type, CREATOR_ARM_TYPES, "paws"),
    },
    backAttachment: {
      size: pickBackSize(backIn.size, "medium"),
      visualScale: (() => {
        const x = Number(backIn.visualScale);
        if (!Number.isFinite(x)) return 1;
        return Math.max(0.5, Math.min(1.5, x));
      })(),
      colour: String(backIn.colour || "#8899aa").slice(0, 32),
      position: pickBackPosition(backIn.position, "upper"),
      type: pickEnum(backIn.type, CREATOR_BACK_TYPES, "none"),
    },
    tail: {
      count: Math.max(0, Math.min(4, Math.round(Number(tailIn.count) || 1))),
      colour: String(tailIn.colour || "#887766").slice(0, 32),
      length: pickTailLength(tailIn.length, "medium"),
      type: pickEnum(tailIn.type, CREATOR_TAIL_TYPES, "normal"),
    },
    haircut: pickEnum(o.haircut, CREATOR_HAIRCUTS, "Layered"),
  };
}

function buildCreatorSpecPrompt(body) {
  const creatureType =
    sanitizeUserBits(body?.creatureType, 240) || "original creature";
  const displayName = sanitizeUserBits(body?.displayName, 120);
  const colours = sanitizeUserBits(body?.colours, 400);
  const favouriteFood = sanitizeUserBits(body?.favouriteFood, 200);
  const biggestFear = sanitizeUserBits(body?.biggestFear, 200);
  const placeOfBirth = sanitizeUserBits(body?.placeOfBirth, 200);
  const favouriteSong = sanitizeUserBits(body?.favouriteSong, 200);
  const myersBriggs = sanitizeUserBits(body?.myersBriggs, 40);
  const sillyProp = sanitizeUserBits(body?.sillyProp, 200);
  const genderHint = mapFormGenderToCreator(body?.gender);

  const meters = body?.meters && typeof body.meters === "object" ? body.meters : {};
  const meterBits = [
    `empathy=${meters.empathy}`,
    `society=${meters.society}`,
    `informationProcessing=${meters.informationProcessing}`,
    `decisionMaking=${meters.decisionMaking}`,
    `approach=${meters.approach}`,
  ].join(", ");

  const fixed = body?.fixedMeters && typeof body.fixedMeters === "object"
    ? body.fixedMeters
    : {};
  const vitalBits = [
    `energy=${fixed.energy}`,
    `hunger=${fixed.hunger}`,
    `cleanliness=${fixed.cleanliness}`,
    `health=${fixed.health}`,
  ].join(", ");

  return `You are a character design system. Given a creature type and context, output ONE JSON object only (no markdown, no commentary) for a stylized LOW-POLY 3D creature rig (faceted shapes, readable silhouette).

Creature type (primary): "${creatureType}"
Display name: "${displayName}"
User colour words (use for harmonious palette hex codes): "${colours}"
Gender hint (use for Male/Female/Other): ${genderHint}
Favourite food: "${favouriteFood}"
Biggest fear: "${biggestFear}"
Place of birth: "${placeOfBirth}"
Favourite song: "${favouriteSong}"
Myers-Briggs: "${myersBriggs}"
Silly prop: "${sillyProp}"
Personality meters (flavour only): ${meterBits}
Vitals (flavour only): ${vitalBits}

Fill every field consistently with the creature type. Prefer biologically plausible or whimsically coherent combinations.

Required JSON shape and ENUMS (use exact strings):

{
  "bodyPlan": one of "Quadruped" | "Serpentine" | "Bipedal" | "Humanoid" | "Avian/Flying" | "Aquatic" | "Arthropod-like",
  "gender": one of "Male" | "Female" | "Other",
  "bodyColour": "#RRGGBB (torso, head base, legs — can match or differ from arms)",
  "bodyWidth": 0.45-2.2 (left/right scale, 1 = default),
  "bodyHeight": 0.45-2.2 (vertical scale),
  "bodyLength": 0.45-2.2 (front-back scale),
  "head": {
    "eyes": { "count": 0-8, "colour": "#RRGGBB", "size": "small"|"medium"|"large", "location": "front"|"side" },
    "antennae": { "count": 0-8, "colour": "#RRGGBB", "size": "small"|"medium"|"large", "location": "top"|"side" },
    "ears": { "count": 0-8, "colour": "#RRGGBB", "size": "small"|"medium"|"large", "location": "front"|"side" },
    "nose": one of "Nose"|"Snout"|"Beak"|"Proboscis",
    "mouth": one of "Normal"|"Teeth"|"Tusks"|"Fangs"|"Mandibles"|"Jaws"|"Tongue"|"whiskers"
  },
  "arms": {
    "count": 0-6,
    "length": "short"|"medium"|"long",
    "colour": "#RRGGBB",
    "type": "none"|"human"|"wings"|"fins"|"flippers"|"tentacles"|"hooves"|"paws"|"talons"|"claws"
  },
  "backAttachment": {
    "size": "small"|"medium"|"large",
    "visualScale": 0.5-1.5 (optional, default 1 — fine size in preview),
    "colour": "#RRGGBB",
    "position": "upper"|"mid"|"lower",
    "type": "none"|"wings"|"dorsal fin"|"dermal plates"|"shell"|"quills"
  },
  "tail": {
    "count": 0-4,
    "colour": "#RRGGBB",
    "length": "short"|"medium"|"long",
    "type": "none"|"normal"|"tentacles"|"dragon"|"nubbin"
  },
  "haircut": one of "Bald"|"Long and flowing"|"Curly"|"Spiky"|"Mohawk"|"Braided"|"Buzz cut"|"Afro/fluffy"|"Dreadlocks/matted"|"Layered"
}

Rules:
- At least 1 eye unless the concept is explicitly eyeless (then count 0).
- Match leg/limb logic to bodyPlan (e.g. Quadruped: four ground limbs; Serpentine: no legs; Avian: wings + legs; use arms.type "wings" when appropriate).
- Use "bodyColour" for torso, main head shell, and legs; use "arms.colour" for arm limbs, tentacles, and wing membranes when those are the arms.
- Use bodyWidth/bodyHeight/bodyLength near 1 unless the creature is unusually stocky, tall, or elongated (preview scales the torso and re-attaches limbs).
- Colours must be valid #RRGGBB hex strings.
- Output ONLY the JSON object, minified or pretty, no other text.`;
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

app.post("/api/creator-spec", async (req, res) => {
  if (!HF_API_KEY || HF_API_KEY === "hf_your_token_here") {
    return res.status(500).json({
      error: "missing_api_key",
      message: "Set HF_API_KEY in .env (see .env.example).",
    });
  }

  try {
    const creatureType = String(req.body?.creatureType || "").trim();
    if (!creatureType) {
      return res.status(400).json({
        error: "invalid_body",
        message: "creatureType is required",
      });
    }

    const userPrompt = buildCreatorSpecPrompt(req.body || {});

    let parsed;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const completion = await chatCompletionWithFallbacks(
          hfClient,
          userPrompt,
          { max_tokens: 2048, temperature: 0.45 }
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

    const spec = normalizeCreatorSpec(parsed, {
      gender: req.body?.gender,
    });

    return res.json({ spec, specSource: "model" });
  } catch (err) {
    console.warn(
      "[creator-spec] LLM path failed, using heuristic spec:",
      err?.message || err
    );
    try {
      const spec = normalizeCreatorSpec(buildHeuristicCreatorSpec(req.body || {}), {
        gender: req.body?.gender,
      });
      return res.json({
        spec,
        specSource: "heuristic",
        warning:
          "Inference models were unavailable; using a keyword-based design. Set HF_TEXT_MODEL to a model your account can run (see .env.example), or enable providers at https://huggingface.co/settings/inference-providers",
      });
    } catch (fallbackErr) {
      console.error(fallbackErr);
      return res.status(500).json({
        error: "creator_spec_failed",
        message: formatProviderError(err),
      });
    }
  }
});

async function start() {
  await initDb();
  if (pgPool) {
    setInterval(() => {
      processPortalAiJobs().catch((e) => console.error("[portal jobs]", e));
    }, 5000);
    processPortalAiJobs().catch((e) => console.error("[portal jobs]", e));
  }
  app.listen(PORT, () => {
    console.log(`Tomagoatse listening on http://localhost:${PORT}`);
  });
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
