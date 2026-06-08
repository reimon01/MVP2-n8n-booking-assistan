/**
 * Microservicio HTTP mínimo — VIDA v2.0.
 *
 * Expone dos endpoints:
 *
 *   GET  /health       → liveness check para EasyPanel / Docker
 *   GET  /webhook      → verificación del hub de WhatsApp (Meta)
 *   POST /webhook      → mensajes entrantes de WhatsApp Cloud API
 *   POST /inbound      → llamada desde n8n (Option A): recibe msg normalizado,
 *                        devuelve { reply, duplicate? } sin enviar el mensaje
 *
 * Para /webhook el servidor responde 200 inmediatamente (requerido por Meta)
 * y procesa + responde de forma asíncrona.
 */
import "dotenv/config";
import http from "node:http";
import { Pool } from "pg";
import { processInbound } from "./lib/orchestrator.js";
import { makeOpenAiLlm } from "./lib/llmClient.js";
import { getTenantByPhone } from "./lib/dbOps.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
const WA_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
const WA_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const llm = makeOpenAiLlm();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

async function sendWhatsApp(to, text) {
  if (!WA_ACCESS_TOKEN || !WA_PHONE_NUMBER_ID) {
    // Modo desarrollo: solo log
    console.log(`[WA→${to}] ${text}`);
    return;
  }
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${WA_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WA_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    },
  );
  if (!res.ok) {
    console.error(`[WA send error ${res.status}]`, await res.text());
  }
}

/**
 * Resuelve el tenantId a partir del número de WhatsApp Business (display_phone_number).
 * Si TENANT_ID está en el env, lo usa directamente (deployments de un solo salón).
 */
async function resolveTenantId(displayPhone) {
  if (process.env.TENANT_ID) return process.env.TENANT_ID;
  if (!displayPhone) return null;
  const tenant = await getTenantByPhone(db, displayPhone);
  return tenant?.id ?? null;
}

/**
 * Procesa un mensaje entrante de WhatsApp (extrae campos del payload de Meta).
 */
async function handleWebhookPost(body) {
  const value = body.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];

  if (!message || message.type !== "text") return; // solo texto por ahora

  const displayPhone = value?.metadata?.display_phone_number;
  const tenantId = await resolveTenantId(displayPhone);

  if (!tenantId) {
    console.error("[webhook] tenantId no resuelto para display_phone:", displayPhone);
    return;
  }

  const result = await processInbound(
    db,
    {
      tenantId,
      phone: message.from,
      messageText: message.text.body,
      messageId: message.id,
      receivedAt: new Date(Number(message.timestamp) * 1000).toISOString(),
    },
    { llm },
  );

  if (!result.duplicate && result.reply) {
    await sendWhatsApp(message.from, result.reply);
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // 1. Health check
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  // 2. WhatsApp hub challenge (GET /webhook)
  if (req.method === "GET" && url.pathname === "/webhook") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      res.writeHead(200);
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end("Forbidden");
    }
    return;
  }

  // 3. WhatsApp inbound message (POST /webhook)
  if (req.method === "POST" && url.pathname === "/webhook") {
    // Meta requiere 200 en < 15 s — respondemos inmediatamente
    res.writeHead(200);
    res.end();
    const body = await readBody(req);
    handleWebhookPost(body).catch((err) => console.error("[webhook error]", err));
    return;
  }

  // 4. n8n Option A: POST /inbound
  // n8n extrae el mensaje y llama aquí; devolvemos { reply } sin enviar nada.
  if (req.method === "POST" && url.pathname === "/inbound") {
    const body = await readBody(req);
    const { tenantId, phone, messageText, messageId, receivedAt } = body;

    if (!tenantId || !phone || !messageText || !messageId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Faltan campos: tenantId, phone, messageText, messageId" }));
      return;
    }

    try {
      const result = await processInbound(
        db,
        {
          tenantId,
          phone,
          messageText,
          messageId,
          receivedAt: receivedAt ?? new Date().toISOString(),
        },
        { llm },
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error("[inbound error]", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`VIDA v2.0 escuchando en :${PORT}`);
});

// Graceful shutdown — EasyPanel envía SIGTERM antes de detener el contenedor
process.on("SIGTERM", () => {
  console.log("SIGTERM recibido, cerrando...");
  server.close(() => {
    db.end().then(() => process.exit(0));
  });
});
