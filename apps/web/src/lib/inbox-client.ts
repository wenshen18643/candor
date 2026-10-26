import type * as Crypto from "@candor/crypto";
import type { KeyPair, SealBox } from "@candor/crypto";

import { apiUrl, defaultCampaign, showcaseMode } from "./config";

type CryptoModule = typeof Crypto;
let cryptoModule: Promise<CryptoModule> | null = null;

function loadCrypto(): Promise<CryptoModule> {
  cryptoModule ??= import("@candor/crypto").then(async (module) => {
    await module.ready();
    return module;
  });
  return cryptoModule;
}

export type InboxStep = "derive" | "prove" | "open";
export type StepUpdate =
  | { step: InboxStep; status: "running" }
  | { step: InboxStep; status: "done"; ms: number; detail: string }
  | { step: InboxStep; status: "error"; message: string };

export type Question = { question_id: string; text: string };
export type ReviewerMessage = {
  id: string;
  kind: "question" | "message";
  body: string;
  questions: Question[];
  sent_at: string;
  sealed_bytes: number;
};
export type Recipient = {
  reviewer_id: string;
  display_name: string;
  key_id: string;
  enc_pk: string;
};
export type SealedCopy = {
  reviewer_id: string;
  display_name: string;
  key_id: string;
  bytes: number;
};
export type SentReply = {
  id: string;
  created_at: string;
  body: string | null;
  answers: Question[];
  sealed: SealedCopy[];
  delivered: boolean;
};
export type ThreadItem =
  { type: "incoming"; message: ReviewerMessage } | { type: "outgoing"; reply: SentReply };
export type Thread = { report_id: string; status: string; items: ThreadItem[] };
export type ReplyDraft = { body: string; answers: Question[] };

export type InboxSession = {
  mode: "showcase" | "live";
  inboxId: string;
  expiresAt: string;
  organisation: string;
  threads: Thread[];
  recipients: Recipient[];
  sendReply(reportId: string, draft: ReplyDraft): Promise<SentReply>;
  lock(): void;
};

export type InboxClient = {
  mode: "showcase" | "live";
  demoCodename: string | null;
  open(codename: string, onProgress: (update: StepUpdate) => void): Promise<InboxSession>;
};

export class InboxError extends Error {
  constructor(
    readonly step: InboxStep,
    message: string,
  ) {
    super(message);
    this.name = "InboxError";
  }
}

export const demoCodename = "orbit-velvet-harbor-quilt-ember-sparrow-lantern-meadow";
const demoSignPk = "DtlNEHlG7WiXvI4Ab70RbDVXsNGDkDKxr7LXh_35994";
const demoBoxPk = "8U98VKEzTMk4ETF9Ap7XZB4FKgtKAaP563muHJ6W_SU";

export function countCodenameWords(text: string) {
  return text
    .toLowerCase()
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean).length;
}

const paint = () =>
  new Promise<void>((resolve) => {
    const fallback = setTimeout(resolve, 80);
    if (typeof requestAnimationFrame === "undefined") return;
    requestAnimationFrame(() =>
      setTimeout(() => {
        clearTimeout(fallback);
        resolve();
      }, 0),
    );
  });

async function deriveKeys(
  c: CryptoModule,
  codename: string,
  onProgress: (update: StepUpdate) => void,
) {
  onProgress({ step: "derive", status: "running" });
  await paint();
  const started = performance.now();
  try {
    const keys = await c.deriveInboxKeys(codename);
    onProgress({
      step: "derive",
      status: "done",
      ms: performance.now() - started,
      detail: "Argon2id · 64 MiB of memory · 3 passes",
    });
    return keys;
  } catch {
    throw new InboxError(
      "derive",
      "That codename could not be read. Check the words and try again.",
    );
  }
}

function wipe(keys: { sign: KeyPair; box: KeyPair }) {
  keys.sign.privateKey.fill(0);
  keys.box.privateKey.fill(0);
}

function sealedSize(box: SealBox) {
  return Math.floor((box.c.length * 3) / 4);
}

