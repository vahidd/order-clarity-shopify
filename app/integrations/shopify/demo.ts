import type { ShopifyAdapter, ShopifyOrder } from "../../domain/types";

export class DemoShopifyAdapter implements ShopifyAdapter {
  readonly kind = "demo" as const;
  orders = new Map<string, ShopifyOrder>();
  tagWrites: Array<{ orderGid: string; add?: string[]; remove?: string[] }> = [];
  failNextTagWrite = false;
  tagWriteTimeoutAfterSuccess = false;
  actuallyApplied = new Map<string, Set<string>>();
  fetchCalls = 0;
  mutationBlocked = true;

  seed(order: ShopifyOrder) {
    this.orders.set(order.orderGid, structuredClone(order));
    this.actuallyApplied.set(order.orderGid, new Set(order.tags));
  }

  updateOrder(orderGid: string, patch: Partial<ShopifyOrder>) {
    const current = this.orders.get(orderGid);
    if (!current) return;
    this.orders.set(orderGid, { ...current, ...patch });
  }

  async fetchOrder(_shopId: string, orderGid: string): Promise<ShopifyOrder | null> {
    this.fetchCalls += 1;
    const order = this.orders.get(orderGid);
    return order ? structuredClone(order) : null;
  }

  async addTags(_shopId: string, orderGid: string, tags: string[]) {
    if (this.mutationBlocked && process.env.APP_MODE === "demo") {
      this.tagWrites.push({ orderGid, add: tags });
    }
    if (this.failNextTagWrite) {
      this.failNextTagWrite = false;
      return { ok: false, error: "timeout" };
    }
    const applied = this.actuallyApplied.get(orderGid) ?? new Set();
    for (const t of tags) applied.add(t);
    this.actuallyApplied.set(orderGid, applied);
    const order = this.orders.get(orderGid);
    if (order) order.tags = Array.from(applied);
    this.tagWrites.push({ orderGid, add: tags });
    if (this.tagWriteTimeoutAfterSuccess) {
      this.tagWriteTimeoutAfterSuccess = false;
      return { ok: false, error: "timeout_after_success" };
    }
    return { ok: true };
  }

  async removeTags(_shopId: string, orderGid: string, tags: string[]) {
    if (this.failNextTagWrite) {
      this.failNextTagWrite = false;
      return { ok: false, error: "timeout" };
    }
    const applied = this.actuallyApplied.get(orderGid) ?? new Set();
    for (const t of tags) applied.delete(t);
    this.actuallyApplied.set(orderGid, applied);
    const order = this.orders.get(orderGid);
    if (order) order.tags = Array.from(applied);
    this.tagWrites.push({ orderGid, remove: tags });
    if (this.tagWriteTimeoutAfterSuccess) {
      this.tagWriteTimeoutAfterSuccess = false;
      return { ok: false, error: "timeout_after_success" };
    }
    return { ok: true };
  }
}

export class LiveBlockedShopifyAdapter implements ShopifyAdapter {
  readonly kind = "demo" as const;
  async fetchOrder(): Promise<ShopifyOrder | null> {
    return null;
  }
  async addTags() {
    return { ok: false, error: "demo_mode_blocks_live_shopify" };
  }
  async removeTags() {
    return { ok: false, error: "demo_mode_blocks_live_shopify" };
  }
}
