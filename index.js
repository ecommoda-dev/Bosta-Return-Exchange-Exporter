// ═══════════════════════════════════════════════════════════════
// Bosta Return/Exchange Exporter — Worker v5.0.0
// EcomModa Internal Tools
// skills: worker-builder v2.0.0 · html-builder v6.0.0 · order-lifecycle v1.2.0 · constants v1.4.3 — 02-09-2026
// ═══════════════════════════════════════════════════════════════
//
// v5.0.0 (paired with the HTML's full html-builder v6.0.0 UI migration —
// 02-09-2026): get_logs / get_logs_count / get_logs_export now take CSV
// multi-value `employees` and `types` params (?types=scan,export_return)
// instead of single `employee`/`type` strings, via a shared
// buildLogFilterSQL() helper — the HTML's log tab filters are now
// multi-select (html-builder Log Filter Model v2). This is a breaking
// query-param rename for anyone calling this Worker directly.
//
// v4.1.0 (skill-compliance pass — 02-09-2026):
// - Added `?action=diag` and `?action=get_config` — mandatory for any Worker
//   that writes (this one does metafieldsSet) per worker-builder Step 5A ⑨.
//   Neither endpoint returns secret values — names/lengths only.
// - Order objects returned by fetch_candidates now carry a numeric `orderId`
//   (from `legacyResourceId`) alongside the GID `id`, per the mandatory
//   "numeric order ID" rule — lets the HTML build a real Shopify hyperlink
//   instead of guessing one.
// - get_logs_export now returns `{ entries, cap, total, truncated }` instead
//   of just `entries`, so a capped export can no longer silently claim
//   "تم تصدير N عملية ✓" on a file that isn't the whole matching set.
// - get_logs_count / get_logs_export now accept the same `type` filter as
//   get_logs — previously the log tab's "total" count and the XLSX export
//   silently ignored the type filter (count included all types; export was
//   filtered client-side after already being capped server-side, which
//   could report a truncated-but-wrong subset). Both endpoints — and the
//   HTML calling them — now filter type server-side.
//
// v4.0.0 (UX overhaul, HTML-side — paired with this Worker):
// - confirm_upload now accepts an optional `checklist` object from the
//   new checkbox-gated confirmation modal (bostaUploaded / invoicesSent)
//   and folds it into both log entries as an audit trail. The checklist
//   is NEVER used to gate the write server-side — the HTML modal is
//   what gates the button; this is a display/audit convenience only.
// - record_manual_confirmation is no longer called by the HTML (the
//   two-step exchange confirm was merged into the single confirm_upload
//   step). The endpoint itself is left in place, unused, in case it's
//   needed again — nothing else in the stack calls it.
//
// Required bindings / vars:
// - DB              D1 binding
// - WORKER_SECRET   secret
// - SHOP_DOMAIN     6c7e1a-53.myshopify.com
// - CLIENT_ID       Shopify OAuth client id
// - CLIENT_SECRET   Shopify OAuth client secret
//
// Shopify metafields used:
// - custom.status_2_r_e      (S2)
// - custom.printing_time_s2  (وقت وتاريخ تحديث S2)
// - custom.courier           (مندوب)
//
// v3.3.0 CHANGELOG (review fixes — 06-08-2026):
// - Every S2 write now ALSO logs to tool='metafields_change' (was only
//   logged under this tool's own name before — cross-tool cycle-time /
//   R-E-cycle-count KPIs had a permanent hole).
// - printing_time_s2 is now truncated to whole seconds before writing,
//   so verifyManualStatus's ms-exact comparison can't false-fail on
//   Shopify silently dropping sub-second precision.
// - CORS switched from wildcard '*' to strict ALLOWED_ORIGINS — this
//   Worker performs metafieldsSet writes on live orders, which puts it
//   in the "write tool" bucket per cors-patterns.md, not "read-only".
// - GraphQL alias renamed manualStatus → s2Status everywhere (including
//   the wire payload from the HTML) — the old name collided with S1's
//   custom.manual_status naming convention used elsewhere in the stack.
// - get_logs reverted to the canonical shared-functions.md version
//   (excludes login/logout in SQL, 100/page) + added get_logs_count and
//   get_logs_export, per the mandatory 3-endpoint log tab pattern.
// - Section Tags added throughout; §LOG-ENDPOINTS moved to the end of
//   the handler (was interleaved inside §AUTH before).
//
// KNOWN INTENTIONAL EXCEPTION (confirmed with Ahmed, 06-08-2026):
// Per ecommoda-order-lifecycle/state-machines.md, S2 = 'In-Return' is
// documented as "Bosta only" (set automatically by courier sync). This
// Worker's Return flow instead writes 'In-Return' manually, the moment
// staff confirm the Bosta-dashboard upload, as ONE combined step. This
// is a deliberate simplification for this specific tool — there is no
// live Bosta→Shopify auto-sync feeding S2 yet, so the manual confirm
// is the only trigger available. Revisit if/when that sync exists.
//
// ═══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// §CONSTANTS
// ══════════════════════════════════════════════════════
const TOOL_NAME = 'bosta_exchange_export';
const WORKER_VERSION = '5.0.0';
const SHOPIFY_API_VERSION = '2026-01';
const LOG_EXPORT_MAX = 2000;

