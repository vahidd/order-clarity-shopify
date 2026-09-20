import { randomUUID } from "node:crypto";
import type { OrderClarityRuntime } from "../services/runtime";
import { isAuthContext } from "../services/runtime";
import { detailHtml, overviewHtml, queueHtml, simplePage } from "./pages";
import type { OperatingMode, ResolveAction } from "../domain/types";

function json(status: number, body: unknown, requestId?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId ?? randomUUID(),
    },
  });
}

function html(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    return Object.fromEntries(new URLSearchParams(text));
  }
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function createHttpApp(runtime: OrderClarityRuntime) {
  return {
    runtime,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const { pathname } = url;

      if (pathname === "/healthz" || pathname === "/health") {
        return json(200, { ok: true, mode: runtime.config.mode, demo: runtime.config.mode === "demo" });
      }

      if (pathname === "/webhooks/shopify" && request.method === "POST") {
        const raw = Buffer.from(await request.arrayBuffer());
        const result = await runtime.handleWebhook(raw, request.headers);
        return json(result.status, result.body);
      }

      const auth = await runtime.authenticate(request.headers, url);
      if (!isAuthContext(auth)) {
        if (pathname.startsWith("/api/")) return json(auth.error, auth.body);
        if (runtime.config.mode === "demo" && pathname === "/") {
          return Response.redirect(new URL("/app", url).toString(), 302);
        }
        return json(auth.error, auth.body);
      }

      if (pathname === "/" || pathname === "/app" || pathname === "/app/overview") {
        const data = await runtime.overview(auth);
        if (request.headers.get("accept")?.includes("text/html") || !pathname.startsWith("/api")) {
          if (pathname === "/api/overview") {
            /* fall through */
          } else {
            return html(overviewHtml(data as Record<string, unknown>));
          }
        }
      }

      if (pathname === "/api/overview" && request.method === "GET") {
        return json(200, await runtime.overview(auth), auth.requestId);
      }

      if ((pathname === "/api/orders" || pathname === "/app/queue") && request.method === "GET") {
        const data = await runtime.queue(auth, url.searchParams);
        if (pathname === "/app/queue") return html(queueHtml(data));
        return json(200, data, auth.requestId);
      }

      const orderMatch = pathname.match(/^\/(api|app)\/orders\/([^/]+)$/);
      if (orderMatch && request.method === "GET") {
        const detail = await runtime.orderDetail(auth, decodeURIComponent(orderMatch[2]));
        if (!detail) return json(404, { error: "not_found", requestId: auth.requestId }, auth.requestId);
        if (orderMatch[1] === "app") return html(detailHtml(detail as never));
        return json(200, detail, auth.requestId);
      }

      const recheck = pathname.match(/^\/api\/orders\/([^/]+)\/recheck$/);
      if (recheck && request.method === "POST") {
        const order = (await runtime.store.getOrderById(auth.shopId, recheck[1])) ?? (await runtime.store.getOrder(auth.shopId, recheck[1]));
        if (!order) return json(404, { error: "not_found", requestId: auth.requestId }, auth.requestId);
        runtime.store.enqueueJob({
          type: "evaluate_order",
          shopId: auth.shopId,
          installationGeneration: auth.installationGeneration,
          orderGid: order.orderGid,
          payload: { manual: true },
          runAfter: Date.now(),
          attempts: 0,
          leasedUntil: null,
          status: "queued",
        });
        return json(200, { ok: true, queued: true, requestId: auth.requestId }, auth.requestId);
      }

      const resolveMatch = pathname.match(/^\/api\/findings\/([^/]+)\/(resolve|reopen)$/);
      if (resolveMatch && request.method === "POST") {
        const body = await readJson(request);
        const action = (resolveMatch[2] === "reopen" ? "reopen" : body.action) as ResolveAction;
        const result = await runtime.resolveFinding(auth, resolveMatch[1], {
          action,
          evaluationId: String(body.evaluationId ?? ""),
          rowVersion: Number(body.rowVersion),
          note: body.note ? String(body.note) : undefined,
          resolutionCategory: body.resolutionCategory ? String(body.resolutionCategory) : undefined,
          dismissReason: body.dismissReason ? String(body.dismissReason) : undefined,
        });
        return json(result.status, result.body, auth.requestId);
      }

      if (pathname === "/api/onboarding" && request.method === "GET") {
        return json(200, await runtime.getOnboarding(auth), auth.requestId);
      }

      if (pathname === "/api/onboarding/products" && request.method === "POST") {
        const body = await readJson(request);
        const raw = body.productGids;
        const productGids = Array.isArray(raw)
          ? (raw as string[])
          : String(raw ?? "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
        const result = await runtime.chooseProducts(auth, {
          productGids,
          collectionGid: (body.collectionGid as string | null) ?? null,
        });
        return json(result.status, result.body, auth.requestId);
      }

      if (pathname === "/api/onboarding/activate" && request.method === "POST") {
        const result = await runtime.completeOnboarding(auth);
        return json(result.status, result.body, auth.requestId);
      }

      if (pathname === "/api/mappings" && request.method === "POST") {
        const body = await readJson(request);
        const gidsRaw = body.productGids;
        const productGids = Array.isArray(gidsRaw)
          ? (gidsRaw as string[])
          : String(gidsRaw ?? "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
        const entries = Array.isArray(body.entries)
          ? body.entries
          : body.sourceKey
            ? [
                {
                  sourceKey: String(body.sourceKey),
                  fieldRole: "personalization_content",
                  roleName: String(body.roleName || "engraving"),
                },
              ]
            : [];
        const result = await runtime.saveMapping(auth, {
          ...(body as object),
          shopId: auth.shopId,
          productGids: productGids.length ? productGids : ((body.productGids as string[]) ?? []),
          entries,
        } as never);
        return json(result.status, result.body, auth.requestId);
      }

      if (pathname === "/api/rules" && request.method === "POST") {
        const body = await readJson(request);
        const surfaces = Array.isArray(body.surfaces)
          ? (body.surfaces as string[])
          : String(body.surfaces ?? "front")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
        const result = await runtime.saveRuleDraft(auth, {
          ...(body as object),
          surfaces,
          maxGraphemes: body.maxGraphemes === undefined ? undefined : Number(body.maxGraphemes),
        } as never);
        return json(result.status, result.body, auth.requestId);
      }

      const preview = pathname.match(/^\/api\/rules\/([^/]+)\/preview$/);
      if (preview && request.method === "POST") {
        const body = await readJson(request);
        const result = await runtime.previewRules(auth, preview[1], {
          orderGid: body.orderGid ? String(body.orderGid) : undefined,
        });
        return json(result.status, result.body, auth.requestId);
      }

      const activate = pathname.match(/^\/api\/rules\/([^/]+)\/activate$/);
      if (activate && request.method === "POST") {
        const result = await runtime.activateRules(auth, activate[1]);
        return json(result.status, result.body, auth.requestId);
      }

      if (pathname === "/api/audits" && request.method === "POST") {
        const body = await readJson(request);
        const count = Number(body.count ?? 20);
        return json(200, { ok: true, preview: { count, estimatedUsage: count }, started: Boolean(body.confirm) }, auth.requestId);
      }

      if (pathname === "/api/usage" && request.method === "GET") {
        return json(200, await runtime.usage(auth), auth.requestId);
      }

      if (pathname === "/api/billing/change" && request.method === "POST") {
        return json(200, {
          confirmationUrl: "https://admin.shopify.com/charges/orderclarity/confirm",
          labeled: runtime.config.mode === "demo" ? "Demo billing" : "Shopify billing",
        }, auth.requestId);
      }

      if (pathname === "/api/mode" && request.method === "POST") {
        const body = await readJson(request);
        const confirmed =
          (body.confirmedTags as string[] | undefined) ??
          (body.confirmTags === "yes" || body.confirmTags === "on"
            ? ["orderclarity:needs-review", "orderclarity:unchecked", "orderclarity:reviewed"]
            : undefined);
        const result = await runtime.setMode(auth, body.mode as OperatingMode, confirmed);
        return json(result.status, result.body, auth.requestId);
      }

      if (pathname === "/app/onboarding") {
        const data = await runtime.getOnboarding(auth);
        const current = (step: string) => (data.step === step ? " (current)" : "");
        return html(
          simplePage(
            "Onboarding",
            runtime.config.mode === "demo",
            `<h1>Onboarding</h1>
             <ol>
               <li>Install${current("install")}</li>
               <li>Choose products${current("choose_products")}</li>
               <li>Map fields${current("map_fields")}</li>
               <li>Define rules${current("define_rules")}</li>
               <li>Review sample${current("review_sample")}</li>
               <li>Activate${current("activate")}</li>
             </ol>
             <form method="post" action="/api/onboarding/products">
               <label>Product GIDs <input name="productGids" value="${(data.productGids || []).join(",")}" /></label>
               <button type="submit">Save products</button>
             </form>
             <form method="post" action="/api/onboarding/activate">
               <button type="submit">Activate onboarding</button>
             </form>
             <p>Progress is saved. Current step: ${data.step}.</p>`,
          ),
        );
      }

      if (pathname === "/app/mapping") {
        const mapping = (await runtime.store.activeMapping(auth.shopId)) ?? (await runtime.store.listMappings(auth.shopId))[0];
        return html(
          simplePage(
            "Mapping",
            true,
            `<h1>Field mapping</h1>
             <p>Roles: personalization content, operational request, gift message, selected option, ignored. Repeated keys are stored as ordered entries.</p>
             <form method="post" action="/api/mappings">
               <label>Product GIDs <input name="productGids" /></label>
               <label>Source key <input name="sourceKey" value="Engraving" /></label>
               <label>Role name <input name="roleName" value="engraving" /></label>
               <button type="submit">Save draft mapping</button>
             </form>
             <pre>${JSON.stringify(mapping, null, 2)}</pre>`,
          ),
        );
      }

      if (pathname === "/app/rules") {
        const rules = await runtime.store.listRules(auth.shopId);
        const latest = rules[rules.length - 1];
        return html(
          simplePage(
            "Rules",
            true,
            `<h1>Rules</h1>
             <p>Draft, validate, preview, then activate. Preview evaluates a sample without activating or writing tags. Active versions are immutable. Product-specific overrides win over family defaults. Conflicting rules block activation.</p>
             <form method="post" action="/api/rules">
               <label>Max graphemes <input name="maxGraphemes" value="20" /></label>
               <label>Surfaces <input name="surfaces" value="front" /></label>
               <button type="submit">Save draft</button>
             </form>
             ${
               latest
                 ? `<form method="post" action="/api/rules/${latest.id}/preview"><button type="submit">Preview sample</button></form>
                    <form method="post" action="/api/rules/${latest.id}/activate"><button type="submit">Activate</button></form>`
                 : ""
             }
             <pre>${JSON.stringify(rules, null, 2)}</pre>`,
          ),
        );
      }

      if (pathname === "/app/billing") {
        const usage = await runtime.usage(auth);
        return html(
          simplePage(
            "Billing",
            true,
            `<h1>Billing</h1>
             <p>Plan ${usage.plan}: ${usage.consumed} / ${usage.entitlement} in this cycle. Status: ${usage.status}. Existing reviews remain available when scanning is paused.</p>`,
          ),
        );
      }

      if (pathname === "/app/staff") {
        const users = await runtime.store.listUsers(auth.shopId);
        return html(
          simplePage(
            "Staff",
            true,
            `<h1>Staff access</h1>
             <ul>${users.map((u) => `<li>${u.displayName} — ${u.role} (${u.verifiedStaffId})</li>`).join("")}</ul>
             <p>Unidentified staff cannot be defaulted to Owner.</p>`,
          ),
        );
      }

      if (pathname === "/app/settings") {
        const shop = await runtime.store.getShop(auth.shopId);
        return html(
          simplePage(
            "Settings",
            true,
            `<h1>Settings</h1>
             <p>Mode: ${shop?.mode}. Default is Observation (internal findings only, no order tags).</p>
             <p>Assisted review writes only: orderclarity:needs-review, orderclarity:unchecked, orderclarity:reviewed.</p>
             <form method="post" action="/api/mode">
               <label>Mode
                 <select name="mode">
                   <option value="observation">Observation</option>
                   <option value="assisted_review">Assisted review</option>
                 </select>
               </label>
               <label><input type="checkbox" name="confirmTags" value="yes" /> Confirm tags</label>
               <button type="submit">Save</button>
             </form>`,
          ),
        );
      }

      if (pathname === "/app") {
        return html(overviewHtml((await runtime.overview(auth)) as Record<string, unknown>));
      }

      return json(404, { error: "not_found", requestId: auth.requestId }, auth.requestId);
    },
  };
}
