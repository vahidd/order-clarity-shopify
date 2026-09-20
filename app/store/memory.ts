import { randomUUID } from "node:crypto";
import type {
  FindingState,
  HumanReviewState,
  JobRecord,
  OperatingMode,
  OnboardingStep,
  OverallLabel,
  ProcessingState,
  ProductMapping,
  ReasonCode,
  RuleSet,
  ShopStatus,
  StaffRole,
} from "../domain/types";
import type { OrderSnapshot } from "../domain/types";
import { encryptJson } from "../domain/crypto";

export type ShopRow = {
  id: string;
  domain: string;
  installationGeneration: number;
  mode: OperatingMode;
  timezone: string;
  status: ShopStatus;
  onboardingStep: OnboardingStep;
  onboarding: Record<string, unknown>;
  selectedProductGids: string[];
  collectionGid: string | null;
  collectionNeedsReview: boolean;
  webhookSecret: string;
};

export type AppUserRow = {
  id: string;
  shopId: string;
  verifiedStaffId: string;
  role: StaffRole;
  active: boolean;
  displayName: string;
};

export type OrderRow = {
  id: string;
  shopId: string;
  orderGid: string;
  displayNumber: string;
  currentSnapshotId: string | null;
  currentEvaluationId: string | null;
  rowVersion: number;
  processingState: ProcessingState;
  overallLabel: OverallLabel | null;
  uncheckedReason: ReasonCode | null;
  humanReview: HumanReviewState;
  assignee: string | null;
  lastEvaluatedAt: string | null;
  contentHash: string | null;
  customerId: string | null;
  lifecycle: "active" | "cancelled" | "redacted";
  productSummary: string;
  primaryReason: ReasonCode | null;
  issueCount: number;
  createdAt: string;
  snapshotRevision: number;
};

export type SnapshotRow = {
  id: string;
  shopId: string;
  orderId: string;
  revision: number;
  sourceHash: string;
  sourceUpdatedAt: string;
  encryptedPayload: string | null;
  payload: OrderSnapshot | null;
};

export type EvaluationRow = {
  id: string;
  shopId: string;
  snapshotId: string;
  orderId: string;
  mappingVersion: string;
  ruleVersion: string;
  promptVersion: string;
  evaluationVersion: string;
  provider: string;
  model: string | null;
  state: ProcessingState;
  overallLabel: OverallLabel;
  uncheckedReason: ReasonCode | null;
  encryptedRequest: string | null;
  encryptedResponse: string | null;
  current: boolean;
  createdAt: string;
};

export type FindingRow = {
  id: string;
  shopId: string;
  evaluationId: string;
  orderId: string;
  fingerprint: string;
  checkId: string;
  reasonCode: ReasonCode;
  itemRef: string | null;
  sourceRefs: string[];
  evidence: Record<string, string>;
  method: string;
  uncertain: boolean;
  templateId: string;
  state: FindingState;
  humanReview: HumanReviewState;
  rowVersion: number;
  winningProbability?: number;
  confidence?: number;
};

export type ReviewEventRow = {
  id: string;
  shopId: string;
  findingId: string | null;
  orderId: string;
  actorStaffId: string | null;
  action: string;
  note: string | null;
  timestamp: string;
};

export type AuditEventRow = {
  id: string;
  shopId: string;
  actorStaffId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  revision: number | null;
  metadata: Record<string, unknown>;
  timestamp: string;
};

export type WebhookReceiptRow = {
  shopId: string;
  installationGeneration: number;
  eventId: string;
  topic: string;
  status: "received" | "enqueued" | "duplicate";
  receivedAt: string;
};

export type UsageLedgerRow = {
  id: string;
  shopId: string;
  cycleId: string;
  orderGid: string;
  reservationId: string;
  state: "reserved" | "completed" | "released";
  completedAt: string | null;
};