const STATUS_BY_JOB = {
  return:   'Confirmed + RETURN',
  exchange: 'Confirmed + EXCHANGE',
};

const NEXT_STATUS_BY_JOB = {
  return:   'In-Return',
  exchange: 'Ready',
};

const EXPORT_TYPES = ['export_return', 'export_exchange'];

const DISCOVERY_PAGE_SIZE = 100;
const DISCOVERY_MAX_PAGES = 10;
const DETAILS_BATCH_SIZE = 50;

// ══════════════════════════════════════════════════════
// §CORS — Option B (strict) — this Worker writes order metafields
// ══════════════════════════════════════════════════════
const ALLOWED_ORIGINS = [
  'https://ecommoda-dev.github.io',
];

function getCORS(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

// ══════════════════════════════════════════════════════
// §HELPERS
// ══════════════════════════════════════════════════════
function json(data, status = 200, request = null) {
  const headers = { 'Content-Type': 'application/json' };
  Object.assign(headers, request ? getCORS(request) : { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0] });
  return new Response(JSON.stringify(data), { status, headers });
}

function assertPost(request) {
  if (request.method !== 'POST') {
    const err = new Error('POST required');
    err.status = 405;
    throw err;
  }
}

function cleanText(v) {
  return String(v ?? '').trim();
}

