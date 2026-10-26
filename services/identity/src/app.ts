import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";

import type { Config } from "./config.js";
import { authorized } from "./crypto.js";
import { remoteAddress, RequestLimits } from "./limits.js";
import { ServiceError } from "./models.js";
import type { SelfVerifier } from "./self.js";
import { MockSelfVerifier, OfficialSelfVerifier, parseSelfInput } from "./self.js";
import { IdentityService, issuer, sessionStatus } from "./service.js";
import type { Store } from "./store.js";
import { blindedMessages, campaignId, integer, record, text, uuid } from "./validation.js";

export type LogEntry = {
  event: "request" | "started" | "stopped" | "startup_failed" | "purge_failed" | "shutdown_failed";
  method?: string;
  route?: string;
  status?: number;
};

export type Logger = (entry: LogEntry) => void;

export const jsonLogger: Logger = (entry) => {
  const timestamp = `${new Date().toISOString().slice(0, 13)}:00:00Z`;
  process.stdout.write(`${JSON.stringify({ timestamp, ...entry })}\n`);
};

export interface AppOptions {
  config: Config;
  store: Store;
  verifier?: SelfVerifier;
  now?: () => number;
  logger?: Logger;
}

async function body(context: Context): Promise<Record<string, unknown>> {
  if (!context.req.header("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ServiceError(400, "json_required");
  }
  try {
    return record(await context.req.json<unknown>());
  } catch {
    throw new ServiceError(400, "invalid_request");
  }
}

function errorResponse(context: Context, error: unknown): Response {
  const status = error instanceof ServiceError ? error.status : 500;
  const code = error instanceof ServiceError ? error.code : "internal_error";
  if (context.req.path === "/v1/self/verify") {
    return context.json({ status: "error", result: false, reason: code }, 200);
  }
  return context.json({ error: code }, status);
}

export function createApp(options: AppOptions): Hono {
  const { config, store } = options;
  const verifier =
    options.verifier ??
    (config.selfMode === "mock"
      ? new MockSelfVerifier()
      : new OfficialSelfVerifier(config.selfMode, config.selfEndpoint));
  const service = new IdentityService(store, config.secret, verifier, options.now);
  const logger = options.logger ?? jsonLogger;
  const limits = new RequestLimits(options.now);
  const app = new Hono();
  app.use("*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    context.header("X-Content-Type-Options", "nosniff");
    await next();
    logger({
      event: "request",
      method: context.req.method,
      route: context.req.routePath ?? "unmatched",
      status: context.res.status,
    });
  });
  app.use(
    "*",
    cors({
      origin: config.webUrl,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
    }),
  );
  app.use(
    "*",
    bodyLimit({
      maxSize: 32 * 1024,
      onError: (context) => errorResponse(context, new ServiceError(413, "body_too_large")),
    }),
  );
  app.use("/v1/*", async (context, next) => {
    if (!limits.acquire(remoteAddress(context))) {
      context.header("Retry-After", "1");
      return errorResponse(context, new ServiceError(429, "rate_limited"));
    }
    try {
      await next();
    } finally {
      limits.release();
    }
  });
  app.onError((error, context) => errorResponse(context, error));
  app.notFound((context) => context.json({ error: "not_found" }, 404));
  app.get("/health", (context) => context.json({ status: "ok" }));
  app.post("/v1/admin/campaigns", async (context) => {
    if (!authorized(context.req.header("authorization"), config.adminToken))
      throw new ServiceError(401, "unauthorized");
    const input = await body(context);
    const campaign = await service.createCampaign(
      campaignId(input.campaign_id),
      integer(input.tokens_per_epoch, 3, 1000),
      integer(input.epoch_days, 30, 365),
    );
    return context.json({
      ...issuer(campaign),
      scope: campaign.scope,
      tokens_per_epoch: campaign.tokens_per_epoch,
      epoch_days: campaign.epoch_days,
      created_at: new Date(campaign.created_at).toISOString(),
    });
  });
  app.get("/v1/campaigns/:campaign/issuer", (context) =>
    context.json(issuer(service.campaign(campaignId(context.req.param("campaign"))))),
  );
  app.post("/v1/sessions", async (context) => {
    const input = await body(context);
    const session = service.createSession(campaignId(input.campaign_id));
    return context.json({
      session_id: session.id,
      expires_at: new Date(session.expires_at).toISOString(),
      self: {
        mode: config.selfMode,
        scope: service.campaign(session.campaign_id).scope,
        endpoint: config.selfEndpoint,
        app_name: "Candor",
        user_id: session.id,
        user_id_type: "uuid",
        disclosures: { minimumAge: 18, ofac: false },
      },
    });
  });
  app.get("/v1/sessions/:id", (context) =>
    context.json(sessionStatus(service.session(uuid(context.req.param("id"))))),
  );
  app.post("/v1/sessions/:id/mock-verify", async (context) => {
    if (config.selfMode !== "mock") throw new ServiceError(404, "not_found");
    const input = await body(context);
    const persona = text(input.persona, 128);
    if (!/^[A-Za-z0-9_-]+$/.test(persona)) throw new ServiceError(400, "invalid_persona");
    return context.json(sessionStatus(service.mockVerify(uuid(context.req.param("id")), persona)));
  });
  app.post("/v1/self/verify", async (context) => {
    if (config.selfMode === "mock") throw new ServiceError(404, "self_callback_disabled");
    const session = await service.verify(parseSelfInput(await body(context)));
    if (session.status !== "verified" && session.status !== "consumed") {
      return context.json({ status: "error", result: false, reason: session.reason }, 200);
    }
    return context.json({ status: "success", result: true });
  });
  app.post("/v1/sessions/:id/issue", async (context) => {
    const input = await body(context);
    return context.json(
      await service.issue(uuid(context.req.param("id")), blindedMessages(input.blinded_messages)),
    );
  });
  return app;
}
