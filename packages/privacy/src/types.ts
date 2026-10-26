export type FileKind =
  "email" | "chat" | "memo" | "pdf" | "docx" | "csv" | "text" | "image" | "unsupported";
export type MetadataField = { field: string; value: string; risk: "high" | "medium" | "low" };
export type StrippedFile = {
  name: string;
  mime: string;
  kind: FileKind;
  originalSize: number;
  bytes: Uint8Array;
  sha256: string;
  metadataRemoved: MetadataField[];
  metadataRemaining: MetadataField[];
  text: string | null;
  anchorDate: string | null;
  title: string;
};
export type PiiType =
  | "person"
  | "org"
  | "place"
  | "email"
  | "phone"
  | "id"
  | "account"
  | "url"
  | "ip"
  | "date_of_birth"
  | "other";
export type TextDocument = { docKey: string; text: string };
export type Detection = {
  id: string;
  docKey: string;
  type: PiiType;
  text: string;
  start: number;
  end: number;
  source: "regex" | "ner" | "custom" | "self";
  confidence: number;
};
export type RedactionDecision = { detectionId: string; action: "pseudonymise" | "redact" | "keep" };
export type PseudonymEntry = {
  placeholder: string;
  type: PiiType;
  value: string;
  variants: string[];
};
export type ScrubResult = {
  documents: TextDocument[];
  pseudonymMap: PseudonymEntry[];
  selfRedactionCount: number;
  counts: Record<string, number>;
  appliedDetections: number;
};
export type LeakageReport = {
  score: number;
  level: "low" | "elevated" | "high";
  residual: { docKey: string; type: PiiType | "self"; text: string }[];
  quasiIdentifiers: { docKey: string; kind: string; text: string }[];
  notes: string[];
};
export type EntityType = Exclude<PiiType, "ip" | "date_of_birth">;
export type AnalysisPayload = {
  version: 1;
  report_id: string;
  campaign_id: string;
  language: string;
  reporter_statement: string;
  documents: {
    doc_id: string;
    title: string;
    kind: Exclude<FileKind, "image" | "unsupported">;
    anchor_date: string | null;
    text: string;
  }[];
  entity_legend: { placeholder: string; type: EntityType }[];
  redaction_summary: Record<string, number>;
};
