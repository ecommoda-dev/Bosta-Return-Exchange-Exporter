// ═══════════════════════════════════════════════════════════════
// Bosta Return/Exchange Exporter — Worker v6.0.1
// EcomModa Internal Tools
// skills: worker-builder v3.7.0 · html-builder v6.2.0 · order-lifecycle v1.2.0 · constants v3.1.0 — 22-09-2026
// v6.0.1 (22-09-2026): fixed `check-log-values.mjs` (old copy missed the
// `{ tool, type }` shorthand and silently passed with a partial view of the
// registry) + added the Layer 5 dynamic-log-value guard (worker-builder
// Step 7-ج) to writeLog/writeLogsBatch. Monitoring only — no operational
// logic changed. See log-values.json for the 10 newly-registered types this
// uncovered (v6.0.0's own upload/export/confirm types were never registered).
// ⚠️ The stamp above is STILL deliberately not bumped. v6.0.0 was written
// against worker-builder v3.0.0 for the parts it touches (Step 5A ④ four
// result states · ⑩ ordering around an irreversible action · ⑪ the three-cap
// chain · ⑫ the entity-level duplicate guard · ⑬ the results ordering
// contract · ⑭ type-splits-by-external-effect) and bosta-api-helper v1.1.0
// Step 8 in full — but the rest of the file has still had no full compliance
// pass, and claiming one in the stamp would be a lie. See CLAUDE.md →
// «مسائل مفتوحة» and run `skills-sweep`.
// ═══════════════════════════════════════════════════════════════
//
// v6.0.0 (BREAKING — the tool now creates Bosta shipments itself, 10-09-2026):
// Until now this tool produced an Excel file that a human uploaded to the
// Bosta dashboard by hand. The upload and the status update were therefore two
// disconnected steps, and the D1 log shows what that costs: across June and
// July 2026, 30 orders were exported and ZERO were confirmed — the shipment
// went to Bosta while S2 stayed on `Confirmed + RETURN/EXCHANGE` for two
// months. Creating the shipment and writing the status in one call removes the
// gap by construction.
//
// The create contract for types 25 / 30 did not exist anywhere in this stack
// (bosta-api-helper Step 8 documents type 10 only). Everything below was
// measured live on the EcomModa account on 10-09-2026 and is recorded in
// PHASE2-LIVE-CHECKS.md §٢. The four findings that decide the code:
//
//   ① THE DIRECTION FLIPS. On a CRP (25) the customer address is
//      `pickupAddress`; on an Exchange (30) it is `dropOffAddress`. Bosta
//      fills the warehouse side itself from `businessLocationId`. Getting it
//      backwards on a CRP returns HTTP 500 with no errorCode — not a 400.
//   ② `cod` KEEPS ITS SIGN. Negative means Bosta hands money back at the door,
//      and three of four sampled R/E orders are negative. Below -2000 Bosta
//      refuses outright (400 · errorCode "3008"), so the value is clamped —
//      but the clamp is DECLARED on the row, never silent.
//   ③ `uniqueBusinessReference` really is a duplicate guard (400 · "11000"),
//      it is unique account-wide across delivery types, and `terminate` FREES
//      it. So it cannot be the bare order number — that is what the S1 tool
//      sends — and it becomes `#12345-R{n}` / `#12345-EX{n}` from the cycle
//      name. `businessReference` stays `order.name` verbatim, because every
//      scanner in the stack searches by it.
//   ④ The returning package lives in `returnSpecs` on BOTH types.
//
// - New §BOSTA block: the address engine (catalogue, zone index, ranking,
//   cross-city detector, resolveAddress) copied VERBATIM from
//   `Bosta-Orders-Upload` v1.3.0, with its test suite copied alongside it —
//   a copy without its tests is how two copies drift apart in silence.
// - New §RE-UPLOAD block: the S2-specific contract, validation, the create
//   and terminate calls, and the batch runner.
// - New endpoints: `get_districts` · `upload_re` · `cancel_re`.
// - `fetch_candidates` now also returns `addressPlan` and `bostaPreview` per
//   order. The catalogue is best-effort: when Bosta is unreachable the rows
//   still come back, `catalogError` says why, and the Excel path is untouched.
// - The details query finally asks for `firstName` / `lastName` /
//   `provinceCode`. `receiver.firstName` is the only name field Bosta
//   requires, and `provinceCode` is the primary key into the province table.
// - The cycle guard now stands in front of a PAID shipment rather than a
//   metafield write, so it runs before the first Bosta call, not after.
// - S2 is written only for rows whose shipment actually exists, reusing
//   confirm_upload's write+verify pair. A failure there downgrades the row to
//   `warning` and never to `error`: red makes the employee upload again, and
//   uploading again buys a second shipment with real money.
//
// KNOWN OPEN ITEM (Ahmed, PHASE2 ق-٥): the tracking number is NOT written to
// any Shopify metafield. `custom.bosta_tracking_number` is single-valued and
// belongs to the S1 shipment; there is no S2 counterpart and Ahmed deferred
// creating one. The number lives in the D1 log and at Bosta under
// `businessReference` until that decision is revisited.
//
// v5.5.0 (the outgoing exchange package survives an order edit — 09-09-2026):
// `return.exchangeLineItems` is the correct source for what leaves the
// warehouse on an exchange, but it is NOT a complete one. When the exchange
// line item Shopify created is removed by an order edit and a replacement is
// added by hand — routine when the size or colour changes after the exchange
// was already booked — the connection goes empty and stays empty, while the
// Shopify Admin still prints "Exchange item for return #X" on the removed
// line. The UI and the API disagree, and only the API mattered here.
//
// Symptom, measured live on #53531 and #53701: the exchange row exported with
// an empty "Package Description", an empty "No. of Items", and a Goods Value
// that silently fell back to the RETURNED piece's price (#53701 quoted 2600
// instead of 2400 — a real money error in a Bosta file).
//
// - New §SHOPIFY::outgoingItems block. The cycle stays PRIMARY; when it is
//   empty on an exchange job the outgoing package is recovered from the
//   order's own lines with `currentQuantity > 0 && unfulfilledQuantity > 0`
//   — exactly the piece waiting to ship. Validated on 25 live orders with an
//   open cycle: empty on every pure return, 1:1 with `exchangeLineItems` on a
//   healthy exchange (#53227), and the only place the hand-added replacement
//   appears. It is a fallback, never a merge — merging double-counts.
// - Rule 8 is untouched: return-vs-exchange (and therefore TYPE_MISMATCH) is
//   still answered by the cycle alone. The recovery only fills the package of
//   a job already known to be an exchange, so it can never reclassify an
//   order. It also never runs on a return job, where an unfulfilled line is
//   far more likely to be a never-shipped piece of the original order.
// - New non-blocking code EXCHANGE_ITEMS_RECOVERED (Rule 13/14 — flag it,
//   never move it): the row exports, and the employee is told the pieces did
//   not come from the cycle so CS can repair the exchange in Shopify.
// - EXCHANGE_WITHOUT_ITEMS is now BLOCKING (was a warning) — Ahmed's call
//   09-09-2026. A Bosta row with nothing going out is not a shipment: no
//   description, no count, and a value borrowed from the returned piece.
// - The page is handed a resolved `outgoingItems` list and never sees raw
//   `exchangeLineItems` or `lineItems`, so it cannot re-total them the wrong
//   way — the same structural protection `returns` got in v5.2.0.
// - Because EXCHANGE_WITHOUT_ITEMS blocks, the confirm_upload cycle guard can
//   no longer be a scalars-only query: it now reads both outgoing sources too
//   (batch 50 → 20, plus the same halve-and-retry on a query-cost rejection),
//   or every healthy exchange would be refused for pieces it never asked for.
//
// v5.4.0 (the cycle rejection is now logged — 02-09-2026):
// order-lifecycle Rule 15 ① and Rule 10 both say "reject + log, never
// silently allow". v5.2.0 shipped the reject; this ships the log. Every
// order refused by the cycle guard writes one D1 row —
// type = 'cycle_block' — carrying the code, the offending value, the
// resolving action, and the S2 write that did NOT happen, so the guard's
// history is answerable ("how often, on which orders, by whom") instead of
// living only in a toast the employee already dismissed.
//
// ⚠️ REGISTRATION: `cycle_block` is a NEW `type` value for this tool.
// worker-builder Rule 7 requires it in `ecommoda-constants` §7 BEFORE this
// ships. Ahmed is registering it — noted here so the next reader does not
// take its presence as proof it was done.
//
// Rows are written before the 409 is returned, and a D1 failure is surfaced
// as `logged: false` on the response rather than swallowed (Step 5A ⑦) —
// the rejection still stands either way; what is at stake is the record.
//
// v5.3.0 (duplicate key + Delivery Notes — 02-09-2026, both Ahmed's call):
// - The duplicate guard was keyed on the ORDER NAME alone, so a legitimate
//   second cycle on an order that was exported for an earlier cycle was
//   flagged as a repeat and needed `allowRepeat` — the guard was losing its
//   meaning one multi-cycle order at a time. The key is now order name +
//   cycle name (`returns[].name`), and `record_export` stores `cycleName`
//   and `cycleCreatedAt` in `extra` so the match is exact from here on.
//
//   Log rows written before this version carry no cycle name. They are NOT
//   discarded and NOT counted blindly — a row is matched to the current
//   cycle only when it was written AFTER that cycle was created
//   (`timestamp >= cycle.createdAt`). An export that happened before the
//   cycle existed cannot possibly be an export OF that cycle. This keeps
//   the whole history usable with no data migration.
//
// - Delivery Notes is filled from `order.note` again. It had been dead since
//   the tool was written (the HTML read a field the query never asked for);
//   v5.2.0 left it deliberately empty pending a decision, and the decision
//   is to fill it. Note that `note` carries internal CS text — verified on
//   #51656: "أوردر استبدال / لا يوجد مصاريف شحن / أوردر استرجاع" — so this
//   text now reaches the courier. Whitespace is collapsed to one line so a
//   multi-line note cannot break the Bosta sheet.
//
// v5.2.0 (R/E cycle correctness — 02-09-2026):
// THE BUG: every export aggregated the line items of ALL return cycles on
// an order (`returns[]` flattened end to end), so an order that had already
// been through one or more CLOSED cycles shipped a Bosta row describing
// pieces that came back weeks ago. Measured live on #51656: three cycles
// (R1 CLOSED, R2 CLOSED, R3 OPEN) produced Return #Items = 3 and
// Goods Value = 6300 instead of 1 and 1750. This breaks
// ecommoda-order-lifecycle Rule 15 ② — type/stage/settlement are read from
// the newest non-ignored cycle, never via .some()/flatMap across returns[].
//
// - `returns` is no longer returned to the page at all. The Worker now sorts
//   the cycles by `createdAt` (never array position), drops CANCELED/DECLINED
//   before sorting (their `closedAt` is null and fabricates a false overlap),
//   and hands the page ONE `currentCycle` object + a `cycleInfo` summary.
//   The old aggregation is now structurally unrepresentable in the frontend.
// - The details query finally asks for `name status createdAt closedAt` on
//   each cycle plus `pageInfo` — none of them were fetched before, which is
//   why the page could not tell an open cycle from a closed one even in
//   principle.
// - One-open-cycle guard (Rule 15 ① / state-machines.md §2.4): an order with
//   two open cycles (CYCLE_OVERLAP_OPEN), none (NO_OPEN_CYCLE), or a
//   truncated cycle list (CYCLES_TRUNCATED) is returned `blocked` and cannot
//   be exported or confirmed. `confirm_upload` re-checks server-side against
//   Shopify before writing S2 and rejects with 409 CYCLE_BLOCKED — the HTML
//   modal is no longer the only gate for this particular rule.
// - Non-blocking flags, per Rule 13/14 (flag it, never move it — every code
//   carries a reason, the offending value, and the resolving action):
//   MULTI_CYCLE (legal sequential cycles), CYCLE_OVERLAP (a historical
//   overlap, already resolved), TYPE_MISMATCH (S2 says RETURN but the open
//   cycle carries exchange items, or vice versa — Rule 8: the API decides,
//   not the metafield), EXCHANGE_WITHOUT_ITEMS.
// - Three Bosta columns were reading fields the query never asked for, so
//   they had been silently empty since the tool was written: Delivery Notes
//   (`order.note`), Package Description and No. of Items (`order.lineItems`).
//   Package Description / No. of Items describe the package going OUT, and
//   nothing goes out on a return — so they are now filled for an exchange
//   job only, from the open cycle's exchange items, and `lineItems` is not
//   fetched at all. (Delivery Notes: see v5.3.0 above.)
//   ⚠️ SUPERSEDED by v5.5.0 on the last point: `lineItems` IS fetched now,
//   as the recovery source for an exchange the cycle no longer records.
//   The columns themselves are still exchange-only. See §SHOPIFY::outgoingItems.
// - DETAILS_BATCH_SIZE 50 → 25, since each order now costs more.
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
const WORKER_VERSION = '6.0.1';
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

// ⚠️ NEW in v5.4.0 — must exist in `ecommoda-constants` §7 for this tool
// (worker-builder Rule 7). Written only when the cycle guard refuses a write.
const CYCLE_BLOCK_TYPE = 'cycle_block';