function draftPayload(draft: ReplyDraft) {
  return {
    kind: "reply" as const,
    body: draft.body.trim(),
    answers: draft.answers
      .map((answer) => ({ question_id: answer.question_id, text: answer.text.trim() }))
      .filter((answer) => answer.text.length > 0),
    sent_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

type IncomingPayload = {
  kind?: string;
  body?: string;
  questions?: Question[];
  sent_at?: string;
};

function toMessage(id: string, payload: IncomingPayload, createdAt: string, bytes: number) {
  return {
    id,
    kind: payload.kind === "question" ? "question" : "message",
    body: typeof payload.body === "string" ? payload.body : "",
    questions: Array.isArray(payload.questions) ? payload.questions : [],
    sent_at: payload.sent_at ?? createdAt,
    sealed_bytes: bytes,
  } satisfies ReviewerMessage;
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return (await response.json()) as T;
}

async function get<T>(path: string, token?: string): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return (await response.json()) as T;
}

type ApiMessage = {
  id: string;
  direction: "to_reporter" | "to_reviewers";
  box?: SealBox;
  boxes?: { reviewer_id: string }[];
  created_at: string;
};

function createLiveClient(): InboxClient {
  return {
    mode: "live",
    demoCodename: null,
    async open(codename, onProgress) {
      const c = await loadCrypto();
      const keys = await deriveKeys(c, codename, onProgress);
      const sigPk = c.b64u.encode(keys.sign.publicKey);

      onProgress({ step: "prove", status: "running" });
      const proveStarted = performance.now();
      let session: { token: string; expires_at: string; report_ids: string[] };
      try {
        const { challenge } = await post<{ challenge: string }>("/v1/inbox/challenge", {
          sig_pk: sigPk,
        });
        const signature = c.signDetached(
          c.inboxAuthMessage(sigPk, challenge),
          keys.sign.privateKey,
        );
        session = await post("/v1/inbox/session", {
          sig_pk: sigPk,
          challenge,
          signature: c.b64u.encode(signature),
        });
      } catch {
        wipe(keys);
        throw new InboxError(
          "prove",
          "We could not reach the inbox service. Try again in a minute.",
        );
      }
      onProgress({
        step: "prove",
        status: "done",
        ms: performance.now() - proveStarted,
        detail: "Ed25519 signature over a one-time challenge",
      });

      onProgress({ step: "open", status: "running" });
      const openStarted = performance.now();
      let threads: Thread[];
      let recipients: Recipient[] = [];
      let organisation = "The review team";
      try {
        const [inbox, campaign] = await Promise.all([
          get<{ reports: { report_id: string; status: string; messages: ApiMessage[] }[] }>(
            "/v1/inbox/messages",
            session.token,
          ),
          get<{
            org?: { name?: string };
            reviewers?: { reviewer_id: string; display_name: string; enc_pk: string }[];
          }>(`/v1/campaigns/${encodeURIComponent(defaultCampaign)}`).catch(() => null),
        ]);
        organisation = campaign?.org?.name ?? organisation;
        recipients = (campaign?.reviewers ?? []).map((reviewer) => ({
          ...reviewer,
          key_id: c.keyId(c.b64u.decode(reviewer.enc_pk)),
        }));
        const names = new Map(recipients.map((item) => [item.reviewer_id, item.display_name]));
        threads = inbox.reports.map((report) => ({
          report_id: report.report_id,
          status: report.status,
          items: report.messages.flatMap((message): ThreadItem[] => {
            if (message.direction === "to_reporter" && message.box) {
              try {
                const payload = c.openSealJson<IncomingPayload>(
                  message.box,
                  keys.box.publicKey,
                  keys.box.privateKey,
                );
                return [
                  {
                    type: "incoming",
                    message: toMessage(
                      message.id,
                      payload,
                      message.created_at,
                      sealedSize(message.box),
                    ),
                  },
                ];
              } catch {
                return [];
              }
            }
            if (message.direction === "to_reviewers")
              return [
                {
                  type: "outgoing",
                  reply: {
                    id: message.id,
                    created_at: message.created_at,
                    body: null,
                    answers: [],
                    sealed: (message.boxes ?? []).map((box) => ({
                      reviewer_id: box.reviewer_id,
                      display_name: names.get(box.reviewer_id) ?? "Reviewer",
                      key_id: "",
                      bytes: 0,
                    })),
                    delivered: true,
                  },
                },
              ];
            return [];
          }),
        }));
      } catch {
        wipe(keys);
        throw new InboxError("open", "Your messages could not be loaded. Try again in a minute.");
      }
      onProgress({
        step: "open",
        status: "done",
        ms: performance.now() - openStarted,
        detail: "Sealed boxes opened with your private key, on this device",
      });

      return {
        mode: "live",
        inboxId: c.keyId(keys.sign.publicKey),
        expiresAt: session.expires_at,
        organisation,
        threads,
        recipients,
        async sendReply(reportId, draft) {
          if (recipients.length === 0)
            throw new Error(
              "The reviewers' keys are not available, so the reply cannot be sealed.",
            );
          const payload = draftPayload(draft);
          const boxes = recipients.map((recipient) => ({
            recipient,
            box: c.sealJson(payload, c.b64u.decode(recipient.enc_pk)),
          }));
          const result = await post<{ id: string }>(
            "/v1/inbox/messages",
            {
              report_id: reportId,
              boxes: boxes.map((item) => ({
                reviewer_id: item.recipient.reviewer_id,
                box: item.box,
              })),
              answers_count: payload.answers.length,
            },
            session.token,
          );
          return {
            id: result.id,
            created_at: payload.sent_at,
            body: payload.body || null,
            answers: payload.answers,
            sealed: boxes.map((item) => ({
              reviewer_id: item.recipient.reviewer_id,
              display_name: item.recipient.display_name,
              key_id: item.recipient.key_id,
              bytes: sealedSize(item.box),
            })),
            delivered: true,
          };
        },
        lock: () => wipe(keys),
      };
    },
  };
}

const reporterWording: [RegExp, string][] = [
  [/the ORG_3 payments/g, "the payments to the consulting firm"],
  [/ORG_2's/g, "the winning bidder's"],
  [/\bORG_3\b/g, "the consulting firm"],
  [/\bORG_2\b/g, "the winning bidder"],
  [/\bORG_4\b/g, "the other bidder"],
  [/\bPERSON_1\b/g, "the Director of Procurement"],
  [/\b(?:PERSON|ORG|PLACE|EMAIL|PHONE|ID|ACCOUNT|URL)_\d+\b/g, "the person or group you named"],
];

export function toReporterWords(text: string) {
  return reporterWording.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    text,
  );
}

type ShowcaseAnalysis = {
  report_id: string;
  follow_up_questions: { question_id: string; question: string; priority: number }[];
};

type ShowcaseReviewers = {
  reviewers: { reviewer_id: string; display_name: string; enc_pk: string; enc_key_id: string }[];
};

function createShowcaseClient(): InboxClient {
  return {
    mode: "showcase",
    demoCodename,
    async open(codename, onProgress) {
      const [c, analysisModule, logModule] = await Promise.all([
        loadCrypto(),
        import("@/data/showcase-analysis.json"),
        import("@/data/showcase-log.json"),
      ]);
      const analysis = analysisModule.default as unknown as ShowcaseAnalysis;
      const directory = logModule.default as unknown as ShowcaseReviewers;
      const keys = await deriveKeys(c, codename, onProgress);
      const sigPk = c.b64u.encode(keys.sign.publicKey);

      onProgress({ step: "prove", status: "running" });
      const proveStarted = performance.now();
      await paint();
      const challenge = c.b64u.encode(crypto.getRandomValues(new Uint8Array(32)));
      const signature = c.signDetached(c.inboxAuthMessage(sigPk, challenge), keys.sign.privateKey);
      const registered = sigPk === demoSignPk;
      const accepted =
        registered &&
        c.verifyDetached(
          signature,
          c.inboxAuthMessage(sigPk, challenge),
          c.b64u.decode(demoSignPk),
        );
      onProgress({
        step: "prove",
        status: "done",
        ms: performance.now() - proveStarted,
        detail: "Ed25519 signature over a one-time challenge",
      });

      onProgress({ step: "open", status: "running" });
      const openStarted = performance.now();
      await paint();
      const threads: Thread[] = [];
      if (accepted) {
        const questions = [...analysis.follow_up_questions]
          .sort((a, b) => a.priority - b.priority || a.question_id.localeCompare(b.question_id))
          .map((item) => ({ question_id: item.question_id, text: toReporterWords(item.question) }));
        const sealedByReviewers = c.sealJson(
          {
            kind: "question",
            body: "Thank you for your report. We have read it closely. These questions would help us check what happened. Answer only what you feel safe to share. It is fine to skip a question or to say you don't know.",
            questions,
            sent_at: "2026-10-26T10:12:00Z",
          },
          c.b64u.decode(demoBoxPk),
        );
        const payload = c.openSealJson<IncomingPayload>(
          sealedByReviewers,
          keys.box.publicKey,
          keys.box.privateKey,
        );
        threads.push({
          report_id: analysis.report_id,
          status: "investigating",
          items: [
            {
              type: "incoming",
              message: toMessage(
                "showcase-q1",
                payload,
                "2026-10-26T10:12:00Z",
                sealedSize(sealedByReviewers),
              ),
            },
          ],
        });
      }
      onProgress({
        step: "open",
        status: "done",
        ms: performance.now() - openStarted,
        detail: "Sealed boxes opened with your private key, on this device",
      });

      const recipients: Recipient[] = directory.reviewers.map((reviewer) => ({
        reviewer_id: reviewer.reviewer_id,
        display_name: reviewer.display_name,
        enc_pk: reviewer.enc_pk,
        key_id: c.keyId(c.b64u.decode(reviewer.enc_pk)),
      }));

      return {
        mode: "showcase",
        inboxId: c.keyId(keys.sign.publicKey),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        organisation: "Northwind Health",
        threads,
        recipients,
        async sendReply(_reportId, draft) {
          const payload = draftPayload(draft);
          const sealed = recipients.map((recipient) => {
            const box = c.sealJson(payload, c.b64u.decode(recipient.enc_pk));
            return {
              reviewer_id: recipient.reviewer_id,
              display_name: recipient.display_name,
              key_id: recipient.key_id,
              bytes: sealedSize(box),
            };
          });
          return {
            id: `showcase-${Date.now()}`,
            created_at: payload.sent_at,
            body: payload.body || null,
            answers: payload.answers,
            sealed,
            delivered: false,
          };
        },
        lock: () => wipe(keys),
      };
    },
  };
}

export function createInboxClient(): InboxClient {
  return showcaseMode ? createShowcaseClient() : createLiveClient();
}