export type SubscriptionRow = {
  shopId: string;
  providerId: string;
  plan: "trial" | "starter" | "growth";
  entitlement: number;
  cycleId: string;
  cycleStart: string;
  cycleEnd: string;
  status: "active" | "grace" | "paused" | "trial";
  graceUntil: string | null;
  lastVerifiedAt: string | null;
};

export type OutboxRow = {
  actionKey: string;
  shopId: string;
  orderGid: string;
  revision: number;
  actionType: "add" | "remove";
  tag: string;
  state: "pending" | "succeeded" | "failed";
  attempts: number;
  lastError: string | null;
};

export type MappingRow = ProductMapping;
export type RuleRow = RuleSet;

type Lock = Promise<void>;

export class MemoryStore {
  shops = new Map<string, ShopRow>();
  shopsByDomain = new Map<string, string>();
  users = new Map<string, AppUserRow>();
  mappings: MappingRow[] = [];
  rules: RuleRow[] = [];
  orders = new Map<string, OrderRow>();
  snapshots = new Map<string, SnapshotRow>();
  evaluations = new Map<string, EvaluationRow>();
  findings = new Map<string, FindingRow>();
  reviewEvents: ReviewEventRow[] = [];
  auditEvents: AuditEventRow[] = [];
  receipts = new Map<string, WebhookReceiptRow>();
  usage: UsageLedgerRow[] = [];
  subscriptions = new Map<string, SubscriptionRow>();
  outbox = new Map<string, OutboxRow>();
  jobs: JobRecord[] = [];
  encryptionSecret = "demo-encryption-key-not-for-production";

  private tail: Lock = Promise.resolve();