// ═══ v6.0.0 — direct Bosta upload (types 25 / 30) ═══
// Every value below is either measured live (PHASE2-LIVE-CHECKS results,
// 10-09-2026) or copied verbatim from `ecommoda-constants` §3. None is guessed.
// ⚠️ NEW in v6.0.0 — must exist in `ecommoda-constants` §7 before the first
// live writeLog (worker-builder Rule 7).
const UPLOAD_TYPE_BY_JOB = {
  return:   'upload_re_return',
  exchange: 'upload_re_exchange',
};
// 🔴 The split is NOT cosmetic. `re_upload_failed` = no shipment exists, so a
// retry is safe. `re_shopify_write_failed` = the shipment EXISTS at Bosta with
// a tracking number and only the write-back failed — retrying the upload buys
// a second shipment with real money. Same reasoning as S1's
// upload_failed / shopify_write_failed pair.
const UPLOAD_FAILED_TYPE  = 're_upload_failed';
const WRITE_FAILED_TYPE   = 're_shopify_write_failed';
const CANCEL_TYPE         = 're_cancelled';

// ─── §CONSTANTS::bosta ───
const BOSTA_BASE        = 'https://app.bosta.co/api/v2';
const BOSTA_LOCATION_ID = 'GeZMkbD7o';                        // كلية البنات - مصر الجديدة (ق-٤)
const BOSTA_COUNTRY_ID  = '60e4482c7cb7d4bc4849c4d5';         // مصر
// `ecommoda-constants` §3.2 — from Bosta's own SDK.
const BOSTA_TYPE_BY_JOB = { return: 25, exchange: 30 };       // CRP · Exchange
const ALLOW_OPEN_PKG    = true;                               // مطابق للإكسيل — ب-٨ لسه مفتوح
// 🔴 Two DIFFERENT limits, in opposite directions. COD_MAX is documented in
// api.yaml; COD_REFUND_MIN was measured live: -2700 came back
// 400 · errorCode "3008" · "The Refund COD amount should be less than or
// equal -2000 EGP", and NO shipment was created.
const COD_MAX           = 30000;
const COD_REFUND_MIN    = -2000;

const MAX_UPLOAD_BATCH  = 25;   // ② of the three-cap chain (worker-builder ⑪)
const UPLOAD_CONC       = 3;    // Bosta rate limits undocumented — measure, never guess

// ─── §CONSTANTS::provinces ───
// 🔴 Verbatim from `ecommoda-constants` §3.5. NO fuzzy text match on the
// province name is permitted as a fallback: at least five provinces are spelled
// differently on the two platforms (Beheira/Behira · Qalyubia/El Kalioubia · …),
// so a province missing from this table STOPS its row with an explicit error.
const PROVINCE_TABLE = [
  { province: 'Cairo',          code: 'C',   cityId: 'FceDyHXwpSYYF9zGW', cityName: 'Cairo' },
  { province: 'Alexandria',     code: 'ALX', cityId: 'Jrb6X6ucjiYgMP4T7', cityName: 'Alexandria' },
  { province: 'Giza',           code: 'GZ',  cityId: '0064Qb0OgcA',       cityName: 'Giza' },
  { province: 'Qalyubia',       code: 'KB',  cityId: 'yp3atroeTwnyiBNKE', cityName: 'El Kalioubia' },
  { province: 'Port Said',      code: 'PTS', cityId: 'skFtf6ZmKo8kBEBDK', cityName: 'Port Said' },
  { province: 'Suez',           code: 'SUZ', cityId: 'PickurJ5uJZ9rDTHW', cityName: 'Suez' },
  { province: 'Dakahlia',       code: 'DK',  cityId: 'RrDhS8YYsXAwZ9Zfo', cityName: 'Dakahlia' },
  { province: 'Al Sharqia',     code: 'SHR', cityId: '6ExcoGbpYHnggP8JD', cityName: 'Sharqia' },
  { province: 'Monufia',        code: 'MNF', cityId: 'ruBSjGBDX9wpRa3cc', cityName: 'Monufia' },
  { province: 'Gharbia',        code: 'GH',  cityId: 'K3RwC677J8kJytdZD', cityName: 'Gharbia' },
  { province: 'Beheira',        code: 'BH',  cityId: 'g3GchTSmCgR2JynsJ', cityName: 'Behira' },
  { province: 'Ismailia',       code: 'IS',  cityId: 'PJqNriLtFtx2cfkKP', cityName: 'Ismailia' },
  { province: 'Kafr el-Sheikh', code: 'KFS', cityId: 'ByP7rFCjL6XzF6j4S', cityName: 'Kafr Alsheikh' },
  { province: 'Damietta',       code: 'DT',  cityId: 'qoZvYcZ8Cqji4pGp5', cityName: 'Damietta' },
  { province: 'Aswan',          code: 'ASN', cityId: 'kLvZ5JY6LJPL5chzN', cityName: 'Aswan' },
  { province: 'Luxor',          code: 'LX',  cityId: 'wgYEdH2WMzxGE2Ztp', cityName: 'Luxor' },
  { province: 'Red Sea',        code: 'BA',  cityId: 'r5TscLCNSjR2GimxQ', cityName: 'Red Sea' },
  { province: 'Beni Suef',      code: 'BNS', cityId: 'LzbbvTzZ7D2CgE2PL', cityName: 'Bani Suif' },
  { province: 'Faiyum',         code: 'FYM', cityId: 'BW5MiNxEirB7tuz2y', cityName: 'Fayoum' },
  { province: 'Minya',          code: 'MN',  cityId: 'si6eLnKjXqTFTMBj9', cityName: 'Menya' },
  { province: 'Asyut',          code: 'AST', cityId: '7mDPAohM3ArSZmWTm', cityName: 'Assuit' },
  { province: 'Sohag',          code: 'SHG', cityId: 'n3EENg2adhuR9xBZK', cityName: 'Sohag' },
  { province: 'Qena',           code: 'KN',  cityId: 'vfTHTes3uGjAszgtg', cityName: 'Qena' },
  { province: 'North Sinai',    code: 'SIN', cityId: 'ZuCaDAVQlPT',       cityName: 'North Sinai' },
  { province: 'South Sinai',    code: 'JS',  cityId: 'nG_c44vHQht',       cityName: 'South Sinai' },
  { province: 'Matrouh',        code: 'MT',  cityId: 'KBpGiRZJMIx',       cityName: 'Matrouh' },
  { province: 'New Valley',     code: 'WAD', cityId: 'w4yDVHVJWqa4HpbzA', cityName: 'New Valley' },
  // Two special cases — abolished as governorates in 2011; Bosta runs on 28
  // cities and has no separate city for either. They are ZONES inside another.
  { province: '6th of October', code: 'SU',  cityId: '0064Qb0OgcA',       cityName: 'Giza',
    zoneOnly: { en: '6 October', ar: '٦ اكتوبر' } },
  { province: 'Helwan',         code: 'HU',  cityId: 'FceDyHXwpSYYF9zGW', cityName: 'Cairo',
    zoneOnly: { en: 'Helwan',    ar: 'حلوان' } },
];
// A Bosta city with no Shopify counterpart — matched as a separate city when
// the free-text address names it.
const NORTH_COAST = { cityId: '2hGtNLfRgqGrJjnW9', cityName: 'North Coast',
                      hints: ['الساحل الشمالي', 'north coast', 'الساحل الشمالى'] };

const PROVINCE_BY_NAME = new Map(PROVINCE_TABLE.map((r) => [r.province.toLowerCase(), r]));
const PROVINCE_BY_CODE = new Map(PROVINCE_TABLE.map((r) => [r.code.toUpperCase(), r]));

const DISCOVERY_PAGE_SIZE = 100;
const DISCOVERY_MAX_PAGES = 10;
// Lowered from 50 in v5.2.0 — every order now also carries its return cycles'
// scalars, so the per-query cost roughly doubled.
const DETAILS_BATCH_SIZE = 25;

// R/E cycles — ecommoda-order-lifecycle Rule 15 / state-machines.md §2.4.
// CANCELED / DECLINED cycles are dropped BEFORE sorting: their `closedAt` is
// null, and a null closedAt is read as "still open" by the overlap test, so
// leaving them in fabricates an overlap that never happened.
const RETURNS_PAGE_SIZE = 10;
const IGNORED_RETURN_STATUSES = ['CANCELED', 'DECLINED'];

// v5.5.0 — the order's own line items, needed ONLY to recover the outgoing
// exchange package when an order edit has severed `return.exchangeLineItems`.
// See the §SHOPIFY::outgoingItems block for why this is not the primary source.
const ORDER_LINE_ITEMS_PAGE_SIZE = 25;

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
      // The open cycle this row belongs to — half of the duplicate key
      // (v5.3.0). Null on a payload from an older page; the SQL below falls
      // back to the timestamp rule when it is missing.
      cycleName: cleanText(o?.cycleName) || null,
      cycleCreatedAt: cleanText(o?.cycleCreatedAt) || null,
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

// ─── §HELPERS::assertBostaEnv ───
// worker-builder ⑧ — a missing secret must stop the call by name, not fail
// silently inside a fetch. Scoped to the Bosta paths so the pre-v6 endpoints
// keep working on a Worker that has no BOSTA_API_KEY yet.
function assertBostaEnv(env) {
  if (env.BOSTA_API_KEY === undefined || env.BOSTA_API_KEY === null || String(env.BOSTA_API_KEY).trim() === '') {
    const err = new Error(
      'متغير ناقص في الـ Worker: BOSTA_API_KEY — ضِفه من Dashboard → Settings → '
      + 'Variables ثم Promote النسخة. (شغّل ?action=diag)',
    );
    err.status = 500;
    throw err;
  }
}

// ─── §HELPERS::normPhone ───
// COMPARISON key only — never the value sent to Bosta. Strips everything to
// bare digits so "01009619555", "+201009619555" and "+20 10 09619555" all
// collapse to the same string; without it we send the same number twice as
// `phone` and `secondPhone`.
const normPhone = (p) => String(p || '').replace(/\D/g, '').replace(/^20/, '').replace(/^0/, '');

// ─── §HELPERS::wirePhone ───
// 🔴 The value actually sent. Measured live (PHASE2 ش-٣): this store holds
// THREE shapes — `01…`, `+201…`, and `+20 12 71043044` WITH SPACES (#53849).
// Passing the raw field through would put a spaced string in `receiver.phone`.
// Output is always the local `01…` form.
function wirePhone(p) {
  const d = normPhone(p);
  return d ? '0' + d : '';
}

// ─── §HELPERS::normText ───
// Arabic/English normalisation for matching: diacritics, alef/yaa/taa-marbuta
// variants, punctuation, whitespace.
function normText(s) {
  return String(s || '')
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ؤئ]/g, 'ء')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
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

// ════════════════════════════════════════════════════════════
// §LOG-REG — الحارس الديناميكي لقيم اللوج (الطبقة ٥ · worker-builder Step 7-ج)
// ════════════════════════════════════════════════════════════
// قطعة الأداة دي بس من log-values.json اللي جنبها — بتتحدّث معاه في نفس
// الـ commit. ممنوع شحن سجل الـ٣٢ أداة هنا (Step 7-ب في السكيل بيقول ليه).
const LOG_REGISTRY = {
  bosta_exchange_export: new Set([
    'login', 'logout', 'cycle_block', 're_cancelled', 'scan',
    'upload_re_return', 'upload_re_exchange', 're_upload_failed', 're_shopify_write_failed',
    'export_return', 'export_exchange', 'confirm_return', 'confirm_exchange',
    'manual_confirm_return', 'manual_confirm_exchange',
  ]),
  metafields_change: new Set(['update']),
};

const isRegisteredLogValue = (tool, type) => !!LOG_REGISTRY[tool]?.has(type);

// UPSERT على (source_tool, tool, type) — صف واحد لكل قيمة، hits بيعدّ. الحدث
// الكامل مش بيضيع: الصف الأصلي موجود في logs وعليه _unregistered، والجدول ده
// فهرس مش سجل تاني — عشان كده dedupe مش صف لكل حدث.
const LOG_ALERT_SQL = `
  INSERT INTO log_value_alerts
    (source_tool, tool, type, first_seen, last_seen, hits,
     worker_version, sample_order_name, sample_employee, sample_notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source_tool, tool, type) DO UPDATE SET
    last_seen         = excluded.last_seen,
    hits              = log_value_alerts.hits + excluded.hits,
    worker_version    = excluded.worker_version,
    sample_order_name = excluded.sample_order_name,
    sample_employee   = excluded.sample_employee,
    sample_notes      = excluded.sample_notes,
    status            = CASE WHEN log_value_alerts.status = 'ignored'
                             THEN 'ignored' ELSE 'open' END
`;

// فشل التنبيه ممنوع يأثر على أي حاجة — try/catch صامت. بتجمّع التكرار جوّه
// نفس الدفعة في صف واحد (hits) قبل ما تكتب.
async function noteUnregisteredLogValues(db, entries) {
  const byPair = new Map();
  for (const e of entries) {
    const key = `${e.tool}\u0000${e.type}`;
    const acc = byPair.get(key);
    if (acc) { acc.hits++; continue; }
    byPair.set(key, { entry: e, hits: 1 });
  }
  const now = new Date().toISOString();
  for (const { entry, hits } of byPair.values()) {
    try {
      await db.prepare(LOG_ALERT_SQL).bind(
        TOOL_NAME, entry.tool ?? '(بدون tool)', entry.type ?? '(بدون type)',
        now, now, hits, WORKER_VERSION ?? null,
        entry.orderName ?? null, entry.employee ?? null,
        entry.notes ? String(entry.notes).slice(0, 200) : null,
      ).run();
    } catch (e) { /* متعمّد: التنبيه فهرس، وفشله أهون من تعطيل الأداة */ }
  }
}