// Parses a CSV query param (?employees=ahmed,sara) into a clean string array.
function csvParam(url, key) {
  return (url.searchParams.get(key) || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

// Truncates to whole seconds so a value written now and re-read later
// compare equal even if Shopify drops sub-second precision on date_time.
function nowToSecond() {
  return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
}

function normalizeOrderPayload(orders) {
  if (!Array.isArray(orders)) return [];
  const seen = new Set();
  const out = [];
  for (const o of orders) {
    const id = cleanText(o?.id);
    const name = cleanText(o?.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      s2Status: cleanText(o?.s2Status),
      courier: cleanText(o?.courier),
    });
  }
  return out;
}

function getJobConfig(jobType) {
  const jt = cleanText(jobType);
  if (!STATUS_BY_JOB[jt]) {
    const err = new Error('نوع العملية غير صحيح — استخدم return أو exchange');
    err.status = 400;
    throw err;
  }
  return {
    jobType: jt,
    expectedStatus: STATUS_BY_JOB[jt],
    nextStatus: NEXT_STATUS_BY_JOB[jt],
    exportType: jt === 'return' ? 'export_return' : 'export_exchange',
    manualConfirmType: jt === 'return' ? 'manual_confirm_return' : 'manual_confirm_exchange',
    confirmType: jt === 'return' ? 'confirm_return' : 'confirm_exchange',
    label: jt === 'return' ? 'استرجاع' : 'استبدال',
  };
}

function escapeShopifySearchValue(value) {
  return JSON.stringify(String(value));
}

function buildCandidateSearchQuery(expectedStatus) {
  return [
    `metafields.custom.status_2_r_e:${escapeShopifySearchValue(expectedStatus)}`,
    `metafields.custom.courier:Bosta`,
  ].join(' AND ');
}

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isShopifyCostError(err) {
  return /cost|exceeds the single query max cost limit|maximum cost/i.test(err?.message || String(err));
}

// Numeric order id for HTML-side Shopify hyperlinks — prefers legacyResourceId
// (returned by the queries below), falls back to parsing the GID.
function numericOrderId(order) {
  const legacy = cleanText(order?.legacyResourceId);
  if (legacy) return legacy;
  return cleanText(order?.id).split('/').pop() || null;
}

// ══════════════════════════════════════════════════════
// §SHARED — copy verbatim from ecommoda-worker-builder — never modify
// ══════════════════════════════════════════════════════
async function verifyEmployee(db, username, pin) {
  const row = await db.prepare(
    'SELECT display_name, is_active FROM employees WHERE username = ? AND pin = ?',
  ).bind(username, pin).first();

  if (!row) return null;

  if (!row.is_active) {
    throw new Error('الحساب موقوف — تواصل مع المسؤول');
  }

  db.prepare('UPDATE employees SET last_login = ? WHERE username = ?')
    .bind(new Date().toISOString(), username)
    .run()
    .catch(() => {});

  return row.display_name;
}

async function checkEmployee(db, username) {
  const row = await db.prepare(
    'SELECT is_active, pin FROM employees WHERE username = ?',
  ).bind(username).first();

  if (!row) return { exists: false, hasPin: false, isActive: false };
  return {
    exists:   true,
    hasPin:   !!row.pin,
    isActive: !!row.is_active,
  };
}

async function registerPin(db, username, pin) {
  const row = await db.prepare(
    'SELECT pin, is_active FROM employees WHERE username = ?',
  ).bind(username).first();

  if (!row)            throw new Error('اسم المستخدم غير موجود');
  if (!row.is_active)  throw new Error('الحساب موقوف — تواصل مع المسؤول');
  if (row.pin)         throw new Error('هذا المستخدم مسجّل بالفعل — تواصل مع المسؤول لإعادة الضبط');

  await db.prepare('UPDATE employees SET pin = ? WHERE username = ?')
    .bind(pin, username)
    .run();

  return true;
}

async function writeLog(db, entry) {
  await db.prepare(`
    INSERT INTO logs
      (timestamp, tool, type, employee, order_id, order_name,
       sku, product_title, delta, value_before, value_after, notes, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.timestamp    ?? new Date().toISOString(),
    entry.tool,
    entry.type,
    entry.employee     ?? null,
    entry.orderId      ?? null,
    entry.orderName    ?? null,
    entry.sku          ?? null,
    entry.productTitle ?? null,
    entry.delta        ?? null,
    entry.valueBefore  ?? null,
    entry.valueAfter   ?? null,
    entry.notes        ?? null,
    entry.extra ? JSON.stringify(entry.extra) : null,
  ).run();
}

// buildLogFilterSQL — shared WHERE-clause builder for getLogs/getLogsCount/
// getLogsExport. `employees`/`types` are arrays (from CSV query params) so the
// HTML's multi-select log filters (html-builder Log Filter Model v2) can pass
// more than one value per filter — a single `employee`/`type` string still
// works too (treated as a 1-element list).
function buildLogFilterSQL({ tool = null, employees = [], types = [], search = null } = {}) {
  let sql = "WHERE type NOT IN ('login','logout')";
  const b = [];

  if (tool) { sql += ' AND tool = ?'; b.push(tool); }
  if (employees?.length) { sql += ` AND employee IN (${employees.map(() => '?').join(',')})`; b.push(...employees); }
  if (types?.length)     { sql += ` AND type IN (${types.map(() => '?').join(',')})`;         b.push(...types); }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ?)';
    b.push(`%${search}%`, `%${search}%`);
  }

  return { sql, b };
}

// getLogs — canonical: login/logout excluded in SQL, max 100/page.
async function getLogs(db, {
  tool      = null,
  employees = [],
  types     = [],
  search    = null,
  limit     = 100,
  offset    = 0,
} = {}) {
  const { sql: where, b } = buildLogFilterSQL({ tool, employees, types, search });
  const sql = `SELECT * FROM logs ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
  b.push(Math.min(limit, 100), offset);

  return (await db.prepare(sql).bind(...b).all()).results;
}

// getLogsCount — call in parallel with getLogs() for pagination UI.
// Must accept every filter getLogs() accepts, or the displayed total silently
// stops matching what's on screen (html-builder Standards #31).
async function getLogsCount(db, { tool = null, employees = [], types = [], search = null } = {}) {
  const { sql: where, b } = buildLogFilterSQL({ tool, employees, types, search });
  const row = await db.prepare(`SELECT COUNT(*) as total FROM logs ${where}`).bind(...b).first();
  return row?.total ?? 0;
}

// getLogsExport — XLSX export only, up to LOG_EXPORT_MAX rows. Never use
// getLogs() for this. Returns { entries, cap, total, truncated } — the caller
// (HTML) must show `truncated` explicitly rather than reporting the export as
// complete (html-builder Standards #30 — a capped export must never render as
// an unconditional "تم تصدير N عملية ✓").
async function getLogsExport(db, { tool = null, employees = [], types = [], search = null } = {}) {
  const { sql: where, b } = buildLogFilterSQL({ tool, employees, types, search });
  const total = await getLogsCount(db, { tool, employees, types, search });

  const sql = `SELECT * FROM logs ${where} ORDER BY timestamp DESC LIMIT ?`;
  const entries = (await db.prepare(sql).bind(...b, LOG_EXPORT_MAX).all()).results;

  return {
    entries,
    cap: LOG_EXPORT_MAX,
    total,
    truncated: total > entries.length,
  };
}

// Non-canonical helper (this tool's own addition, not part of §SHARED) —
// batches multiple writeLog-shaped entries into one D1 batch() call.
async function writeLogsBatch(db, entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  for (const group of chunks(entries, 40)) {
    await db.batch(group.map((entry) => db.prepare(`
      INSERT INTO logs
        (timestamp, tool, type, employee, order_id, order_name,
         sku, product_title, delta, value_before, value_after, notes, extra)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      entry.timestamp    ?? new Date().toISOString(),
      entry.tool,
      entry.type,
      entry.employee     ?? null,
      entry.orderId      ?? null,
      entry.orderName    ?? null,
      entry.sku          ?? null,
      entry.productTitle ?? null,
      entry.delta        ?? null,
      entry.valueBefore  ?? null,
      entry.valueAfter   ?? null,
      entry.notes        ?? null,
      entry.extra ? JSON.stringify(entry.extra) : null,
    )));
  }
}

async function findExportDuplicateStats(db, orderNames) {
  const names = [...new Set((orderNames || []).map(cleanText).filter(Boolean))];
  if (!names.length) return {};

  const out = {};
  const exportTypePlaceholders = EXPORT_TYPES.map(() => '?').join(',');

  for (const group of chunks(names, 80)) {
    const namePlaceholders = group.map(() => '?').join(',');
    const sql = `
      SELECT
        order_name,
        COUNT(*) AS export_count,
        MAX(timestamp) AS last_export_at
      FROM logs
      WHERE tool = ?
        AND order_name IN (${namePlaceholders})
        AND type IN (${exportTypePlaceholders})
      GROUP BY order_name
      ORDER BY last_export_at DESC
    `;

    const rows = (await db.prepare(sql).bind(TOOL_NAME, ...group, ...EXPORT_TYPES).all()).results || [];
    for (const row of rows) {
      if (!row.order_name) continue;
      out[row.order_name] = {
        orderName: row.order_name,
        exportCount: Number(row.export_count || 0),
        lastExportAt: row.last_export_at || null,
      };
    }
  }

  return out;
}

// ══════════════════════════════════════════════════════
// §SHOPIFY
// ══════════════════════════════════════════════════════
async function getAccessToken(env) {
  const resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/oauth/access_token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      client_id:     env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      grant_type:    'client_credentials',
    }),
  });

  if (!resp.ok) throw new Error(`OAuth failed: ${resp.status}`);

  const data = await resp.json();
  if (!data.access_token) throw new Error('No access_token in OAuth response');
  return data.access_token;
}

async function shopifyGQL(env, token, query, variables = {}) {
  const resp = await fetch(
    `https://${env.SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    throw new Error(`Shopify GraphQL HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  if (data.errors?.length) {
    throw new Error(`GraphQL error: ${data.errors.map(e => e.message).join(' | ')}`);
  }

  return data;
}

// ─── §SHOPIFY::discoveryAndDetails ───
function buildDetailsQuery(jobType) {
  const returnFields = jobType === 'return' ? `
    returns(first: 5) {
      edges {
        node {
          returnLineItems(first: 25) {
            edges {
              node {
                quantity
                ... on ReturnLineItem {
                  fulfillmentLineItem {
                    lineItem {
                      sku
                      name
                      originalUnitPriceSet { shopMoney { amount } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  ` : '';

  const exchangeFields = jobType === 'exchange' ? `
    returns(first: 5) {
      edges {
        node {
          returnLineItems(first: 25) {
            edges {
              node {
                quantity
                ... on ReturnLineItem {
                  fulfillmentLineItem {
                    lineItem {
                      sku
                      name
                      originalUnitPriceSet { shopMoney { amount } }
                    }
                  }
                }
              }
            }
          }
          exchangeLineItems(first: 25) {
            edges {
              node {
                quantity
                lineItems {
                  sku
                  name
                  originalUnitPriceSet { shopMoney { amount } }
                }
              }
            }
          }
        }
      }
    }
  ` : '';

  return `
    query FetchBostaReturnExchangeDetails($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Order {
          id
          legacyResourceId
          name
          phone
          email
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          totalOutstandingSet { shopMoney { amount currencyCode } }
          shippingAddress {
            name
            phone
            address1
            address2
            city
            province
            zip
          }
          customer {
            firstName
            lastName
            email
            phone
          }
          s2Status: metafield(namespace: "custom", key: "status_2_r_e") { value }
          courier: metafield(namespace: "custom", key: "courier") { value }
          ${returnFields}
          ${exchangeFields}
        }
      }
    }
  `;
}

async function fetchDiscoveryOrders(env, token, job) {
  const candidates = [];
  let cursor = null;
  let hasNextPage = true;
  let page = 0;
  const search = buildCandidateSearchQuery(job.expectedStatus);

  const query = `
    query FetchBostaReturnExchangeCandidateIds($search: String!, $cursor: String) {
      orders(first: ${DISCOVERY_PAGE_SIZE}, after: $cursor, query: $search, sortKey: CREATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            legacyResourceId
            name
            s2Status: metafield(namespace: "custom", key: "status_2_r_e") { value }
            courier: metafield(namespace: "custom", key: "courier") { value }
          }
        }
      }
    }
  `;

  while (hasNextPage && page < DISCOVERY_MAX_PAGES) {
    page += 1;

    const data = await shopifyGQL(env, token, query, { search, cursor });
    const conn = data?.data?.orders;
    if (!conn?.edges) throw new Error('Shopify response missing orders connection');

    for (const edge of conn.edges) {
      const order = edge.node;
      const directStatus = cleanText(order?.s2Status?.value);
      const courier = cleanText(order?.courier?.value);

      if (directStatus === job.expectedStatus && courier.toLowerCase() === 'bosta') {
        candidates.push({
          id: order.id,
          name: order.name,
          s2Status: { value: directStatus },
          courier: { value: courier },
        });
      }
    }

    hasNextPage = !!conn.pageInfo?.hasNextPage;
    cursor = conn.pageInfo?.endCursor || null;
  }

  return {
    candidates,
    pageInfo: {
      pagesFetched: page,
      stoppedByLimit: hasNextPage && page >= DISCOVERY_MAX_PAGES,
      searchQuery: search,
      pageSize: DISCOVERY_PAGE_SIZE,
      maxPages: DISCOVERY_MAX_PAGES,
    },
  };
}

async function fetchDetailsGroup(env, token, ids, jobType) {
  const query = buildDetailsQuery(jobType);
  const data = await shopifyGQL(env, token, query, { ids });
  return (data?.data?.nodes || []).filter(Boolean);
}

async function fetchDetailsGroupWithFallback(env, token, ids, jobType) {
  if (!ids.length) return [];

  try {
    return await fetchDetailsGroup(env, token, ids, jobType);
  } catch (err) {
    if (!isShopifyCostError(err) || ids.length === 1) throw err;

    const mid = Math.ceil(ids.length / 2);
    const left = await fetchDetailsGroupWithFallback(env, token, ids.slice(0, mid), jobType);
    const right = await fetchDetailsGroupWithFallback(env, token, ids.slice(mid), jobType);
    return [...left, ...right];
  }
}

async function fetchCandidateOrders(env, token, job) {
  const discovery = await fetchDiscoveryOrders(env, token, job);
  const ids = discovery.candidates.map(o => o.id);
  const orders = [];
  let fallbackPossible = false;

  for (const group of chunks(ids, DETAILS_BATCH_SIZE)) {
    const details = await fetchDetailsGroupWithFallback(env, token, group, job.jobType);
    if (details.length !== group.length) fallbackPossible = true;

    for (const order of details) {
      const directStatus = cleanText(order?.s2Status?.value);
      const courier = cleanText(order?.courier?.value);
      if (directStatus === job.expectedStatus && courier.toLowerCase() === 'bosta') {
        // orderId: numeric legacy id, for the HTML to build a Shopify hyperlink
        // (worker-builder Step 5 — "numeric order ID" rule).
        orders.push({ ...order, orderId: numericOrderId(order) });
      }
    }
  }

  return {
    orders,
    pageInfo: {
      ...discovery.pageInfo,
      discoveryCount: discovery.candidates.length,
      detailBatchSize: DETAILS_BATCH_SIZE,
      detailsFetched: orders.length,
      detailsFallbackPossible: fallbackPossible,
    },
  };
}

// ─── §SHOPIFY::writeAndVerifyS2 ───
async function setManualStatus(env, token, orders, newValue, printingTimeS2) {
  const updated = [];
  const mutation = `
    mutation SetManualStatusAndPrintingTimeS2($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          value
          owner {
            ... on Order { id name }
          }
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  // كل أوردر بيكتب 2 metafields:
  // 1) custom.status_2_r_e
  // 2) custom.printing_time_s2
  // لذلك نستخدم 12 أوردر في الباتش = 24 metafields.
  for (const group of chunks(orders, 12)) {
    const variables = {
      metafields: group.flatMap((order) => ([
        {
          ownerId: order.id,
          namespace: 'custom',
          key: 'status_2_r_e',
          type: 'single_line_text_field',
          value: newValue,
        },
        {
          ownerId: order.id,
          namespace: 'custom',
          key: 'printing_time_s2',
          type: 'date_time',
          value: printingTimeS2,
        },
      ])),
    };

    const data = await shopifyGQL(env, token, mutation, variables);
    const result = data?.data?.metafieldsSet;
    if (result?.userErrors?.length) {
      const message = result.userErrors.map(e => `${e.field?.join('.') || 'field'}: ${e.message}`).join(' | ');
      throw new Error(`Shopify metafieldsSet error: ${message}`);
    }

    updated.push(...(result?.metafields || []));
  }

  return updated;
}

async function verifyManualStatus(env, token, orders, expectedValue, expectedPrintingTimeS2) {
  const query = `
    query VerifyManualStatusAndPrintingTimeS2($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Order {
          id
          name
          s2Status: metafield(namespace: "custom", key: "status_2_r_e") {
            value
          }
          printingTimeS2: metafield(namespace: "custom", key: "printing_time_s2") {
            value
          }
        }
      }
    }
  `;

  const mismatches = [];
  const expectedPrintingMs = Date.parse(expectedPrintingTimeS2);

  for (const group of chunks(orders, 100)) {
    const data = await shopifyGQL(env, token, query, { ids: group.map(o => o.id) });
    const nodes = data?.data?.nodes || [];

    for (const node of nodes) {
      if (!node?.id) continue;

      const value = cleanText(node?.s2Status?.value);
      const printingTimeS2 = cleanText(node?.printingTimeS2?.value);
      const actualPrintingMs = Date.parse(printingTimeS2);
      const printingTimeMatches =
        Number.isFinite(expectedPrintingMs) &&
        Number.isFinite(actualPrintingMs) &&
        actualPrintingMs === expectedPrintingMs;

      if (value !== expectedValue || !printingTimeMatches) {
        mismatches.push({
          id: node.id,
          name: node.name,
          value,
          printingTimeS2,
        });
      }
    }
  }

  return mismatches;
}

// ══════════════════════════════════════════════════════
// §HANDLER
// ══════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    // 1. CORS Preflight — always first
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCORS(request) });
    }

    // 2. WORKER_SECRET check — always second
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.WORKER_SECRET}`) {
      return json({ ok: false, error: 'Unauthorized' }, 401, request);
    }

    const url = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    try {
      // ─── §AUTH ────────────────────────────────────────────
      if (action === 'check_employee') {
        const username = url.searchParams.get('username');
        if (!username) return json({ ok: false, error: 'username مطلوب' }, 400, request);
        const result = await checkEmployee(env.DB, username);
        return json({ ok: true, ...result }, 200, request);
      }

      if (action === 'register_pin') {
        assertPost(request);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);
        await registerPin(env.DB, username, pin);
        return json({ ok: true }, 200, request);
      }

      if (action === 'verify_employee') {
        assertPost(request);
        const { username, pin } = await request.json().catch(() => ({}));
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);

        const displayName = await verifyEmployee(env.DB, username, pin);
        if (!displayName) return json({ ok: false, error: 'PIN خطأ أو المستخدم غير موجود' }, 401, request);

        await writeLog(env.DB, {
          tool: TOOL_NAME,
          type: 'login',
          employee: username,
          notes: `دخول: ${displayName}`,
        });

        return json({ ok: true, displayName }, 200, request);
      }

      if (action === 'log_logout') {
        const username = url.searchParams.get('username');
        if (username) {
          await writeLog(env.DB, {
            tool: TOOL_NAME,
            type: 'logout',
            employee: username,
            notes: `خروج: ${username.replace(/_/g, ' ')}`,
          });
        }
        return json({ ok: true }, 200, request);
      }

      if (action === 'get_employees') {
        const { results } = await env.DB.prepare(
          'SELECT username, display_name FROM employees WHERE is_active = 1 ORDER BY display_name',
        ).all();

        return json({ ok: true, employees: results || [] }, 200, request);
      }
      // ──────────────────────────────────────────────────────

      // ─── §EXPORT — candidate discovery + Excel export tracking ───
      if (action === 'fetch_candidates' || action === '') {
        assertPost(request);

        const body = await request.json().catch(() => ({}));
        const job = getJobConfig(body.jobType);
        const employee = cleanText(body.employee);

        const token = await getAccessToken(env);
        const result = await fetchCandidateOrders(env, token, job);

        await writeLog(env.DB, {
          tool: TOOL_NAME,
          type: 'scan',
          employee: employee || null,
          notes: `فحص ${job.label}: ${result.orders.length} أوردر مطابق`,
          extra: {
            jobType: job.jobType,
            expectedStatus: job.expectedStatus,
            courier: 'Bosta',
            duplicateCheckMode: 'export_only_on_excel_click',
            pageInfo: result.pageInfo,
          },
        });

        return json({
          ok: true,
          jobType: job.jobType,
          expectedStatus: job.expectedStatus,
          nextStatus: job.nextStatus,
          orders: result.orders,
          duplicates: {},
          duplicateCheckMode: 'export_only_on_excel_click',
          pageInfo: result.pageInfo,
        }, 200, request);
      }

      if (action === 'record_manual_confirmation') {
        assertPost(request);

        const body = await request.json().catch(() => ({}));
        const job = getJobConfig(body.jobType);
        const employee = cleanText(body.employee);
        const orders = normalizeOrderPayload(body.orders);

        if (!employee) return json({ ok: false, error: 'employee مطلوب' }, 400, request);
        if (!orders.length) return json({ ok: false, error: 'لا توجد أوردرات للتأكيد اليدوي' }, 400, request);

        const now = new Date().toISOString();
        await writeLogsBatch(env.DB, orders.map((order) => ({
          timestamp: now,
          tool: TOOL_NAME,
          type: job.manualConfirmType,
          employee,
          orderId: order.id,
          orderName: order.name,
          valueBefore: order.s2Status || job.expectedStatus,
          valueAfter: order.s2Status || job.expectedStatus,
          notes: job.jobType === 'exchange'
            ? 'تأكيد يدوي: تم رفع الأوردر على داشبورد بوسطة وإرسال الفاتورة للمخزن'
            : 'تأكيد يدوي: تم رفع الأوردر على داشبورد بوسطة',
          extra: {
            jobType: job.jobType,
            expectedStatus: job.expectedStatus,
            courier: order.courier || 'Bosta',
            manualConfirmation: true,
          },
        })));

        return json({
          ok: true,
          count: orders.length,
        }, 200, request);
      }

      if (action === 'check_export_duplicates') {
        assertPost(request);

        const body = await request.json().catch(() => ({}));
        getJobConfig(body.jobType);
        const orders = normalizeOrderPayload(body.orders);

        if (!orders.length) return json({ ok: false, error: 'لا توجد أوردرات لفحص التكرار' }, 400, request);

        const duplicates = await findExportDuplicateStats(env.DB, orders.map(o => o.name));

        return json({
          ok: true,
          count: Object.keys(duplicates).length,
          duplicates,
        }, 200, request);
      }

      if (action === 'record_export') {
        assertPost(request);

        const body = await request.json().catch(() => ({}));
        const job = getJobConfig(body.jobType);
        const employee = cleanText(body.employee);
        const orders = normalizeOrderPayload(body.orders);
        const allowRepeat = !!body.allowRepeat;

        if (!employee) return json({ ok: false, error: 'employee مطلوب' }, 400, request);
        if (!orders.length) return json({ ok: false, error: 'لا توجد أوردرات للتسجيل' }, 400, request);

        const duplicateMap = await findExportDuplicateStats(env.DB, orders.map(o => o.name));
        const blocked = Object.keys(duplicateMap);
        if (blocked.length && !allowRepeat) {
          return json({
            ok: false,
            code: 'DUPLICATES_FOUND',
            error: 'يوجد أوردرات تم تصديرها Excel قبل كده — راجع نافذة التكرار واسمح بالتصدير لو عايز تكمل',
            duplicates: duplicateMap,
          }, 409, request);
        }

        const now = new Date().toISOString();
        await writeLogsBatch(env.DB, orders.map((order) => ({
          timestamp: now,
          tool: TOOL_NAME,
          type: job.exportType,
          employee,
          orderId: order.id,
          orderName: order.name,
          valueBefore: order.s2Status || job.expectedStatus,
          valueAfter: order.s2Status || job.expectedStatus,
          notes: `${allowRepeat && duplicateMap[order.name] ? 'تصدير مكرر مسموح' : 'تصدير'} ملف بوسطة — ${job.label}`,
          extra: {
            jobType: job.jobType,
            expectedStatus: job.expectedStatus,
            courier: order.courier || 'Bosta',
            duplicateBeforeExport: !!duplicateMap[order.name],
            exportHistoryBefore: duplicateMap[order.name] || null,
          },
        })));

        return json({
          ok: true,
          count: orders.length,
          duplicatesAllowed: allowRepeat,
          duplicateCount: blocked.length,
        }, 200, request);
      }

      if (action === 'confirm_upload') {
        assertPost(request);

        const body = await request.json().catch(() => ({}));
        const job = getJobConfig(body.jobType);
        const employee = cleanText(body.employee);
        const orders = normalizeOrderPayload(body.orders);
        // Optional checklist from the confirmation modal (v4.0.0+) — audit-trail only,
        // never used to gate the write itself (the HTML already gates the button on it).
        const checklist = body.checklist && typeof body.checklist === 'object' ? body.checklist : null;
        const checklistNote = checklist
          ? ` | Checklist: بوسطة=${checklist.bostaUploaded ? '✓' : '✗'}${job.jobType === 'exchange' ? `, فواتير=${checklist.invoicesSent ? '✓' : '✗'}` : ''}`
          : '';

        if (!employee) return json({ ok: false, error: 'employee مطلوب' }, 400, request);
        if (!orders.length) return json({ ok: false, error: 'لا توجد أوردرات للتأكيد' }, 400, request);

        const token = await getAccessToken(env);
        // Truncated to whole seconds — see nowToSecond() note at top of file.
        const now = nowToSecond();

        await setManualStatus(env, token, orders, job.nextStatus, now);

        const mismatches = await verifyManualStatus(env, token, orders, job.nextStatus, now);
        if (mismatches.length) {
          return json({
            ok: false,
            code: 'VERIFY_FAILED',
            error: 'تم تنفيذ التحديث لكن التحقق المباشر رجّع قيم غير متوقعة لبعض الأوردرات',
            mismatches,
          }, 500, request);
        }

        // Tool-specific log (for this tool's own log tab).
        await writeLogsBatch(env.DB, orders.map((order) => ({
          timestamp: now,
          tool: TOOL_NAME,
          type: job.confirmType,
          employee,
          orderId: order.id,
          orderName: order.name,
          valueBefore: order.s2Status || job.expectedStatus,
          valueAfter: job.nextStatus,
          notes: (job.jobType === 'return'
            ? 'تأكيد رفع بوسطة وتحديث S2 إلى In-Return — استرجاع'
            : 'تأكيد رفع بوسطة + إرسال فواتير للمخزن، وتحديث S2 إلى Ready — استبدال') + checklistNote,
          extra: {
            jobType: job.jobType,
            expectedStatus: job.expectedStatus,
            nextStatus: job.nextStatus,
            courier: order.courier || 'Bosta',
            returnCombinedConfirmAndS2: job.jobType === 'return',
            checklist,
          },
        })));

        // Cross-tool status-history log — REQUIRED so cycle-time / R-E-cycle
        // KPIs (built elsewhere, sourced only from tool='metafields_change')
        // can see this S2 transition. See v3.3.0 changelog at top of file.
        await writeLogsBatch(env.DB, orders.map((order) => ({
          timestamp: now,
          tool: 'metafields_change',
          type: 'update',
          employee,
          orderId: order.id,
          orderName: order.name,
          valueBefore: order.s2Status || job.expectedStatus,
          valueAfter: job.nextStatus,
          notes: `status_2_r_e: ${order.s2Status || job.expectedStatus} → ${job.nextStatus} (via ${TOOL_NAME})`,
          extra: {
            metafieldKey: 'custom.status_2_r_e',
            sourceTool: TOOL_NAME,
            jobType: job.jobType,
          },
        })));

        return json({
          ok: true,
          count: orders.length,
          updatedTo: job.nextStatus,
        }, 200, request);
      }
      // ──────────────────────────────────────────────────────

      // ─── §LOG-ENDPOINTS ───────────────────────────────────
      // CSV multi-select params, per html-builder Log Filter Model v2 —
      // ?employees=ahmed,sara & ?types=scan,export_return
      if (action === 'get_logs') {
        const employees = csvParam(url, 'employees');
        const types     = csvParam(url, 'types');
        const search    = url.searchParams.get('search') || null;
        const limit     = Math.min(parseInt(url.searchParams.get('limit')  || '100', 10), 100);
        const offset    = Math.max(parseInt(url.searchParams.get('offset') || '0', 10),    0);
        const entries   = await getLogs(env.DB, { tool: TOOL_NAME, employees, types, search, limit, offset });
        return json({ ok: true, entries }, 200, request);
      }

      if (action === 'get_logs_count') {
        const employees = csvParam(url, 'employees');
        const types     = csvParam(url, 'types');
        const search    = url.searchParams.get('search') || null;
        const total     = await getLogsCount(env.DB, { tool: TOOL_NAME, employees, types, search });
        return json({ ok: true, total }, 200, request);
      }

      if (action === 'get_logs_export') {
        const employees = csvParam(url, 'employees');
        const types     = csvParam(url, 'types');
        const search    = url.searchParams.get('search') || null;
        const result    = await getLogsExport(env.DB, { tool: TOOL_NAME, employees, types, search });
        return json({ ok: true, ...result }, 200, request);
      }
      // ──────────────────────────────────────────────────────

      // ─── §DIAG — self-check + version, mandatory for a write/cache Worker ─
      if (action === 'diag') {
        const envKeys = Object.keys(env).map((key) => ({ key, length: String(env[key] ?? '').length }));

        let shopify = { ok: false, error: null, scopes: null };
        try {
          const token = await getAccessToken(env);
          const data = await shopifyGQL(env, token, `{ currentAppInstallation { accessScopes { handle } } }`);
          shopify = { ok: true, error: null, scopes: (data?.data?.currentAppInstallation?.accessScopes || []).map((s) => s.handle) };
        } catch (e) {
          shopify = { ok: false, error: e.message, scopes: null };
        }

        let d1 = { ok: false, error: null };
        try {
          await env.DB.prepare('SELECT 1').first();
          d1 = { ok: true, error: null };
        } catch (e) {
          d1 = { ok: false, error: e.message };
        }

        return json({
          ok: true,
          workerVersion: WORKER_VERSION,
          envKeys,
          shopify,
          d1,
          origin: request.headers.get('Origin') || null,
          allowedOrigins: ALLOWED_ORIGINS,
        }, 200, request);
      }

      if (action === 'get_config') {
        return json({ ok: true, version: WORKER_VERSION }, 200, request);
      }
      // ──────────────────────────────────────────────────────

      return json({ ok: false, error: 'action غير معروف' }, 404, request);
    } catch (err) {
      const status = err.status || 500;
      return json({ ok: false, error: err.message || String(err) }, status, request);
    }
  },
};
