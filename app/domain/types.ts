export type AppMode = "demo" | "live";
export type OperatingMode = "observation" | "assisted_review";
export type ShopStatus = "active" | "paused" | "uninstalled" | "reconnect_required";

export type StaffRole = "owner" | "reviewer" | "viewer" | "system_worker" | "unidentified";

export type FieldRole =
  | "personalization_content"
  | "operational_request"
  | "gift_message"
  | "selected_option"
  | "ignored";

export type OnboardingStep =
  | "install"
  | "choose_products"
  | "map_fields"
  | "define_rules"
  | "review_sample"
  | "activate";

export type ProcessingState =
  | "queued"
  | "running"
  | "complete"
  | "incomplete"
  | "failed"
  | "stale"
  | "excluded";

export type FindingState =
  | "open"
  | "awaiting_customer"
  | "resolved"
  | "dismissed"
  | "superseded";

export type HumanReviewState = "not_reviewed" | "in_review" | "reviewed";

export type CheckOutcome = "issue" | "no_issue" | "not_applicable" | "uncertain";

export type DetectionMethod = "deterministic" | "semantic";

export type OverallLabel =
  | "issues"
  | "no_issue_detected"
  | "unchecked"
  | "incomplete"
  | "excluded";

export type ReasonCode =
  | "variant_conflict"
  | "personalization_conflict"
  | "missing_information"
  | "ambiguous_assignment"
  | "unsupported_request"
  | "gift_content"
  | "length_exceeded"
  | "invalid_option"
  | "structured_assignment"
  | "unchecked_unmapped"
  | "unchecked_limit"
  | "unchecked_provider"
  | "unchecked_language"
  | "unchecked_plan_limit"
  | "unchecked_pagination"
  | "unchecked_auth"
  | "incomplete_coverage";

export type ResolveAction = "mark_reviewed" | "awaiting_customer" | "dismiss" | "reopen";

export type DismissReason =
  | "incorrect_flag"
  | "request_already_accepted"
  | "irrelevant_context";

export type ResolutionCategory =
  | "confirmed_with_customer"
  | "accepted_as_is"
  | "merchant_corrected"
  | "other";

export type AuthContext = {
  shopId: string;
  shopDomain: string;
  installationGeneration: number;
  staffId: string | null;
  role: StaffRole;
  requestId: string;
};

export type SourceRef = {
  path: string;
  itemId: string;
  occurrenceIndex: number;
};

export type MappedAttribute = {
  sourceRef: string;
  sourceKey: string;
  occurrenceIndex: number;
  fieldRole: FieldRole;
  roleName: string;
  rawValue: string;
};

export type LinePolicy = {
  requiredRoles: string[];
  maxGraphemes: number | null;
  surfaces: string[] | null;
  allowedOptions: Record<string, string[]>;
  structuredAssignments: boolean;
};

export type LineItemSnapshot = {
  lineItemGid: string;
  productGid: string;
  variantGid: string;
  title: string;
  selectedOptions: Record<string, string>;
  quantity: number;
  mappedAttributes: MappedAttribute[];
  applicability: "applicable" | "unsupported" | "unmapped" | "removed";
  policy: LinePolicy;
};

export type OrderSnapshot = {
  schemaVersion: 1;
  shopId: string;
  installationGeneration: number;
  orderGid: string;
  displayNumber: string;
  shopifyUpdatedAt: string;
  observedAt: string;
  cancelled: boolean;
  fulfillmentSummary: string;
  originalNote: string;
  shopifyTags: string[];
  items: LineItemSnapshot[];
  mappingVersion: string;
  ruleVersion: string;
  mappingComplete: boolean;
  paginationComplete: boolean;
  customerId: string | null;
};

export type CheckResult = {
  checkId: string;
  outcome: CheckOutcome;
  reasonCode?: ReasonCode;
  itemRef?: string;
  sourceRefs: string[];
  evidence: Record<string, string>;
  method: DetectionMethod;
  templateId: string;
  winningProbability?: number;
  confidence?: number;
  modelId?: string;
};