async function writeLog(db, entry) {
  const unregistered = !isRegisteredLogValue(entry.tool, entry.type);
  const extra = unregistered
    ? { ...(entry.extra || {}), _unregistered: true }
    : entry.extra;

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
    extra ? JSON.stringify(extra) : null,
  ).run();

  if (unregistered) await noteUnregisteredLogValues(db, [entry]);
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
  const unregisteredEntries = [];
  for (const group of chunks(entries, 40)) {
    await db.batch(group.map((entry) => {
      const unregistered = !isRegisteredLogValue(entry.tool, entry.type);
      if (unregistered) unregisteredEntries.push(entry);
      const extra = unregistered
        ? { ...(entry.extra || {}), _unregistered: true }
        : entry.extra;
      return db.prepare(`
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
        extra ? JSON.stringify(extra) : null,
      );
    }));
  }
  // بعد اللوب مرة واحدة، مش جوّاه (worker-builder Step 7-ج).
  if (unregisteredEntries.length) await noteUnregisteredLogValues(db, unregisteredEntries);
}

// Duplicate key = order name + CYCLE name (v5.3.0 — Ahmed's call).
// Keying on the order name alone flagged a legitimate second cycle as a
// repeat, so `allowRepeat` was being used routinely and the guard was
// draining of meaning.
//
// Rows written before v5.3.0 carry no `cycleName` in `extra`. They are not
// thrown away and not counted blindly: such a row matches the current cycle
// only if it was written AFTER that cycle was created. An export that
// happened before the cycle existed cannot be an export of it. No migration.
async function findExportDuplicateStats(db, orders) {
  const byName = new Map();
  for (const order of orders || []) {
    const name = cleanText(order?.name);
    if (!name || byName.has(name)) continue;
    byName.set(name, {
      name,
      cycleName: cleanText(order?.cycleName) || null,
      cycleCreatedAt: cleanText(order?.cycleCreatedAt) || null,
    });
  }
  if (!byName.size) return {};

  const out = {};
  const exportTypePlaceholders = EXPORT_TYPES.map(() => '?').join(',');

  // 20 orders/query keeps the bound-parameter count well under D1's limit
  // (at most 20 × 3 + 1 + EXPORT_TYPES).
  for (const group of chunks([...byName.values()], 20)) {
    const clauses = [];
    const params = [];

    for (const order of group) {
      if (order.cycleName && order.cycleCreatedAt) {
        clauses.push(`(order_name = ? AND (
          json_extract(extra, '$.cycleName') = ?
          OR (json_extract(extra, '$.cycleName') IS NULL AND timestamp >= ?)
        ))`);
        params.push(order.name, order.cycleName, order.cycleCreatedAt);
      } else {
        // No cycle identity on the payload — fall back to the pre-v5.3.0
        // behaviour rather than silently reporting "never exported".
        clauses.push('(order_name = ?)');
        params.push(order.name);
      }
    }

    const sql = `
      SELECT
        order_name,
        COUNT(*) AS export_count,
        MAX(timestamp) AS last_export_at
      FROM logs
      WHERE tool = ?
        AND type IN (${exportTypePlaceholders})
        AND (${clauses.join(' OR ')})
      GROUP BY order_name
      ORDER BY last_export_at DESC
    `;

    const rows = (await db.prepare(sql).bind(TOOL_NAME, ...EXPORT_TYPES, ...params).all()).results || [];
    for (const row of rows) {
      if (!row.order_name) continue;
      out[row.order_name] = {
        orderName: row.order_name,
        cycleName: byName.get(row.order_name)?.cycleName || null,
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

// ─── §SHOPIFY::returnCycles ───
// ecommoda-order-lifecycle Rule 15 ② — the cycle that is travelling RIGHT NOW
// is the newest OPEN cycle. Never `.some()` / `.flatMap()` across `returns[]`:
// that answers "did this ever happen on this order?", which is a different
// question and the wrong one for an export.
function sortedReturnCycles(order) {
  return (order?.returns?.edges || [])
    .map((edge) => edge?.node)
    .filter(Boolean)
    .filter((cycle) => !IGNORED_RETURN_STATUSES.includes(cycle.status))
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

// state-machines.md §2.4 — a cycle opened while an earlier one was still open.
// `closedAt === null` on an earlier cycle is read as ∞ (still open), which is
// why CANCELED/DECLINED are filtered out before this runs.
function hasHistoricalOverlap(cycles) {
  return cycles.some((cycle, i) => i > 0 && (
    cycles[i - 1].closedAt === null ||
    String(cycle.createdAt || '') < String(cycles[i - 1].closedAt || '')
  ));
}

// ─── §SHOPIFY::outgoingItems ───
// What physically LEAVES the warehouse on an exchange.
//
// ⚠️ `return.exchangeLineItems` is the right source but NOT a complete one.
// Measured live on #53531 and #53701 (09-09-2026): when the exchange line
// item Shopify created is removed by an order edit and a replacement is added
// by hand — routine when the size/colour changes after the exchange was
// already booked — the connection goes **empty** and stays empty. Shopify
// Admin still shows "Exchange item for return #X" on the removed line, so the
// UI and the API disagree; only the API is wrong for our purpose. The result
// was an exchange row exported with no Package Description, no No. of Items,
// and a Goods Value silently falling back to the RETURNED piece's price
// (#53701: 2600 instead of 2400 — a real money error in the Bosta file).
//
// Recovery source, validated against 25 live orders with an open cycle:
// a line item with `currentQuantity > 0 && unfulfilledQuantity > 0` is
// exactly the piece waiting to ship. It is empty on every pure return
// (nothing is waiting), it matches `exchangeLineItems` one-for-one on a
// healthy exchange (#53227), and it is the only place the hand-added
// replacement shows up (#53531, #53701).
//
// The cycle stays PRIMARY and the recovery is a fallback, never a merge:
// merging would double-count a healthy exchange. The fallback also only runs
// for an exchange job — on a return job an unfulfilled line is far more
// likely to be a never-shipped piece of the original order than anything
// going out, and Rule 8's TYPE_MISMATCH must keep reading the cycle alone.
function itemsFromCycle(cycle) {
  return (cycle?.exchangeLineItems?.edges || [])
    .flatMap((edge) => {
      const qty = edge?.node?.quantity || 1;
      return (edge?.node?.lineItems || []).map((li) => ({
        label: cleanText(li?.sku) || cleanText(li?.name) || null,
        qty,
        unitPrice: parseFloat(li?.originalUnitPriceSet?.shopMoney?.amount || 0) || 0,
      }));
    })
    .filter((row) => !!row.label);
}

function itemsFromUnfulfilledLines(order) {
  return (order?.lineItems?.edges || [])
    .map((edge) => edge?.node)
    .filter(Boolean)
    // currentQuantity > 0 drops the line the edit removed; unfulfilledQuantity
    // > 0 drops everything already delivered. Both are required: the removed
    // exchange line keeps its original `quantity`, only these two go to zero.
    .filter((node) => (node.currentQuantity || 0) > 0 && (node.unfulfilledQuantity || 0) > 0)
    .map((node) => ({
      label: cleanText(node.sku) || cleanText(node.name) || null,
      qty: node.unfulfilledQuantity,
      unitPrice: parseFloat(node.originalUnitPriceSet?.shopMoney?.amount || 0) || 0,
    }))
    .filter((row) => !!row.label);
}

function resolveOutgoingItems(order, cycle, jobType) {
  const fromCycle = itemsFromCycle(cycle);
  if (fromCycle.length) return { items: fromCycle, source: 'cycle' };
  if (jobType !== 'exchange') return { items: [], source: 'none' };

  const recovered = itemsFromUnfulfilledLines(order);
  if (recovered.length) return { items: recovered, source: 'order_unfulfilled' };
  return { items: [], source: 'none' };
}

// Rule 13 / Rule 14 — every code carries what is wrong, the offending value,
// and the action that resolves it. Blocking codes stop the export; the rest
// are flags: they move zero rows and change zero numbers.
function analyzeReturnCycles(order, jobType) {
  const cycles = sortedReturnCycles(order);
  const openCycles = cycles.filter((cycle) => cycle.status !== 'CLOSED');
  const truncated = !!order?.returns?.pageInfo?.hasNextPage;
  const current = openCycles.length ? openCycles[openCycles.length - 1] : null;
  const warnings = [];

  let blockReason = null;
  if (truncated) {
    blockReason = {
      code: 'CYCLES_TRUNCATED',
      value: `> ${RETURNS_PAGE_SIZE} دورة`,
      action: `الأوردر فيه أكتر من ${RETURNS_PAGE_SIZE} دورة إرجاع — مش قادرين نحدد الدورة المفتوحة بثقة. راجعه يدوي في شوبيفاي.`,
    };
  } else if (!openCycles.length) {
    blockReason = {
      code: 'NO_OPEN_CYCLE',
      value: cleanText(order?.s2Status?.value),
      action: 'الـ S2 بيقول فيه طلب استرجاع/استبدال لكن مفيش ولا دورة مفتوحة في شوبيفاي — خدمة العملاء تفتح الدورة أو تصلّح الـ S2.',
    };
  } else if (openCycles.length > 1) {
    blockReason = {
      code: 'CYCLE_OVERLAP_OPEN',
      value: openCycles.map((cycle) => cycle.name).join(' · '),
      action: 'أكتر من دورة مفتوحة في نفس الوقت — مش قادرين نعرف أنهي دورة اللي هتتشحن. خدمة العملاء تقفل الزيادة في شوبيفاي (قاعدة: دورة مفتوحة واحدة بس).',
    };
  }

  if (!blockReason && hasHistoricalOverlap(cycles)) {
    warnings.push({
      code: 'CYCLE_OVERLAP',
      value: cycles.map((cycle) => cycle.name).join(' · '),
      action: 'دورة اتفتحت قبل ما اللي قبلها تقفل — اتحلّت دلوقتي، بس تستاهل مراجعة من خدمة العملاء.',
    });
  }

  if (cycles.length > 1) {
    warnings.push({
      code: 'MULTI_CYCLE',
      value: `${cycles.length} دورات`,
      action: 'دورات متتابعة — قانونية. التصدير بيتم من الدورة المفتوحة بس، والدورات المقفولة مش داخلة في الملف.',
    });
  }

  // Rule 8 stays anchored to the CYCLE: return-vs-exchange is answered by
  // `exchangeLineItems`, and the v5.5.0 recovery source must not be allowed to
  // reclassify an order. It only fills the outgoing package once the job is
  // already known to be an exchange.
  const outgoing = resolveOutgoingItems(order, current, jobType);

  if (current) {
    const exchangeCount = (current.exchangeLineItems?.edges || []).length;
    // Rule 8 — the API answers return-vs-exchange, not the metafield.
    if (jobType === 'return' && exchangeCount > 0) {
      warnings.push({
        code: 'TYPE_MISMATCH',
        value: `S2 = ${cleanText(order?.s2Status?.value)} · الدورة فيها قطع استبدال`,
        action: 'الـ S2 بيقول استرجاع لكن الدورة المفتوحة فيها قطع استبدال — راجع نوع العملية قبل الرفع على بوسطة.',
      });
    }

    if (jobType === 'exchange' && outgoing.source === 'order_unfulfilled') {
      // Not blocking: we DO know what is going out, we just did not learn it
      // from the cycle. The employee is told so the mismatch reaches CS
      // instead of dying in the file (Rule 13/14 — flag it, never move it).
      warnings.push({
        code: 'EXCHANGE_ITEMS_RECOVERED',
        value: outgoing.items.map((row) => `${row.label} x${row.qty}`).join(' | '),
        action: 'الدورة المفتوحة مالهاش قطع استبدال في شوبيفاي — القطع الخارجة اتقروا من سطور الأوردر اللي لسه ما اتشحنتش (غالبًا اتعدّلت بالإيد بعد فتح الاستبدال). راجع الوصف قبل الرفع، وخدمة العملاء تظبّط الاستبدال في شوبيفاي.',
      });
    }

    // v5.5.0 — BLOCKING (was a warning). A Bosta row with no outgoing package
    // is not a usable shipment: the courier gets no description, no item count
    // and a Goods Value borrowed from the returned piece. Ahmed's call
    // 09-09-2026: refuse it rather than ship a row nobody can act on.
    if (jobType === 'exchange' && !outgoing.items.length && !blockReason) {
      blockReason = {
        code: 'EXCHANGE_WITHOUT_ITEMS',
        value: `S2 = ${cleanText(order?.s2Status?.value)} · مفيش ولا قطعة خارجة`,
        action: 'الـ S2 بيقول استبدال لكن مفيش قطع استبدال في الدورة ولا سطر لسه ما اتشحنش في الأوردر — مش عارفين هيتشحن للعميل إيه. خدمة العملاء تضيف قطعة الاستبدال في شوبيفاي أو تصلّح الـ S2.',
      };
    }
  }

  return {
    current,
    outgoing,
    info: {
      totalCycles: cycles.length,
      openCycles: openCycles.length,
      currentCycleName: current?.name || null,
      truncated,
      blocked: !!blockReason,
      blockReason,
      warnings,
      outgoingSource: outgoing.source,
    },
  };
}

// ─── §SHOPIFY::discoveryAndDetails ───
// One query for both job types: a return job still needs `exchangeLineItems`
// so TYPE_MISMATCH can be detected (Rule 8), and an exchange job still needs
// `returnLineItems` for the Return columns of the Bosta sheet.
function buildDetailsQuery() {
  return `
    query FetchBostaReturnExchangeDetails($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Order {
          id
          legacyResourceId
          name
          phone
          email
          note
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          totalOutstandingSet { shopMoney { amount currencyCode } }
          shippingAddress {
            name
            # v6.0.0 — firstName is the ONLY name field Bosta actually requires
            # (receiver.required = [firstName, phone]); provinceCode is the
            # primary key into the locked province table; the province NAME is
            # only the fallback. All three were missing while this file was
            # Excel-only — Bosta needs them and the matcher needs the code.
            firstName
            lastName
            phone
            address1
            address2
            city
            province
            provinceCode
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
          # v5.5.0 — recovery source for the outgoing exchange package when an
          # order edit has emptied exchangeLineItems. See §SHOPIFY::outgoingItems.
          lineItems(first: ${ORDER_LINE_ITEMS_PAGE_SIZE}) {
            edges {
              node {
                sku
                name
                currentQuantity
                unfulfilledQuantity
                originalUnitPriceSet { shopMoney { amount } }
              }
            }
          }
          returns(first: ${RETURNS_PAGE_SIZE}) {
            pageInfo { hasNextPage }
            edges {
              node {
                name
                status
                createdAt
                closedAt
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

// Generalised in v5.5.0 — the cycle guard now carries the same per-order cost
// shape as the details fetch (it has to read `exchangeLineItems` and the
// unfulfilled lines to answer EXCHANGE_WITHOUT_ITEMS), so it needs the same
// halve-and-retry on a Shopify query-cost rejection.
async function fetchNodesWithCostFallback(env, token, query, ids) {
  if (!ids.length) return [];

  try {
    const data = await shopifyGQL(env, token, query, { ids });
    return (data?.data?.nodes || []).filter(Boolean);
  } catch (err) {
    if (!isShopifyCostError(err) || ids.length === 1) throw err;

    const mid = Math.ceil(ids.length / 2);
    const left = await fetchNodesWithCostFallback(env, token, query, ids.slice(0, mid));
    const right = await fetchNodesWithCostFallback(env, token, query, ids.slice(mid));
    return [...left, ...right];
  }
}

async function fetchDetailsGroupWithFallback(env, token, ids) {
  return fetchNodesWithCostFallback(env, token, buildDetailsQuery(), ids);
}

// v6.0.0 — `catalog` is optional and best-effort. When it is present every row
// also carries its Bosta address plan and the payload preview the upload will
// use; when Bosta is unreachable the tool still returns candidates and the
// Excel path still works, with `catalogError` saying why the plans are missing.
// A silent `addressPlan: null` would read as "no district matched".
async function fetchCandidateOrders(env, token, job, catalog = null) {
  const discovery = await fetchDiscoveryOrders(env, token, job);
  const ids = discovery.candidates.map(o => o.id);
  const orders = [];
  let fallbackPossible = false;

  let blockedCount = 0;
  let warnedCount = 0;

  for (const group of chunks(ids, DETAILS_BATCH_SIZE)) {
    const details = await fetchDetailsGroupWithFallback(env, token, group);
    if (details.length !== group.length) fallbackPossible = true;

    for (const order of details) {
      const directStatus = cleanText(order?.s2Status?.value);
      const courier = cleanText(order?.courier?.value);
      if (directStatus !== job.expectedStatus || courier.toLowerCase() !== 'bosta') continue;

      const { current, outgoing, info } = analyzeReturnCycles(order, job.jobType);
      if (info.blocked) blockedCount += 1;
      else if (info.warnings.length) warnedCount += 1;

      // `returns` is deliberately dropped from the payload: the page gets the
      // ONE open cycle and nothing else, so the pre-v5.2.0 "flatMap over every
      // cycle" bug cannot come back through the frontend (Rule 15 ②).
      // `lineItems` is dropped for the same reason (v5.5.0): the page gets the
      // resolved `outgoingItems` list, never the raw lines it could re-total.
      const { returns, lineItems, ...rest } = order;
      // v6.0.0 — the Bosta-facing view of the row, resolved server-side for the
      // same reason `returns` and `lineItems` are dropped: the page must not be
      // able to recompute the package, the money or the address itself.
      const parts = catalog ? buildPayloadParts({ ...order, currentCycle: current, outgoingItems: outgoing.items }, job.jobType) : null;
      // Per-order isolation: a plan that throws must cost that ONE row its
      // plan, not the whole batch. `fetch_candidates` also feeds the Excel
      // path, which needs no plan at all.
      let plan = null;
      if (catalog) {
        try { plan = resolveAddress(order, catalog); }
        catch (e) { plan = { ok: false, error: `فشل حساب خطة العنوان: ${e.message}` }; }
      }
      orders.push({
        ...rest,
        // The ONE list of pieces leaving the warehouse, already resolved
        // server-side from the cycle or, failing that, from the unfulfilled
        // lines — §SHOPIFY::outgoingItems.
        outgoingItems: outgoing.items,
        outgoingSource: outgoing.source,
        // orderId: numeric legacy id, for the HTML to build a Shopify hyperlink
        // (worker-builder Step 5 — "numeric order ID" rule).
        orderId: numericOrderId(order),
        currentCycle: current,
        cycleInfo: info,
        // Null together, always — both come from the catalogue.
        addressPlan: plan,
        bostaPreview: parts && {
          cod: parts.cod,
          codRaw: parts.raw,
          codClipped: parts.clipped,
          codRemainder: parts.remainder,
          goodsValue: parts.goodsValue,
          returnCount: parts.returnCount,
          returnDescription: parts.returnDescription,
          outgoingCount: parts.outgoingCount,
          outgoingDescription: parts.outgoingDescription,
          uniqueRef: buildUniqueRef({ name: order.name, currentCycle: current }, job.jobType),
        },
      });
    }
  }

  return {
    orders,
    pageInfo: {
      ...discovery.pageInfo,
      catalogLoaded: !!catalog,
      discoveryCount: discovery.candidates.length,
      detailBatchSize: DETAILS_BATCH_SIZE,
      detailsFetched: orders.length,
      detailsFallbackPossible: fallbackPossible,
      blockedByCycles: blockedCount,
      warnedByCycles: warnedCount,
    },
  };
}

// ─── §SHOPIFY::assertCyclesConfirmable ───
// ecommoda-order-lifecycle Rule 15 ① / state-machines.md §2.4 — "reject + log,
// never silently allow". This is the one gate that is actually enforceable
// here: confirm_upload writes S2 on a live order, so it re-reads the cycles
// from Shopify (scalars only — cheap) and refuses to write for any order whose
// open-cycle state is ambiguous. The HTML modal is no longer the only gate.
//
// The rejection IS logged, as of v5.4.0 — see `logCycleBlocks` below.
// Lowered from 50 in v5.5.0: EXCHANGE_WITHOUT_ITEMS became a blocking code,
// so this query can no longer be scalars-only — it has to read the same two
// outgoing-package sources the export reads, or every healthy exchange order
// would be refused for "no exchange items" simply because the guard never
// asked for them.
const CYCLE_GUARD_BATCH_SIZE = 20;

async function findBlockedCycleOrders(env, token, orders, jobType) {
  const query = `
    query FetchBostaReturnExchangeCycleGuard($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Order {
          id
          name
          s2Status: metafield(namespace: "custom", key: "status_2_r_e") { value }
          # Prices are deliberately NOT fetched here: the guard only asks
          # whether anything is going out, never what it is worth. Its
          # resolveOutgoingItems() result is read for .length and discarded.
          lineItems(first: ${ORDER_LINE_ITEMS_PAGE_SIZE}) {
            edges { node { sku name currentQuantity unfulfilledQuantity } }
          }
          returns(first: ${RETURNS_PAGE_SIZE}) {
            pageInfo { hasNextPage }
            edges {
              node {
                name
                status
                createdAt
                closedAt
                exchangeLineItems(first: 25) {
                  edges { node { quantity lineItems { sku name } } }
                }
              }
            }
          }
        }
      }
    }
  `;

  const blocked = [];
  const seen = new Set();

  for (const group of chunks(orders.map((o) => o.id), CYCLE_GUARD_BATCH_SIZE)) {
    for (const order of await fetchNodesWithCostFallback(env, token, query, group)) {
      seen.add(order.id);
      const { info } = analyzeReturnCycles(order, jobType);
      if (info.blocked) {
        blocked.push({
          id: order.id,
          name: order.name,
          s2Status: cleanText(order?.s2Status?.value) || null,
          code: info.blockReason.code,
          value: info.blockReason.value,
          action: info.blockReason.action,
        });
      }
    }
  }

  // An order Shopify did not return at all is not silently treated as fine —
  // worker-builder Step 5A ④: "we could not confirm" is never "success".
  for (const order of orders) {
    if (seen.has(order.id)) continue;
    blocked.push({
      id: order.id,
      name: order.name,
      s2Status: order.s2Status || null,
      code: 'ORDER_NOT_READABLE',
      value: order.id,
      action: 'شوبيفاي ما رجّعتش الأوردر ده وقت فحص الدورات — ما قدرناش نتأكد، فاتمنع التحديث. جرّب تاني أو راجعه يدوي.',
    });
  }

  return blocked;
}

// Rule 15 ① / Rule 10 — "reject + log". One row per refused order, written
// before the 409 goes back. A D1 failure does not undo the rejection, but it
// must be visible: the caller gets `logged: false` (Step 5A ⑦), never silence.
async function logCycleBlocks(db, blocked, job, employee) {
  if (!blocked.length) return { logged: true, logError: null };

  const now = new Date().toISOString();
  try {
    await writeLogsBatch(db, blocked.map((row) => ({
      timestamp: now,
      tool: TOOL_NAME,
      type: CYCLE_BLOCK_TYPE,
      employee,
      orderId: row.id,
      orderName: row.name,
      // The S2 write that did NOT happen — before and after are the same value
      // on purpose: nothing moved.
      valueBefore: row.s2Status || job.expectedStatus,
      valueAfter: row.s2Status || job.expectedStatus,
      notes: `اتمنع تحديث S2 إلى ${job.nextStatus} — ${row.code}: ${row.value}`,
      extra: {
        jobType: job.jobType,
        expectedStatus: job.expectedStatus,
        blockedNextStatus: job.nextStatus,
        code: row.code,
        value: row.value,
        action: row.action,
      },
    })));
    return { logged: true, logError: null };
  } catch (e) {
    return { logged: false, logError: e.message };
  }
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
// §BOSTA — v6.0.0, direct upload of R/E shipments
// ══════════════════════════════════════════════════════
// The address engine below (§BOSTA::catalog … §BOSTA::resolveAddress) is a
// VERBATIM copy of `Bosta-Orders-Upload` index.js v1.3.0. It is pure — it only
// reads `order.shippingAddress` — and it carries its own test suite there
// (tests/address-matching.test.cjs). Do not "improve" it here in isolation:
// a change belongs in both copies, or in the shared block proposed for
// `bosta-api-helper`. The only S2-specific part starts at §BOSTA::buildRePayload.
//
// ⚠️ Authorization is the RAW key with no "Bearer" — Bearer returns 401 with no
// useful message.
function bostaHeaders(env) {
  return { Authorization: env.BOSTA_API_KEY, 'Content-Type': 'application/json' };
}

// ─── §BOSTA::catalog ───
// The city catalogue barely changes → cache it. KV when the binding exists,
// otherwise the Cache API (no binding needed). One call per order is banned.
const CATALOG_TTL_SECONDS = 24 * 3600;
// 🔴 Tool-specific URL. Sharing the S1 tool's cache key across Workers would
// make one tool's stale catalogue silently serve the other.
const CATALOG_CACHE_URL   = 'https://bosta-return-exchange-exporter.internal/catalog/districts-v1';
let   catalogMemo = null;

async function readCatalogCache(env) {
  if (catalogMemo && (Date.now() - catalogMemo.at) < CATALOG_TTL_SECONDS * 1000) return catalogMemo.value;
  try {
    if (env.CATALOG_KV) {
      const raw = await env.CATALOG_KV.get('bosta_districts_v1', 'json');
      if (raw) { catalogMemo = { at: Date.now(), value: raw }; return raw; }
    } else {
      const hit = await caches.default.match(CATALOG_CACHE_URL);
      if (hit) { const v = await hit.json(); catalogMemo = { at: Date.now(), value: v }; return v; }
    }
  } catch { /* the cache is not a source of truth — a miss just refetches */ }
  return null;
}

async function writeCatalogCache(env, value) {
  catalogMemo = { at: Date.now(), value };
  try {
    if (env.CATALOG_KV) {
      await env.CATALOG_KV.put('bosta_districts_v1', JSON.stringify(value), { expirationTtl: CATALOG_TTL_SECONDS });
    } else {
      await caches.default.put(CATALOG_CACHE_URL, new Response(JSON.stringify(value), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CATALOG_TTL_SECONDS}` },
      }));
    }
  } catch { /* same reason */ }
}

// ─── §BOSTA::normalizeCatalog ───
// The response shape is not precisely documented, so normalise more than one
// possible shape instead of assuming a single one.
function normalizeCatalog(raw) {
  const cities = Array.isArray(raw?.data) ? raw.data
               : Array.isArray(raw?.cities) ? raw.cities
               : Array.isArray(raw) ? raw : [];
  const out = [];
  for (const c of cities) {
    const cityId   = c?._id || c?.cityId || c?.id || null;
    const cityName = c?.name || c?.cityName || '';
    const cityAr   = c?.nameAr || c?.otherName || c?.cityOtherName || '';
    const rawDistricts = Array.isArray(c?.districts) ? c.districts
                       : Array.isArray(c?.zones) ? c.zones.flatMap((z) => (z?.districts || []).map((d) => ({ ...d, zoneName: z?.name, zoneOtherName: z?.otherName || z?.nameAr })))
                       : [];
    const districts = [];
    for (const d of rawDistricts) {
      const id = d?._id || d?.districtId || d?.id || null;
      if (!id) continue;
      districts.push({
        id,
        name:   d?.districtName || d?.name || '',
        nameAr: d?.districtOtherName || d?.otherName || d?.nameAr || '',
        zone:   d?.zoneName || d?.zone?.name || '',
        zoneAr: d?.zoneOtherName || d?.zone?.otherName || '',
        dropOff: d?.dropOffAvailability,
      });
    }
    if (cityId) out.push({ cityId, cityName, cityAr, districts });
  }
  return { fetchedAt: new Date().toISOString(), cities: out };
}

// ─── §BOSTA::getCatalog ───
async function getCatalog(env, { force = false } = {}) {
  assertBostaEnv(env);
  if (!force) {
    const cached = await readCatalogCache(env);
    if (cached) return cached;
  }
  const url = `${BOSTA_BASE}/cities/getAllDistricts?countryId=${BOSTA_COUNTRY_ID}`;
  let resp, text;
  try {
    resp = await fetch(url, { headers: bostaHeaders(env) });
    text = await resp.text();
  } catch (e) {
    // ❌ never catch(_){} here — this failure must surface, not turn into
    // "no districts found".
    throw new Error(`كتالوج بوسطة: فشل الاتصال — ${e.message}`);
  }
  if (!resp.ok) throw new Error(`كتالوج بوسطة: HTTP ${resp.status} — ${text.slice(0, 180)}`);
  let raw;
  try { raw = JSON.parse(text); }
  catch { throw new Error(`كتالوج بوسطة: رد مش JSON — ${text.slice(0, 180)}`); }

  const cat = normalizeCatalog(raw);
  if (!cat.cities.length) throw new Error('كتالوج بوسطة: الرد مفيهوش أي مدينة — شكل الرد اتغيّر');
  await writeCatalogCache(env, cat);
  return cat;
}

// ─── §BOSTA::availableDistricts ───
// Filtering on dropOffAvailability === true is mandatory.
// ⚠️ If the field is missing from the whole catalogue the filter empties the
// list — that case is REPORTED (in diag and in the row plan) instead of
// silently becoming "no match".
function availableDistricts(city) {
  if (!city) return { list: [], fieldMissing: false };
  const withField = city.districts.filter((d) => d.dropOff !== undefined);
  const fieldMissing = city.districts.length > 0 && withField.length === 0;
  const list = fieldMissing ? [] : city.districts.filter((d) => d.dropOff === true);
  return { list, fieldMissing };
}

// ─── §BOSTA::ensureNormalized ───
function ensureNormalized(catalog) {
  if (!catalog || catalog._normalized) return catalog;
  for (const c of catalog.cities) {
    c.cityNameN = normText(c.cityName);
    c.cityArN   = normText(c.cityAr);
    for (const d of c.districts) {
      d.nameN   = normText(d.name);
      d.nameArN = normText(d.nameAr);
      // 🔴 "generic" = the district is named after the city/governorate itself.
      // Customers habitually write their governorate into the address, so such
      // a match carries almost no information — and it is exactly the one that
      // used to win on length and send the shipment to the wrong branch.
      d.generic = (!!d.nameN   && (d.nameN   === c.cityNameN || d.nameN   === c.cityArN))
               || (!!d.nameArN && (d.nameArN === c.cityNameN || d.nameArN === c.cityArN));
    }
    c.zoneIndex = buildZoneIndex(c);
  }
  catalog._normalized = true;
  return catalog;
}

// ─── §BOSTA::buildZoneIndex ───
// City → zone → district. The ZONE is the name a customer actually writes when
// the district carries a compound administrative label:
//   address  : "العبور الحي الخامس بلوك ١٦٠٢٧"
//   districts: "المنطقة 01 (العبور)" · "دار مصر - العبور" · "احياء العبور الجديده"
//   zone     : "العبور"  ← this is what matches
function buildZoneIndex(city) {
  const byKey = new Map();
  for (const d of city.districts) {
    if (d.dropOff !== true) continue;
    const en = (d.zone || '').trim(), ar = (d.zoneAr || '').trim();
    if (!en && !ar) continue;
    const key = normText(en) + '|' + normText(ar);
    let z = byKey.get(key);
    if (!z) {
      z = { zone: en, zoneAr: ar, nameN: normText(en), nameArN: normText(ar), count: 0 };
      z.generic = (!!z.nameN   && (z.nameN   === city.cityNameN || z.nameN   === city.cityArN))
               || (!!z.nameArN && (z.nameArN === city.cityNameN || z.nameArN === city.cityArN));
      byKey.set(key, z);
    }
    z.count++;
  }
  return [...byKey.values()];
}

// ─── §BOSTA::matchZonesIn ───
// Same ranking as districts — the difference is the RESULT is a zone, so it
// settles the CITY and not the district. A zone holds many districts; picking
// one of them automatically would be a guess.
function matchZonesIn(city, fields) {
  const best = new Map();
  // A province row can name a cityId that Bosta's live catalogue does not
  // carry, and then `city` is null here. Reading `city.zoneIndex` would throw
  // and take the whole candidate fetch down with it — including the Excel
  // fallback that is supposed to survive any Bosta problem.
  if (!city) return [];
  for (const f of fields) {
    const ftext = f.textN;
    if (!ftext) continue;
    for (const z of (city.zoneIndex || [])) {
      for (const n of [z.nameN, z.nameArN]) {
        if (!n || n.length < 3 || !ftext.includes(n)) continue;
        const hit = {
          zone: z.zone, zoneAr: z.zoneAr, count: z.count,
          tier: f.tier, field: f.key, fieldLabel: f.label,
          matched: n, matchedText: n === z.nameArN ? z.zoneAr : z.zone,
          exact: ftext === n, generic: !!z.generic,
        };
        const key = z.nameN + '|' + z.nameArN;
        const prev = best.get(key);
        if (!prev || betterHit(hit, prev) < 0) best.set(key, hit);
        break;
      }
    }
  }
  return [...best.values()].sort(betterHit);
}

// ─── §BOSTA::addressFields ───
// The address boxes stay SEPARATE and ordered by specificity — never glued into
// one string. 🔴 Gluing destroyed the information that decides the match:
// `city` = "سيدي سالم" is far more specific than a mention of "كفر الشيخ"
// inside `address1`. Without this ordering the ranking falls back to length,
// and length favours the governorate over the town.
function addressFields(sa) {
  return [
    { key: 'city',     label: 'مدينة شوبيفاي', text: sa.city     || '' },
    { key: 'address1', label: 'العنوان',        text: sa.address1 || '' },
    { key: 'address2', label: 'العنوان ٢',      text: sa.address2 || '' },
  ].filter((f) => f.text).map((f, i) => ({ ...f, tier: i, textN: normText(f.text) }));
}

// ─── §BOSTA::rankHits ───
//   ① non-generic beats generic  — "مصر الجديدة" beats "القاهرة"
//   ② the more specific box wins — `city` > `address1` > `address2`
//   ③ an exact match beats a partial one within the same box
//   ④ longer wins ONLY when the shorter is contained in it — "مدينة نصر" > "نصر"
// ⚠️ Length alone is NOT a tiebreaker: "المنصورة" and "اجا" in one address are
// two SEPARATE matches, and the longer is not the more correct. That case is
// declared AMBIGUOUS on purpose — one extra click beats a wrong branch.
const HIT_KEY = (h) => [h.generic ? 1 : 0, h.tier, h.exact ? 0 : 1];

function betterHit(a, b) {
  const ka = HIT_KEY(a), kb = HIT_KEY(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return b.matched.length - a.matched.length;
}
function dominates(a, b) {
  const ka = HIT_KEY(a), kb = HIT_KEY(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i];
  return a.matched.length > b.matched.length && a.matched.includes(b.matched);
}

// ─── §BOSTA::matchDistrictsIn ───
function matchDistrictsIn(city, fields, zoneOnly) {
  const { list, fieldMissing } = availableDistricts(city);
  if (!list.length || !fields.length) return { hits: [], fieldMissing };

  let pool = list;
  if (zoneOnly) {
    const zEn = normText(zoneOnly.en), zAr = normText(zoneOnly.ar);
    pool = list.filter((d) => {
      const dz = normText(d.zone), dza = normText(d.zoneAr);
      return (zEn && (dz === zEn || dza === zEn)) || (zAr && (dz === zAr || dza === zAr));
    });
  }

  const best = new Map();
  for (const f of fields) {
    const ftext = f.textN;
    if (!ftext) continue;
    for (const d of pool) {
      for (const n of [d.nameN, d.nameArN]) {
        if (!n || n.length < 3 || !ftext.includes(n)) continue;
        const hit = {
          id: d.id, name: d.name, nameAr: d.nameAr, zone: d.zone,
          tier: f.tier, field: f.key, fieldLabel: f.label,
          matched: n, matchedText: n === d.nameArN ? d.nameAr : d.name,
          exact: ftext === n, generic: !!d.generic,
        };
        const prev = best.get(d.id);
        if (!prev || betterHit(hit, prev) < 0) best.set(d.id, hit);
        break;
      }
    }
  }
  return { hits: [...best.values()].sort(betterHit), fieldMissing };
}

// ─── §BOSTA::matchDistrict ───
// One candidate = settled · more than one = declared ambiguity.
function matchDistrict(city, fields, zoneOnly) {
  const { hits, fieldMissing } = matchDistrictsIn(city, fields, zoneOnly);
  if (!hits.length) return { matches: [], fieldMissing };
  const top = hits[0];
  const matches = hits.filter((h) => h === top || !dominates(top, h));
  return { matches, fieldMissing };
}

// ─── §BOSTA::findCrossCity ───
// 🟠 The "city is doubtful" detector. Runs ONLY when nothing matched inside the
// city the province table computed.
//
// Why at all: Bosta's grouping is not the administrative one (العبور is
// Qalyubia administratively and sits under Cairo at Bosta), and customers also
// pick the wrong governorate. Both look the same from here, and the result is
// NOT "missing district" — it is a WRONG CITY, i.e. wrong branch and wrong price.
//
// 🔴 A suggestion only — auto-applying is banned. District names repeat across
// governorates, so switching a shipment's city on a text match is the very trap
// the locked province table exists to prevent.
const CROSS_MIN_LEN      = 4;
const CROSS_MAX_HITS     = 8;
const CROSS_MAX_PER_CITY = 3;

function findCrossCity(catalog, fields, skipCityId) {
  const out = [];
  for (const c of catalog.cities) {
    if (c.cityId === skipCityId) continue;

    // ① district match — settles the city AND the district
    const { hits } = matchDistrictsIn(c, fields, null);
    let taken = 0;
    for (const h of hits) {
      if (h.matched.length < CROSS_MIN_LEN || h.generic) continue;
      if (++taken > CROSS_MAX_PER_CITY) break;
      out.push({
        kind: 'district',
        cityId: c.cityId, cityName: c.cityName,
        districtId: h.id, districtName: h.name, districtNameAr: h.nameAr, zone: h.zone,
        matchedText: h.matchedText, fieldLabel: h.fieldLabel,
        _rank: [h.tier, h.exact ? 0 : 1, -h.matched.length],
      });
    }

    // ② zone match — settles the CITY only. This is what catches العبور.
    let takenZ = 0;
    for (const z of matchZonesIn(c, fields)) {
      if (z.matched.length < CROSS_MIN_LEN || z.generic) continue;
      if (out.some((o) => o.cityId === c.cityId && normText(o.zone || '') === normText(z.zone))) continue;
      if (++takenZ > CROSS_MAX_PER_CITY) break;
      out.push({
        kind: 'zone',
        cityId: c.cityId, cityName: c.cityName,
        zone: z.zone, zoneAr: z.zoneAr, districtCount: z.count,
        matchedText: z.matchedText, fieldLabel: z.fieldLabel,
        _rank: [z.tier, z.exact ? 0 : 1, -z.matched.length],
      });
    }
  }
  out.sort((a, b) => {
    for (let i = 0; i < 3; i++) if (a._rank[i] !== b._rank[i]) return a._rank[i] - b._rank[i];
    return 0;
  });
  return out.slice(0, CROSS_MAX_HITS).map(({ _rank, ...rest }) => rest);
}

// ─── §BOSTA::findLocalZones ───
// Same idea INSIDE the right city: nothing matched a district, but a zone
// matched. The city is not wrong here — the gain is that the picker opens with
// that zone's districts (7 instead of 590) instead of the employee searching.
function findLocalZones(city, fields) {
  if (!city) return [];
  return matchZonesIn(city, fields)
    .filter((z) => z.matched.length >= CROSS_MIN_LEN && !z.generic)
    .slice(0, CROSS_MAX_PER_CITY)
    .map((z) => ({
      kind: 'zone', cityId: city.cityId, cityName: city.cityName,
      zone: z.zone, zoneAr: z.zoneAr, districtCount: z.count,
      matchedText: z.matchedText, fieldLabel: z.fieldLabel,
    }));
}

// ─── §BOSTA::resolveAddress ───
//   province → cityId deterministically from the locked table (no text fallback)
//   one district match     → mode 'district'  · documented contract
//   special province, none → mode 'zoneName'  · documented contract
//   many matches or none   → mode 'province'  · undocumented contract
function resolveAddress(order, catalog) {
  ensureNormalized(catalog);
  const sa = order.shippingAddress || {};
  const provinceRaw = sa.province || '';
  const codeRaw     = sa.provinceCode || '';

  let row = PROVINCE_BY_CODE.get(String(codeRaw).toUpperCase())
         || PROVINCE_BY_NAME.get(String(provinceRaw).toLowerCase())
         || null;

  const fields = addressFields(sa);

  const normAddr = fields.map((f) => f.textN).join(' ');
  const isNorthCoast = NORTH_COAST.hints.some((h) => normAddr.includes(normText(h)));
  if (isNorthCoast && (row?.province === 'Matrouh' || row?.province === 'Alexandria')) {
    row = { province: row.province, code: row.code, cityId: NORTH_COAST.cityId, cityName: NORTH_COAST.cityName };
  }

  if (!row) {
    return {
      ok: false,
      error: `المحافظة "${provinceRaw || codeRaw || '—'}" مش في جدول ecommoda-constants §3.5 — `
           + 'تتسجّل هناك الأول، ممنوع التخمين',
    };
  }

  const city = catalog.cities.find((c) => c.cityId === row.cityId) || null;
  if (!city) {
    // The province table is locked and deterministic, so this means Bosta's
    // catalogue changed under us. Say so by name instead of degrading into a
    // silent "no district matched" — that would ship on the wrong city.
    return {
      ok: false,
      error: `مدينة بوسطة "${row.cityName}" (${row.cityId}) مش موجودة في الكتالوج الحي — `
           + 'كتالوج بوسطة اتغيّر. راجع الجدول في ecommoda-constants §3.5.',
    };
  }
  const { matches, fieldMissing } = matchDistrict(city, fields, row.zoneOnly);

  const base = {
    ok: true,
    province: row.province,
    cityId: row.cityId,
    cityName: row.cityName,
    catalogWarning: fieldMissing ? 'dropOffAvailability غايب من كتالوج بوسطة — المطابقة اتعطّلت' : null,
    candidates: matches.map((m) => ({
      id: m.id, name: m.name, nameAr: m.nameAr, zone: m.zone,
      matchedText: m.matchedText, fieldLabel: m.fieldLabel,
    })),
    crossCity: [],
    localZones: [],
  };

  if (matches.length === 1) {
    return { ...base, mode: 'district', districtId: matches[0].id, districtName: matches[0].name };
  }
  if (matches.length === 0 && row.zoneOnly) {
    return { ...base, mode: 'zoneName', districtName: row.zoneOnly.en };
  }
  if (matches.length === 0) {
    const localZones = findLocalZones(city, fields);
    const crossCity  = findCrossCity(catalog, fields, row.cityId);
    return {
      ...base, mode: 'province', ambiguous: false,
      localZones, crossCity,
      // 🟠 Doubt is declared ONLY when a suggestion exists in ANOTHER city.
      // A zone inside the same city is not doubt — it is help picking a district.
      cityDoubt: crossCity.length > 0,
    };
  }
  return { ...base, mode: 'province', ambiguous: true };
}

// ══════════════════════════════════════════════════════
// §RE-UPLOAD — everything below is S2-specific
// ══════════════════════════════════════════════════════

// ─── §RE-UPLOAD::returnItems ───
// What physically COMES BACK. Mirror image of §SHOPIFY::outgoingItems, and the
// same protection: resolved server-side from the ONE open cycle so the page
// never sees `returns[]` and cannot re-total it the pre-v5.2.0 way (Rule 15 ②).
// Feeds `returnSpecs` on BOTH job types — measured live: Bosta stores the
// returning package under `returnSpecs` for type 25 and type 30 alike.
function resolveReturnItems(cycle) {
  return (cycle?.returnLineItems?.edges || [])
    .map((edge) => {
      const li  = edge?.node?.fulfillmentLineItem?.lineItem;
      const qty = edge?.node?.quantity || 1;
      if (!li) return null;
      return {
        label: cleanText(li.sku) || cleanText(li.name) || null,
        qty,
        unitPrice: parseFloat(li.originalUnitPriceSet?.shopMoney?.amount || 0) || 0,
      };
    })
    .filter((row) => row && row.label);
}

// Collapses a multi-line order note to one line. The Bosta `notes` field is a
// single string and the courier reads it; a raw newline would break the row.
function flattenNote(note) {
  const text = cleanText(note).replace(/\s*\n+\s*/g, ' / ').replace(/\s{2,}/g, ' ').trim();
  return text ? text.slice(0, 500) : null;
}

function describeItems(rows) {
  return rows.map((r) => `${r.label} x${r.qty}`).join(' | ').slice(0, 900) || null;
}
function countItems(rows) {
  return rows.reduce((sum, r) => sum + (r.qty || 1), 0);
}
function valueItems(rows) {
  return rows.reduce((sum, r) => sum + (parseFloat(r.unitPrice) || 0) * (r.qty || 1), 0);
}

// ─── §RE-UPLOAD::uniqueRef ───
// 🔴 Measured live, 10-09-2026 — this contradicts what `bosta-api-helper` 8.3
// and `ecommoda-constants` §3.3 said, so read the table, not the old text:
//
//   same uref, original still alive        → 400 · errorCode "11000"
//   same uref, after terminate             → 201  (terminate FREES the value)
//   same businessReference, different uref → 201  (this is what Excel did)
//   same uref on a DIFFERENT delivery type → 400 · "11000" (unique account-wide)
//
// So the guard is real and it is exactly the guard we want: it stops a second
// paid shipment for a cycle that already has one, and it lets a corrected
// re-upload through once the wrong one is terminated.
//
// `businessReference` stays `order.name` verbatim (ق-١) — every scanner in the
// stack searches by it — and the per-cycle uniqueness lives in this hidden
// field instead. `#12345` alone is banned here: that is precisely what
// `Bosta-Orders-Upload` sends for the S1 shipment, so it would collide.
function buildUniqueRef(order, jobType) {
  const cycleName = cleanText(order?.currentCycle?.name);
  const n = cycleName.match(/-R(\d+)$/i)?.[1] || null;
  if (!n) {
    return {
      ok: false,
      code: 'CYCLE_NAME_UNPARSEABLE',
      value: cycleName || '—',
      // Rule 13/14 — no silent fallback. A guessed counter would let the same
      // cycle be uploaded twice under two different references.
      action: 'اسم الدورة في شوبيفاي مش على الشكل المتوقع (#12345-R1) — مش قادرين نبني مرجع فريد '
            + 'للشحنة، والرفع اتوقف بدل ما نخمّن رقم ونسمح برفع مكرر بفلوس. راجع الدورة في شوبيفاي.',
    };
  }
  return { ok: true, uref: `${cleanText(order.name)}${jobType === 'exchange' ? '-EX' : '-R'}${n}` };
}

// ─── §RE-UPLOAD::buildRePayload ───
// 🔴 THE DIRECTION FLIPS WITH THE TYPE. Measured live 10-09-2026:
//
//              CRP (25)                    Exchange (30)
//   customer   pickupAddress               dropOffAddress
//   warehouse  dropOffAddress (auto)       pickupAddress (auto)
//
// Bosta fills the warehouse side itself from `businessLocationId`. Sending the
// customer address as `dropOffAddress` on a CRP returns HTTP 500
// ("Cannot read properties of undefined (reading 'city')") — NOT a clean 400.
function buildRePayload(order, plan, mode, jobType, parts) {
  const sa = order.shippingAddress || {};

  const fullName  = cleanText(sa.name) || `${cleanText(sa.firstName)} ${cleanText(sa.lastName)}`.trim();
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstName = cleanText(sa.firstName) || nameParts[0] || '';
  const lastName  = cleanText(sa.lastName)  || nameParts.slice(1).join(' ');

  const phone  = wirePhone(sa.phone);
  const second = wirePhone(order?.customer?.phone);
  const sendSecond = second && normPhone(second) !== normPhone(phone);

  const firstLine = [
    [sa.address1, sa.address2].filter(Boolean).join(' - '),
    `${cleanText(sa.city)}- ${cleanText(sa.province)}`,
  ].filter(Boolean).join(', ').trim();

  // 🔴 The field is `city` — NOT `cityName`. The validator does not see
  // `cityName` at all and drops it silently, so anything copied verbatim from
  // the Bosta dashboard falls into this trap.
  const address = { city: plan.cityName, firstLine };
  if (mode === 'district') { address.districtId = plan.districtId; }
  if (mode === 'zoneName') { address.cityId = plan.cityId; address.districtName = plan.districtName; }

  const receiver = { firstName, phone };            // the documented required pair
  if (lastName)   receiver.lastName    = lastName;
  if (fullName)   receiver.fullName    = fullName;  // optional — sent WITH firstName, not instead
  if (sendSecond) receiver.secondPhone = second;

  const payload = {
    type: BOSTA_TYPE_BY_JOB[jobType],
    cod: parts.cod,                                  // 🔴 signed — see §RE-UPLOAD::resolveCod
    goodsInfo: { amount: parts.goodsValue },         // ⚠️ carries a 1% insurance fee at Bosta
    receiver,
    // The returning package — present on BOTH types.
    returnSpecs: {
      packageType: 'Parcel',
      size: 'SMALL',
      packageDetails: { itemsCount: parts.returnCount, description: parts.returnDescription },
    },
    businessLocationId: BOSTA_LOCATION_ID,
    businessReference: cleanText(order.name),        // ق-١ — verbatim, hash included
    uniqueBusinessReference: parts.uref,             // ق-٢ — per-cycle, hidden from every search
    allowToOpenPackage: ALLOW_OPEN_PKG,
  };

  if (jobType === 'exchange') {
    payload.dropOffAddress = address;
    // The outgoing package. `analyzeReturnCycles` already refuses an exchange
    // with nothing going out (EXCHANGE_WITHOUT_ITEMS), so this is never empty.
    payload.specs = {
      packageType: 'Parcel',
      size: 'SMALL',
      packageDetails: { itemsCount: parts.outgoingCount, description: parts.outgoingDescription },
    };
  } else {
    payload.pickupAddress = address;
    // No `specs` on a CRP — nothing leaves the warehouse. Verified: accepted (201).
  }

  // ⚠️ `flexShippingInfo` is deliberately NOT sent. Bosta fills it in itself
  // ({isOrderEligible:true, amountToBeCollected:100}) and marks it
  // status:"Not Applicable" on R/E shipments, so sending it changes nothing.
  const notes = flattenNote(order.note);
  if (notes) payload.notes = notes;                  // `notes` is the official name; `deliveryNotes` does not exist
  return payload;
}

// ─── §RE-UPLOAD::resolveCod ───
// 🔴 `Bosta-Orders-Upload` wraps this value in Math.abs(). That is correct for
// S1 (a negative outstanding there means the customer overpaid) and a disaster
// here: it would turn "refund him 2,000" into "collect 2,000 from him".
// The sign is load-bearing — three of four sampled R/E orders are negative.
function resolveCod(order) {
  const raw = parseFloat(order?.totalOutstandingSet?.shopMoney?.amount || 0) || 0;
  const cod = Math.max(raw, COD_REFUND_MIN);
  return {
    cod,
    raw,
    // Bosta refuses anything below -2000 outright (400 · errorCode "3008"), so
    // the clamp is required — but it is DECLARED, never silent. The remainder
    // is settled at the office, and the employee has to see the number.
    clipped: raw < COD_REFUND_MIN,
    remainder: raw < COD_REFUND_MIN ? Math.abs(raw - COD_REFUND_MIN) : 0,
  };
}

// ─── §RE-UPLOAD::buildPayloadParts ───
// Everything the payload needs that comes from the cycle, in one place, so the
// validation below and the payload builder can never disagree about it.
function buildPayloadParts(order, jobType) {
  const cycle    = order?.currentCycle || null;
  const returns  = resolveReturnItems(cycle);
  const outgoing = Array.isArray(order?.outgoingItems) ? order.outgoingItems : [];
  const money    = resolveCod(order);

  // Goods value = what is TRAVELLING. On an exchange that is the outgoing
  // package; on a return it is the pieces coming back. Same rule the Excel
  // file has used since v5.6.0.
  const goodsValue = outgoing.length ? valueItems(outgoing) : valueItems(returns);

  return {
    ...money,
    returnItems: returns,
    returnCount: countItems(returns),
    returnDescription: describeItems(returns),
    outgoingCount: countItems(outgoing),
    outgoingDescription: describeItems(outgoing),
    goodsValue: Math.round(goodsValue * 100) / 100,
  };
}

// ─── §RE-UPLOAD::validateReOrder ───
// worker-builder ⑩① — every cheap check runs BEFORE the irreversible call.
// Creating the shipment costs real money; a rejection afterwards leaves a paid
// shipment nobody asked for.
function validateReOrder(order, plan, parts, jobType) {
  const problems = [];
  const sa = order.shippingAddress || {};

  if (!plan.ok) { problems.push(plan.error); return problems; }

  if (!wirePhone(sa.phone) || normPhone(sa.phone).length < 8) {
    problems.push('رقم تليفون الشحن ناقص أو غير صالح');
  }
  const fullName = cleanText(sa.name) || `${cleanText(sa.firstName)} ${cleanText(sa.lastName)}`.trim();
  if (!fullName) problems.push('اسم المستلم فاضي — firstName إلزامي عند بوسطة');

  const firstLineLen = [sa.address1, sa.address2, sa.city, sa.province].filter(Boolean).join(' ').length;
  if (firstLineLen <= 5) problems.push('العنوان أقصر من الحد الأدنى (أكتر من ٥ حروف)');

  if (parts.cod > COD_MAX) {
    problems.push(`قيمة التحصيل ${parts.cod.toLocaleString('en-US')} أعلى من الحد الموثّق ${COD_MAX.toLocaleString('en-US')}`);
  }

  // A shipment with no package on either side is not a shipment. The exchange
  // side is already blocked upstream (EXCHANGE_WITHOUT_ITEMS); this catches the
  // return side, which nothing else checks.
  if (!parts.returnCount) {
    problems.push('مفيش ولا قطعة راجعة في الدورة المفتوحة — الشحنة مالهاش محتوى، الرفع اتوقف');
  }
  if (jobType === 'exchange' && !parts.outgoingCount) {
    problems.push('مفيش ولا قطعة خارجة على الاستبدال — الرفع اتوقف');
  }
  return problems;
}

// ─── §RE-UPLOAD::createDelivery ───
// 🔴 Success is `res.ok && body.success` — checking `=== 201` is BANNED.
// The docs say 200 and the live call returned 201; testing an explicit number
// means a shipment that really was created gets counted as a failure and the
// employee re-uploads → a duplicate shipment with real money.
async function createDelivery(env, payload, documented) {
  const url = documented ? `${BOSTA_BASE}/deliveries?apiVersion=1` : `${BOSTA_BASE}/deliveries`;
  let resp, text;
  try {
    resp = await fetch(url, { method: 'POST', headers: bostaHeaders(env), body: JSON.stringify(payload) });
    text = await resp.text();
  } catch (e) {
    throw new Error(`بوسطة: فشل الاتصال — ${e.message}`);
  }
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON — shown raw below */ }

  if (resp.ok && body?.success) {
    const d = body.data && typeof body.data === 'object' ? body.data : body;
    return {
      ok: true,
      status: resp.status,
      trackingNumber: d?.trackingNumber != null ? String(d.trackingNumber) : null,
      bostaId: d?._id || d?.id || null,
    };
  }
  return {
    ok: false,
    status: resp.status,
    errorCode: body?.errorCode != null ? String(body.errorCode) : null,   // 🔴 string, not number
    message: body?.message || body?.error || text.slice(0, 300) || `HTTP ${resp.status}`,
  };
}

// ─── §RE-UPLOAD::terminateDelivery ───
// The undo. 🔴 By trackingNumber — the `_id` route returns 404.
// After it succeeds the shipment DISAPPEARS (a later GET returns
// "400 Delivery not found."), and the uniqueBusinessReference is freed, so a
// corrected re-upload of the same cycle goes through.
async function terminateDelivery(env, trackingNumber) {
  const tn = cleanText(trackingNumber);
  if (!tn) return { ok: false, status: 0, message: 'رقم التتبع فاضي' };
  let resp, text;
  try {
    resp = await fetch(`${BOSTA_BASE}/deliveries/business/${encodeURIComponent(tn)}/terminate`, {
      method: 'DELETE', headers: bostaHeaders(env),
    });
    text = await resp.text();
  } catch (e) {
    return { ok: false, status: 0, message: `فشل الاتصال ببوسطة — ${e.message}` };
  }
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* raw text below */ }
  if (resp.ok) return { ok: true, status: resp.status };
  return {
    ok: false,
    status: resp.status,
    errorCode: body?.errorCode != null ? String(body.errorCode) : null,
    message: body?.message || body?.error || text.slice(0, 200) || `HTTP ${resp.status}`,
  };
}

// ─── §RE-UPLOAD::humanizeBostaError ───
function humanizeBostaError(res) {
  const code = res.errorCode;
  if (code === '11000') {
    return 'بوسطة رافضة: الدورة دي مرفوعة عندها بالفعل ومعاها شحنة شغّالة '
         + '(uniqueBusinessReference مكرر). لو الشحنة القديمة غلط، ألغيها الأول بزرار «إلغاء الشحنة» وبعدين ارفع تاني.';
  }
  if (code === '3008') return `بوسطة رافضة: أقصى مبلغ استرداد عند الباب ${COD_REFUND_MIN} جنيه`;
  if (code === '3003') return 'بوسطة رافضة: المنطقة غير موجودة عندها (District Not Found)';
  if (code === '3002') return 'بوسطة رافضة: المدينة غير موجودة عندها';
  if (code === '1028') return 'بوسطة رافضة: مفتاح الـ API غير صالح — راجع BOSTA_API_KEY';
  // 🔴 A CRP built with the customer address in the wrong field answers 500 with
  // NO errorCode, so the humaniser must survive a code-less failure.
  if (res.status >= 500) {
    return `بوسطة ردّت بخطأ داخلي (HTTP ${res.status}): ${res.message} — `
         + 'غالبًا شكل العنوان غلط للنوع ده. بلّغ عن الأوردر ده بدل ما تعيد المحاولة.';
  }
  return `بوسطة رافضة (HTTP ${res.status}${code ? ` · كود ${code}` : ''}): ${res.message}`;
}

// ─── §RE-UPLOAD::uploadOne ───
// Four result states, not two — worker-builder Step 5A ④.
// 🔴 `warning` here means THE SHIPMENT EXISTS at Bosta with a tracking number
// and something after it did not complete. It must never be shown as failure:
// re-uploading buys a second shipment with real money.
async function uploadOne(env, order, catalog, job, override) {
  const actions = [];
  const row = {
    orderId: cleanText(order.id),
    orderName: cleanText(order.name),
    status: 'error',
    actions,
    trackingNumber: null,
    bostaId: null,
    uref: null,
    contractUsed: null,
    citySent: null,
    cityAuto: null,
    districtSent: null,
    cityOverridden: false,
    codSent: null,
    codClipped: false,
    codRemainder: 0,
    warnings: [],
    error: null,
  };

  const plan  = resolveAddress(order, catalog);
  const parts = buildPayloadParts(order, job.jobType);

  const problems = validateReOrder(order, plan, parts, job.jobType);
  if (problems.length) { row.error = problems.join(' · '); return row; }

  const ref = buildUniqueRef(order, job.jobType);
  if (!ref.ok) { row.error = `${ref.code}: ${ref.action}`; return row; }
  row.uref = ref.uref;

  // ─── the employee's manual override beats the automatic match ───
  // 🔴 It may change the CITY, not only the district: Bosta's grouping is not
  // the administrative one, and customers pick the wrong governorate. Without
  // it those rows have no manual fix at all — and a wrong city is not a neutral
  // fallback like a missing district, it decides the branch and the price.
  // ⚠️ The override is written INTO planUsed on purpose: the payload, the row
  // fields and the 3003 fallback all read from it, so the fallback keeps the
  // corrected city. A side variable would silently resend the wrong one.
  let mode = plan.mode;
  const planUsed = { ...plan };

  const ovCityId = override?.cityId || null;
  if (ovCityId && ovCityId !== plan.cityId) {
    const ovCity = catalog.cities.find((c) => c.cityId === ovCityId);
    if (!ovCity) {
      row.error = `المدينة المختارة يدويًا (${ovCityId}) مش موجودة في كتالوج بوسطة — `
                + 'الرفع اتوقف بدل ما يتبعت على المدينة الأصلية';
      return row;
    }
    planUsed.cityId   = ovCity.cityId;
    planUsed.cityName = ovCity.cityName;
    row.cityOverridden = true;
  }

  if (override?.districtId) {
    const city = catalog.cities.find((c) => c.cityId === planUsed.cityId);
    const { list } = availableDistricts(city);
    const d = list.find((x) => x.id === override.districtId);
    // 🔴 Not found = STOP, never a silent fall back to the automatic match. The
    // employee explicitly picked a district; shipping to a different one
    // without telling them is a paid shipment to an address they did not approve.
    if (!d) {
      row.error = `المنطقة المختارة يدويًا مش موجودة (أو مش متاحة للتسليم) في `
                + `مدينة ${planUsed.cityName} عند بوسطة — الرفع اتوقف. افتح النافذة واختر من الأول.`;
      return row;
    }
    mode = 'district';
    planUsed.districtId   = d.id;
    planUsed.districtName = d.name;
  } else if (override?.forceProvince || row.cityOverridden) {
    mode = 'province';
  }

  const parts2 = { ...parts, uref: ref.uref };
  let documented = mode === 'district' || mode === 'zoneName';
  let payload = buildRePayload(order, planUsed, mode, job.jobType, parts2);

  let res;
  try {
    res = await createDelivery(env, payload, documented);
  } catch (e) {
    row.error = e.message;
    return row;
  }

  row.contractUsed = documented ? 'documented' : 'undocumented';
  row.citySent     = planUsed.cityName;
  row.cityAuto     = plan.cityName;
  row.districtSent = (mode === 'district' || mode === 'zoneName') ? planUsed.districtName : null;
  row.codSent      = parts.cod;
  row.codClipped   = parts.clipped;
  row.codRemainder = parts.remainder;

  // 🔴 errorCode is a STRING — comparing it to the number 3003 means this
  // fallback never runs.
  if (!res.ok && String(res.errorCode) === '3003' && documented) {
    row.warnings.push(`بوسطة رفضت المنطقة "${row.districtSent}" — اترفعت على مستوى المحافظة بدلها`);
    mode = 'province';
    documented = false;
    payload = buildRePayload(order, planUsed, 'province', job.jobType, parts2);
    try {
      res = await createDelivery(env, payload, false);
    } catch (e) {
      row.error = e.message;
      return row;
    }
    row.contractUsed = 'undocumented';
    row.districtSent = null;
  }

  if (!res.ok) { row.error = humanizeBostaError(res); return row; }

  actions.push(`رفع شحنة ${job.label} على بوسطة (${row.contractUsed === 'documented' ? 'بالمنطقة' : 'بالمحافظة'})`);
  row.trackingNumber = res.trackingNumber;
  row.bostaId        = res.bostaId;

  if (parts.clipped) {
    row.warnings.push(
      `العميل ليه ${Math.abs(parts.raw).toLocaleString('en-US')} — بوسطة هترجّع `
      + `${Math.abs(COD_REFUND_MIN).toLocaleString('en-US')} بس (حد بوسطة)، والباقي `
      + `${parts.remainder.toLocaleString('en-US')} يتسوّى مكتبيًا`,
    );
  }
  if (row.cityOverridden) {
    row.warnings.push(`المدينة اتغيّرت يدويًا من ${row.cityAuto} إلى ${row.citySent}`);
  }

  // 🔴 Past this point the shipment EXISTS and costs money. Everything after it
  // is a warning, never an error (worker-builder ⑩②).
  if (!res.trackingNumber) {
    row.status = 'warning';
    row.warnings.push('بوسطة قبلت الشحنة بس ما رجّعتش رقم تتبع — دوّر عليها على الداشبورد برقم الأوردر قبل أي إعادة رفع');
    return row;
  }

  row.status = row.warnings.length ? 'warning' : 'success';
  return row;
}

// ─── §RE-UPLOAD::runUploadBatch ───
// Conservative parallelism: Bosta publishes no rate limits anywhere, so the
// number is measured, never guessed (`bosta-api-helper` — "صفر ذكر لـ rate
// limits في التوثيق").
// ⚠️ Results come back in INPUT order regardless of completion order — the page
// pairs them with its rows by index (worker-builder ⑬).
async function runUploadBatch(env, orders, catalog, job, overrides) {
  const out = new Array(orders.length);
  let cursor = 0;

  async function worker() {
    while (cursor < orders.length) {
      const i = cursor++;
      const order = orders[i];
      try {
        out[i] = await uploadOne(env, order, catalog, job, overrides[cleanText(order.id)] || null);
      } catch (e) {
        out[i] = {
          orderId: cleanText(order.id), orderName: cleanText(order.name),
          status: 'error', actions: [], warnings: [],
          trackingNumber: null, error: `خطأ غير متوقع: ${e.message}`,
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONC, orders.length) }, worker));
  return out;
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

        // v6.0.0 — the catalogue is best-effort. Bosta being unreachable must
        // not take the Excel path down with it, so the failure is reported
        // rather than thrown: every row simply arrives without an address plan
        // and the page disables the direct-upload button and says why.
        let catalog = null;
        let catalogError = null;
        try {
          catalog = await getCatalog(env);
        } catch (e) {
          catalogError = e.message;
        }

        const result = await fetchCandidateOrders(env, token, job, catalog);

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
            catalogLoaded: !!catalog,
            catalogError,
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
          catalogLoaded: !!catalog,
          catalogError,
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

        const duplicates = await findExportDuplicateStats(env.DB, orders);

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

        const duplicateMap = await findExportDuplicateStats(env.DB, orders);
        const blocked = Object.keys(duplicateMap);
        if (blocked.length && !allowRepeat) {
          return json({
            ok: false,
            code: 'DUPLICATES_FOUND',
            error: 'يوجد أوردرات تم تصدير نفس دورتها Excel قبل كده — راجع نافذة التكرار واسمح بالتصدير لو عايز تكمل',
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
            // Half of the duplicate key — read back by findExportDuplicateStats
            // on every later export of this order (v5.3.0).
            cycleName: order.cycleName,
            cycleCreatedAt: order.cycleCreatedAt,
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

        // One open R/E cycle at a time — checked against Shopify, not against
        // what the page sent. Rejected BEFORE any write (Rule 15 ①).
        const blockedCycles = await findBlockedCycleOrders(env, token, orders, job.jobType);
        if (blockedCycles.length) {
          const { logged, logError } = await logCycleBlocks(env.DB, blockedCycles, job, employee);
          return json({
            ok: false,
            code: 'CYCLE_BLOCKED',
            error: 'فيه أوردرات حالة دورات الاسترجاع فيها مش واضحة — اتمنع تحديث الحالة لحد ما تتصلّح في شوبيفاي',
            blocked: blockedCycles,
            logged,
            logError,
          }, 409, request);
        }

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

      // ─── §RE-UPLOAD-ENDPOINTS — v6.0.0 ────────────────────
      // Without cityId: every Bosta city (for the city picker).
      // With cityId: that city's districts, filtered to dropOffAvailability.
      if (action === 'get_districts') {
        const catalog = await getCatalog(env, { force: url.searchParams.get('force') === '1' });
        ensureNormalized(catalog);
        const cityId = cleanText(url.searchParams.get('cityId'));

        if (!cityId) {
          return json({
            ok: true,
            fetchedAt: catalog.fetchedAt,
            cities: catalog.cities.map((c) => ({
              cityId: c.cityId,
              cityName: c.cityName,
              cityAr: c.cityAr,
              districtCount: availableDistricts(c).list.length,
            })),
          }, 200, request);
        }

        const city = catalog.cities.find((c) => c.cityId === cityId);
        if (!city) return json({ ok: false, error: 'المدينة دي مش في كتالوج بوسطة' }, 404, request);
        const { list, fieldMissing } = availableDistricts(city);
        return json({
          ok: true,
          cityId: city.cityId,
          cityName: city.cityName,
          // Reported, never silent: an empty list because Bosta stopped sending
          // the field is a different fact from a city with no drop-off areas.
          catalogWarning: fieldMissing ? 'dropOffAvailability غايب من كتالوج بوسطة — القايمة اتفضّت بسببه مش لأن مفيش مناطق' : null,
          districts: list.map((d) => ({ id: d.id, name: d.name, nameAr: d.nameAr, zone: d.zone, zoneAr: d.zoneAr })),
        }, 200, request);
      }

      // Creates REAL, PAID shipments. Order of operations is fixed by
      // worker-builder ⑩: every cheap check first, the irreversible call next,
      // and everything after it is a warning — never an error.
      if (action === 'upload_re') {
        assertPost(request);
        assertBostaEnv(env);

        const body = await request.json().catch(() => ({}));
        const job = getJobConfig(body.jobType);
        const employee = cleanText(body.employee);
        const orders = normalizeOrderPayload(body.orders);
        const overrides = body.overrides && typeof body.overrides === 'object' ? body.overrides : {};

        if (!employee) return json({ ok: false, error: 'employee مطلوب' }, 400, request);
        if (!orders.length) return json({ ok: false, error: 'لا توجد أوردرات للرفع' }, 400, request);
        // ② of the three-cap chain — a paste guard and the Cloudflare subrequest
        // ceiling, NOT the page's chunk size and NOT the query-cost cap.
        if (orders.length > MAX_UPLOAD_BATCH) {
          return json({ ok: false, error: `أقصى عدد في الدفعة الواحدة ${MAX_UPLOAD_BATCH} أوردر` }, 400, request);
        }

        const token = await getAccessToken(env);

        // ① One open R/E cycle at a time, re-read from Shopify — not trusted
        // from the page. In v5 this gate stood in front of a metafield write;
        // now it stands in front of a paid shipment, so it matters more, not
        // less. Rule 15 ① — reject + log, before anything irreversible.
        const blockedCycles = await findBlockedCycleOrders(env, token, orders, job.jobType);
        if (blockedCycles.length) {
          const { logged, logError } = await logCycleBlocks(env.DB, blockedCycles, job, employee);
          return json({
            ok: false,
            code: 'CYCLE_BLOCKED',
            error: 'فيه أوردرات حالة دورات الاسترجاع فيها مش واضحة — اتمنع الرفع على بوسطة لحد ما تتصلّح في شوبيفاي',
            blocked: blockedCycles,
            logged,
            logError,
          }, 409, request);
        }

        // ② Re-read the full rows from Shopify. The page sends ids and names
        // only, so the address, the money and the cycle contents all come from
        // Shopify at upload time — never from a screen that may be minutes old.
        const catalog = await getCatalog(env);
        const fresh = await fetchNodesWithCostFallback(env, token, buildDetailsQuery(), orders.map((o) => o.id));
        const byId = new Map();
        const lateBlocks = [];
        for (const order of fresh) {
          const { current, outgoing, info } = analyzeReturnCycles(order, job.jobType);
          // The guard above ran on a separate, cheaper query. Re-checking the
          // full read closes the window between the two: a cycle that changed
          // in those seconds would otherwise be shipped anyway. Cheap here,
          // because this analysis is being computed regardless.
          if (info.blocked) {
            lateBlocks.push({
              id: order.id, name: order.name,
              s2Status: cleanText(order?.s2Status?.value) || null,
              code: info.blockReason.code, value: info.blockReason.value, action: info.blockReason.action,
            });
            continue;
          }
          byId.set(order.id, { ...order, currentCycle: current, outgoingItems: outgoing.items });
        }
        if (lateBlocks.length) {
          const { logged, logError } = await logCycleBlocks(env.DB, lateBlocks, job, employee);
          return json({
            ok: false,
            code: 'CYCLE_BLOCKED',
            error: 'حالة الدورات اتغيّرت بين الفحص والرفع — الرفع اتوقف قبل أي شحنة',
            blocked: lateBlocks,
            logged,
            logError,
          }, 409, request);
        }

        const missing = orders.filter((o) => !byId.has(o.id));
        if (missing.length) {
          // worker-builder Step 5A ④ — "we could not read it" is never "fine".
          return json({
            ok: false,
            code: 'ORDER_NOT_READABLE',
            error: 'شوبيفاي ما رجّعتش كل الأوردرات وقت الرفع — الرفع اتوقف كله بدل ما يتم على جزء',
            missing: missing.map((o) => o.name),
          }, 409, request);
        }

        // ③ The irreversible part.
        const ordered = orders.map((o) => byId.get(o.id));
        const results = await runUploadBatch(env, ordered, catalog, job, overrides);

        // ④ S2 is written ONLY for rows whose shipment actually exists, and it
        // reuses confirm_upload's write+verify pair so there is one code path
        // for the metafield and its verification.
        const uploaded = results
          .map((r, i) => ({ r, order: orders[i] }))
          .filter(({ r }) => r.status !== 'error' && r.trackingNumber);

        const now = nowToSecond();
        let s2Error = null;
        // 🔴 PER ORDER, not per batch. `verifyManualStatus` already answers per
        // order, and one mismatch used to mark every uploaded row as a failed
        // write — logging the old status for orders that did move and dropping
        // their `metafields_change` row, so a correct update vanished from the
        // cycle-time KPIs. Only a thrown error is genuinely batch-wide.
        const s2Failed = new Set();

        if (uploaded.length) {
          const targets = uploaded.map(({ order }) => order);
          try {
            await setManualStatus(env, token, targets, job.nextStatus, now);
            const mismatches = await verifyManualStatus(env, token, targets, job.nextStatus, now);
            for (const m of mismatches) s2Failed.add(m.id);
            if (mismatches.length) {
              s2Error = `التحقق رجّع قيم غير متوقعة على: ${mismatches.map((m) => m.name).join('، ')}`;
            }
          } catch (e) {
            // The write itself failed — we cannot tell which orders landed, so
            // every uploaded row is treated as unverified.
            s2Error = e.message;
            for (const { order } of uploaded) s2Failed.add(order.id);
          }

          for (const { r, order } of uploaded) {
            if (!s2Failed.has(order.id)) { r.actions.push(`تحديث S2 إلى ${job.nextStatus}`); continue; }
            // A failure here NEVER turns a row red. The shipment exists and is
            // paid for; red makes the employee upload again and buy a second
            // one. It downgrades to warning and says what to fix by hand.
            r.status = 'warning';
            r.warnings.push(
              `الشحنة اترفعت (${r.trackingNumber}) لكن تحديث الحالة إلى ${job.nextStatus} فشل: ${s2Error} — `
              + 'غيّر الحالة يدويًا. **متعيدش الرفع** — ده بيعمل شحنة تانية بفلوس.',
            );
            r.shopifyWriteFailed = true;
          }
        }
        const s2Written = uploaded.length > 0 && s2Failed.size === 0;

        // ⑤ Logging. `type` splits by EXTERNAL EFFECT (worker-builder ⑭), which
        // is why a failed upload and a failed write-back are different values:
        // one is safe to retry and the other is not.
        const logRows = results.map((r, i) => {
          const order = orders[i];
          const type = r.status === 'error' ? UPLOAD_FAILED_TYPE
                     : r.shopifyWriteFailed ? WRITE_FAILED_TYPE
                     : UPLOAD_TYPE_BY_JOB[job.jobType];
          return {
            timestamp: now,
            tool: TOOL_NAME,
            type,
            employee,
            orderId: order.id,
            orderName: order.name,
            valueBefore: order.s2Status || job.expectedStatus,
            // The status only moved for rows that actually got there.
            valueAfter: (r.status !== 'error' && !r.shopifyWriteFailed) ? job.nextStatus : (order.s2Status || job.expectedStatus),
            notes: r.status === 'error'
              ? `فشل رفع ${job.label} على بوسطة — ${r.error}`
              : `رفع ${job.label} على بوسطة · تتبع ${r.trackingNumber || '—'}${r.warnings.length ? ` · ${r.warnings.join(' · ')}` : ''}`,
            extra: {
              jobType: job.jobType,
              result: r.status,
              trackingNumber: r.trackingNumber,
              bostaId: r.bostaId,
              uniqueBusinessReference: r.uref,
              businessReference: order.name,
              contractUsed: r.contractUsed,
              citySent: r.citySent,
              cityAuto: r.cityAuto,
              // The measurement that says which cities deserve a row in the
              // province table instead of a manual fix every time.
              cityOverridden: r.cityOverridden,
              districtSent: r.districtSent,
              codSent: r.codSent,
              codClipped: r.codClipped,
              codRemainder: r.codRemainder,
              cycleName: order.cycleName || null,
              warnings: r.warnings,
              error: r.error,
            },
          };
        });

        let logged = true;
        let logError = null;
        try {
          await writeLogsBatch(env.DB, logRows);
        } catch (e) {
          // Step 5A ⑦ — a D1 failure does not undo the shipments, but it must
          // never be silent.
          logged = false;
          logError = e.message;
        }

        // Cross-tool status history — cycle-time / R-E-cycle KPIs read only
        // tool='metafields_change', so this S2 move has to appear there too.
        const s2Landed = uploaded.filter(({ order }) => !s2Failed.has(order.id));
        if (s2Landed.length) {
          try {
            await writeLogsBatch(env.DB, s2Landed.map(({ order }) => ({
              timestamp: now,
              tool: 'metafields_change',
              type: 'update',
              employee,
              orderId: order.id,
              orderName: order.name,
              valueBefore: order.s2Status || job.expectedStatus,
              valueAfter: job.nextStatus,
              notes: `status_2_r_e: ${order.s2Status || job.expectedStatus} → ${job.nextStatus} (via ${TOOL_NAME} upload_re)`,
              extra: { metafieldKey: 'custom.status_2_r_e', sourceTool: TOOL_NAME, jobType: job.jobType },
            })));
          } catch (e) {
            logged = false;
            logError = `${logError ? logError + ' | ' : ''}metafields_change: ${e.message}`;
          }
        }

        const counts = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
        return json({
          ok: true,
          jobType: job.jobType,
          nextStatus: job.nextStatus,
          // ⚠️ Ordering contract: `results[i]` belongs to `orders[i]` from the
          // request, whatever order the uploads finished in.
          results,
          counts,
          s2Written,
          s2Error,
          logged,
          logError,
        }, 200, request);
      }

      // The undo. Terminating frees the uniqueBusinessReference, so a corrected
      // re-upload of the same cycle goes through afterwards — that pairing is
      // the whole reason this endpoint exists rather than a dashboard visit.
      if (action === 'cancel_re') {
        assertPost(request);
        assertBostaEnv(env);

        const body = await request.json().catch(() => ({}));
        const employee = cleanText(body.employee);
        const trackingNumber = cleanText(body.trackingNumber);
        const orderId = cleanText(body.orderId) || null;
        const orderName = cleanText(body.orderName) || null;
        const reason = cleanText(body.reason) || null;

        if (!employee) return json({ ok: false, error: 'employee مطلوب' }, 400, request);
        if (!trackingNumber) return json({ ok: false, error: 'trackingNumber مطلوب' }, 400, request);

        const res = await terminateDelivery(env, trackingNumber);

        let logged = true;
        let logError = null;
        try {
          await writeLog(env.DB, {
            tool: TOOL_NAME,
            type: CANCEL_TYPE,
            employee,
            orderId,
            orderName,
            notes: res.ok
              ? `إلغاء شحنة بوسطة ${trackingNumber}${reason ? ` — ${reason}` : ''}`
              : `فشل إلغاء شحنة بوسطة ${trackingNumber} — ${res.message}`,
            extra: { trackingNumber, result: res.ok ? 'success' : 'error', status: res.status, errorCode: res.errorCode || null, message: res.message || null, reason },
          });
        } catch (e) {
          logged = false;
          logError = e.message;
        }

        if (!res.ok) {
          return json({ ok: false, error: `فشل الإلغاء: ${res.message}`, status: res.status, logged, logError }, 502, request);
        }
        return json({
          ok: true,
          trackingNumber,
          // 🔴 The S2 status is deliberately NOT rolled back here. Undoing a
          // status move is a different decision from cancelling a shipment, and
          // guessing which one the employee meant would rewrite live state.
          note: 'الشحنة اتلغت عند بوسطة. حالة الأوردر على شوبيفاي ما اتغيّرتش — غيّرها يدويًا لو محتاج.',
          logged,
          logError,
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

        // v6.0.0 — Bosta is now a write path, so diag has to say whether the
        // key is set and whether the catalogue actually parses. A catalogue
        // that returns zero cities means the response SHAPE changed, not that
        // Bosta has no cities — so the counts are reported, never a bare ok.
        let bosta = { ok: false, keySet: false, error: null, cities: null, districts: null, dropOffDistricts: null, fetchedAt: null };
        try {
          assertBostaEnv(env);
          bosta.keySet = true;
          const catalog = await getCatalog(env);
          ensureNormalized(catalog);
          const districts = catalog.cities.reduce((n, c) => n + c.districts.length, 0);
          const dropOff = catalog.cities.reduce((n, c) => n + availableDistricts(c).list.length, 0);
          bosta = { ok: true, keySet: true, error: null, cities: catalog.cities.length, districts, dropOffDistricts: dropOff, fetchedAt: catalog.fetchedAt };
        } catch (e) {
          bosta.error = e.message;
        }

        return json({
          ok: true,
          workerVersion: WORKER_VERSION,
          envKeys,
          shopify,
          d1,
          bosta,
          bostaTypes: BOSTA_TYPE_BY_JOB,
          codLimits: { max: COD_MAX, refundMin: COD_REFUND_MIN },
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