  async withTx<T>(fn: () => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.tail;
    this.tail = next;
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  now(): string {
    return new Date().toISOString();
  }

  createShop(partial: Partial<ShopRow> & { domain: string }): ShopRow {
    const id = partial.id ?? randomUUID();
    const row: ShopRow = {
      id,
      domain: partial.domain,
      installationGeneration: partial.installationGeneration ?? 1,
      mode: partial.mode ?? "observation",
      timezone: partial.timezone ?? "UTC",
      status: partial.status ?? "active",
      onboardingStep: partial.onboardingStep ?? "install",
      onboarding: partial.onboarding ?? {},
      selectedProductGids: partial.selectedProductGids ?? [],
      collectionGid: partial.collectionGid ?? null,
      collectionNeedsReview: partial.collectionNeedsReview ?? false,
      webhookSecret: partial.webhookSecret ?? "demo-webhook-secret",
    };
    this.shops.set(id, row);
    this.shopsByDomain.set(row.domain, id);
    this.queuePersist(() => this.persistShop(row));
    return row;
  }

  getShop(shopId: string): ShopRow | null {
    return this.shops.get(shopId) ?? null;
  }

  getShopByDomain(domain: string): ShopRow | null {
    const id = this.shopsByDomain.get(domain);
    return id ? this.shops.get(id) ?? null : null;
  }

  createUser(row: Omit<AppUserRow, "id"> & { id?: string }): AppUserRow {
    const full: AppUserRow = { id: row.id ?? randomUUID(), ...row };
    this.users.set(full.id, full);
    this.queuePersist(() => this.persistUser(full));
    return full;
  }

  getUser(shopId: string, staffId: string): AppUserRow | null {
    return [...this.users.values()].find((u) => u.shopId === shopId && u.verifiedStaffId === staffId && u.active) ?? null;
  }

  upsertMapping(mapping: MappingRow) {
    this.mappings = this.mappings.filter((m) => !(m.shopId === mapping.shopId && m.version === mapping.version && m.scope === mapping.scope));
    this.mappings.push(mapping);
    this.queuePersist(() => this.persistMapping(mapping));
  }

  activeMapping(shopId: string): MappingRow | null {
    return this.mappings.find((m) => m.shopId === shopId && m.status === "active") ?? null;
  }

  upsertRules(rules: RuleRow) {
    this.rules = this.rules.filter((r) => !(r.shopId === rules.shopId && r.version === rules.version && r.scope === rules.scope));
    this.rules.push(rules);
    this.queuePersist(() => this.persistRules(rules));
  }

  activeRules(shopId: string): RuleRow | null {
    return this.rules.find((r) => r.shopId === shopId && r.status === "active") ?? null;
  }

  getOrder(shopId: string, orderGid: string): OrderRow | null {
    return [...this.orders.values()].find((o) => o.shopId === shopId && o.orderGid === orderGid) ?? null;
  }

  getOrderById(shopId: string, id: string): OrderRow | null {
    const row = this.orders.get(id);
    if (!row || row.shopId !== shopId) return null;
    return row;
  }

  receiptKey(shopId: string, generation: number, eventId: string): string {
    return `${shopId}:${generation}:${eventId}`;
  }

  recordReceipt(row: WebhookReceiptRow): { duplicate: boolean } {
    const key = this.receiptKey(row.shopId, row.installationGeneration, row.eventId);
    if (this.receipts.has(key)) return { duplicate: true };
    this.receipts.set(key, row);
    this.queuePersist(() => this.persistReceipt(row));
    return { duplicate: false };
  }

  enqueueJob(job: Omit<JobRecord, "id"> & { id?: string }): JobRecord {
    const full: JobRecord = { id: job.id ?? randomUUID(), ...job };
    this.jobs.push(full);
    this.queuePersist(() => this.persistJob(full));
    return full;
  }

  nextJob(): JobRecord | null {
    const now = Date.now();
    const job = this.jobs.find((j) => j.status === "queued" && j.runAfter <= now);
    if (!job) return null;
    job.status = "running";
    job.leasedUntil = now + 5 * 60 * 1000;
    this.queuePersist(() => this.persistJob(job));
    return job;
  }

  addAudit(row: Omit<AuditEventRow, "id" | "timestamp"> & { timestamp?: string }) {
    const full: AuditEventRow = {
      id: randomUUID(),
      timestamp: row.timestamp ?? this.now(),
      ...row,
    };
    this.auditEvents.push(full);
    this.queuePersist(() => this.persistAudit(full));
  }

  encrypt(value: unknown): string {
    return encryptJson(value, this.encryptionSecret);
  }

  putSnapshot(row: Omit<SnapshotRow, "encryptedPayload"> & { encryptedPayload?: string | null }): SnapshotRow {
    const full: SnapshotRow = {
      ...row,
      encryptedPayload: row.payload ? this.encrypt(row.payload) : (row.encryptedPayload ?? null),
    };
    this.snapshots.set(full.id, full);
    this.queuePersist(() => this.persistSnapshot(full));
    return full;
  }

  saveShop(shop: ShopRow): ShopRow {
    this.shops.set(shop.id, shop);
    this.shopsByDomain.set(shop.domain, shop.id);
    this.queuePersist(() => this.persistShop(shop));
    return shop;
  }

  saveOrder(order: OrderRow): OrderRow {
    this.orders.set(order.id, order);
    this.queuePersist(() => this.persistOrder(order));
    return order;
  }

  saveFinding(finding: FindingRow): FindingRow {
    this.findings.set(finding.id, finding);
    this.queuePersist(() => this.persistFinding(finding));
    return finding;
  }

  saveEvaluation(evaluation: EvaluationRow): EvaluationRow {
    this.evaluations.set(evaluation.id, evaluation);
    this.queuePersist(() => this.persistEvaluation(evaluation));
    return evaluation;
  }

  saveUsage(row: UsageLedgerRow): UsageLedgerRow {
    const idx = this.usage.findIndex((u) => u.id === row.id);
    if (idx >= 0) this.usage[idx] = row;
    else this.usage.push(row);
    this.queuePersist(() => this.persistUsage(row));
    return row;
  }

  saveOutbox(row: OutboxRow): OutboxRow {
    this.outbox.set(row.actionKey, row);
    this.queuePersist(() => this.persistOutbox(row));
    return row;
  }

  saveSubscription(row: SubscriptionRow): SubscriptionRow {
    this.subscriptions.set(row.shopId, row);
    this.queuePersist(() => this.persistSubscription(row));
    return row;
  }

  saveJob(job: JobRecord): JobRecord {
    const idx = this.jobs.findIndex((j) => j.id === job.id);
    if (idx >= 0) this.jobs[idx] = job;
    else this.jobs.push(job);
    this.queuePersist(() => this.persistJob(job));
    return job;
  }

  addReviewEvent(row: Omit<ReviewEventRow, "id" | "timestamp"> & { id?: string; timestamp?: string }): ReviewEventRow {
    const full: ReviewEventRow = {
      id: row.id ?? randomUUID(),
      timestamp: row.timestamp ?? this.now(),
      shopId: row.shopId,
      findingId: row.findingId,
      orderId: row.orderId,
      actorStaffId: row.actorStaffId,
      action: row.action,
      note: row.note,
    };
    this.reviewEvents.push(full);
    this.queuePersist(() => this.persistReviewEvent(full));
    return full;
  }

  listUsers(shopId: string): AppUserRow[] {
    return [...this.users.values()].filter((u) => u.shopId === shopId);
  }

  listOrders(shopId: string): OrderRow[] {
    return [...this.orders.values()].filter((o) => o.shopId === shopId);
  }

  listFindings(shopId: string, orderId?: string): FindingRow[] {
    return [...this.findings.values()].filter((f) => f.shopId === shopId && (!orderId || f.orderId === orderId));
  }

  getFinding(shopId: string, id: string): FindingRow | null {
    const row = this.findings.get(id);
    if (!row || row.shopId !== shopId) return null;
    return row;
  }

  getSnapshot(id: string): SnapshotRow | null {
    return this.snapshots.get(id) ?? null;
  }

  getRule(shopId: string, id: string): RuleRow | null {
    return this.rules.find((r) => r.shopId === shopId && r.id === id) ?? null;
  }

  protected persistChain: Promise<void> = Promise.resolve();

  protected queuePersist(fn: () => Promise<void> | void) {
    this.persistChain = this.persistChain.then(async () => {
      await fn();
    });
  }

  async flush(): Promise<void> {
    await this.persistChain;
  }

  protected persistShop(_shop: ShopRow): Promise<void> | void {}
  protected persistUser(_user: AppUserRow): Promise<void> | void {}
  protected persistMapping(_mapping: MappingRow): Promise<void> | void {}
  protected persistRules(_rules: RuleRow): Promise<void> | void {}
  protected persistOrder(_order: OrderRow): Promise<void> | void {}
  protected persistSnapshot(_snap: SnapshotRow): Promise<void> | void {}
  protected persistEvaluation(_evaluation: EvaluationRow): Promise<void> | void {}
  protected persistFinding(_finding: FindingRow): Promise<void> | void {}
  protected persistUsage(_row: UsageLedgerRow): Promise<void> | void {}
  protected persistOutbox(_row: OutboxRow): Promise<void> | void {}
  protected persistSubscription(_row: SubscriptionRow): Promise<void> | void {}
  protected persistJob(_job: JobRecord): Promise<void> | void {}
  protected persistReceipt(_row: WebhookReceiptRow): Promise<void> | void {}
  protected persistReviewEvent(_row: ReviewEventRow): Promise<void> | void {}
  protected persistAudit(_row: AuditEventRow): Promise<void> | void {}
  protected persistInstallation(_row: {
    id: string;
    shopId: string;
    generation: number;
    encryptedToken: string;
    scopes: string;
    revokedAt: string | null;
  }): Promise<void> | void {}
}