export type FindingDraft = {
  fingerprint: string;
  checkId: string;
  reasonCode: ReasonCode;
  itemRef: string | null;
  sourceRefs: string[];
  evidence: Record<string, string>;
  method: DetectionMethod;
  uncertain: boolean;
  templateId: string;
  winningProbability?: number;
  confidence?: number;
};

export type EvaluationOutcome = {
  processingState: ProcessingState;
  overallLabel: OverallLabel;
  uncheckedReason?: ReasonCode;
  incompleteReason?: string;
  findings: FindingDraft[];
  checkResults: CheckResult[];
  providerModel?: string;
  providerCalled: boolean;
  serializedInputChars: number;
  relevantItemCount: number;
};

export type ChoiceQuestion = {
  type: "choice";
  instructions: string | Record<string, unknown>;
  criteria: Record<string, string | null>;
};

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type ProviderUsage = {
  input_tokens: number;
  output_tokens: number;
};

export type ProviderInput = {
  model: string;
  state: unknown;
  questions: Record<string, ChoiceQuestion>;
  timeoutMs: number;
};

export type ProviderSuccess = {
  ok: true;
  model: string;
  answers: Record<string, ChoiceAnswer>;
  usage: ProviderUsage;
  latencyMs: number;
};

export type ProviderFailure = {
  ok: false;
  error:
    | "timeout"
    | "overload"
    | "rate_limit"
    | "auth"
    | "invalid_response"
    | "network"
    | "validation";
  retryable: boolean;
  detail: string;
};

export type ProviderResult = ProviderSuccess | ProviderFailure;

export interface DecisionProvider {
  readonly id: "jev" | "fake";
  classify(input: ProviderInput): Promise<ProviderResult>;
}

export type Thresholds = {
  winProb: number;
  confidence: number;
};

export type MappingEntry = {
  sourceKey: string;
  fieldRole: FieldRole;
  roleName: string;
};

export type ProductMapping = {
  id: string;
  shopId: string;
  scope: string;
  version: string;
  status: "draft" | "active" | "superseded";
  productGids: string[];
  collectionGid: string | null;
  entries: MappingEntry[];
  createdAt: string;
};

export type RuleSet = {
  id: string;
  shopId: string;
  scope: string;
  version: string;
  status: "draft" | "active" | "superseded";
  requiredRoles: string[];
  maxGraphemes: number | null;
  allowedOptions: Record<string, string[]>;
  surfaces: string[] | null;
  handleOrderNotes: "operational" | "gift_unless_instruction" | "ignore";
  productOverrides: Record<
    string,
    Partial<Pick<RuleSet, "requiredRoles" | "maxGraphemes" | "allowedOptions" | "surfaces">>
  >;
  thresholds: Thresholds;
  createdAt: string;
};

export type ShopifyOrderLine = {
  lineItemGid: string;
  productGid: string;
  variantGid: string;
  title: string;
  quantity: number;
  selectedOptions: Record<string, string>;
  customAttributes: Array<{ key: string; value: string }>;
};

export type ShopifyOrder = {
  orderGid: string;
  displayNumber: string;
  updatedAt: string;
  cancelled: boolean;
  note: string;
  tags: string[];
  customerId: string | null;
  fulfillmentSummary: string;
  lineItems: ShopifyOrderLine[];
  paginationComplete: boolean;
};

export interface ShopifyAdapter {
  readonly kind: "live" | "demo";
  fetchOrder(shopId: string, orderGid: string): Promise<ShopifyOrder | null>;
  addTags(shopId: string, orderGid: string, tags: string[]): Promise<{ ok: boolean; error?: string }>;
  removeTags(shopId: string, orderGid: string, tags: string[]): Promise<{ ok: boolean; error?: string }>;
}

export type JobType =
  | "evaluate_order"
  | "tag_outbox"
  | "redact_customer"
  | "redact_shop"
  | "reconcile";

export type JobRecord = {
  id: string;
  type: JobType;
  shopId: string;
  installationGeneration: number;
  orderGid?: string;
  payload: Record<string, unknown>;
  runAfter: number;
  attempts: number;
  leasedUntil: number | null;
  status: "queued" | "running" | "done" | "cancelled";
};
