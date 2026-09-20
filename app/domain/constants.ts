export const ADMIN_API_VERSION = "2026-07";
export const EVALUATION_SCHEMA_VERSION = 1;
export const EVALUATION_VERSION = "oc-eval-1.0.0";
export const PROMPT_VERSION = "oc-p0-1.0.0";
export const MAPPING_SCHEMA_VERSION = 1;
export const RULE_SCHEMA_VERSION = 1;

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_DEFAULT_MODEL = "jev-latest";
export const JEV_TIMEOUT_MS = 10_000;
export const JEV_MAX_ATTEMPTS = 5;
export const JEV_RETRY_WINDOW_MS = 10 * 60 * 1000;

export const HIGH_CONFIDENCE_WIN_PROB = 0.9;
export const HIGH_CONFIDENCE_CONFIDENCE = 0.8;

export const MAX_RELEVANT_LINE_ITEMS = 20;
export const MAX_SERIALIZED_INPUT_CHARS = 30_000;
export const WEBHOOK_BODY_LIMIT_BYTES = 1_000_000;
export const QUEUE_PAGE_SIZE = 50;
export const RECENT_AUDIT_DAYS = 30;
export const RECENT_AUDIT_CAP = 500;
export const MAX_ORDER_HISTORY_DAYS = 60;

export const APP_TAG_NEEDS_REVIEW = "orderclarity:needs-review";
export const APP_TAG_UNCHECKED = "orderclarity:unchecked";
export const APP_TAG_REVIEWED = "orderclarity:reviewed";
export const APP_TAGS = [
  APP_TAG_NEEDS_REVIEW,
  APP_TAG_UNCHECKED,
  APP_TAG_REVIEWED,
] as const;

export const GRACE_PERIOD_DAYS = 7;
export const TRIAL_DAYS = 14;
export const TRIAL_ORDER_CAP = 500;
export const STARTER_ORDER_CAP = 1000;
export const GROWTH_ORDER_CAP = 5000;

export const USAGE_LEASE_MS = 15 * 60 * 1000;
export const WORKER_LEASE_MS = 5 * 60 * 1000;
export const ORDER_DEBOUNCE_MS = 2000;
export const CIRCUIT_OPEN_MS = 60_000;

export const LABEL_NO_ISSUE = "No issue detected";
export const LABEL_UNCHECKED = "Unchecked";
export const LABEL_INCOMPLETE = "Incomplete";
export const LABEL_DEMO = "Demo";

export const FORBIDDEN_COPY = [
  "Safe",
  "Guaranteed correct",
  "AI approved",
] as const;
