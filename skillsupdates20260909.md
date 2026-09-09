<div dir="rtl" style="text-align: right;">

# تحديثات المهارات — 09-09-2026

> **المصدر:** حالة `#53531` (بلاغ أحمد) + الفحص الحي اللي اتعمل عليها في
> جلسة `Bosta-Return-Exchange-Exporter` v5.5.0/v5.6.0.
> **الملف ده مكتفي بذاته** — الجلسة اللي هتطبّقه مش محتاجة تقرا الجلسة الأصلية.
> الصيغة والتصنيف والإجراء → `ecommoda-skill-versioning`.

---

## 0 · الاكتشاف — في سطرين

`return.exchangeLineItems` **بتفضى خالص** لما قطعة الاستبدال اللي شوبيفاي عملها
تتشال بتعديل أوردر (Order edit) وتتحط قطعة تانية بالإيد. شوبيفاي في الـ Admin
**لسه** بتطبع «Exchange item for return #X» على السطر المشال — يعني الشاشة والـ
API بيقولوا حاجتين مختلفين، والـ API هو اللي الأدوات بتقرا منه.

النتيجة: أي كود بيسأل «الأوردر ده استبدال؟» أو «إيه اللي خارج فيه؟» عن طريق
`exchangeLineItems` بيرجّع **لأ / لا شيء** على استبدال حي وشغّال.

---

## 1 · الأدلة الحية (كلها متقاسة 09-09-2026)

### 1.1 · الحالة الأصلية — `#53531`

```
Order  gid://shopify/Order/7196813328706   ·   S2 = Confirmed + EXCHANGE
Return #53531-R1   status OPEN   createdAt 2026-09-08T15:38:03Z
       returnLineItems  : WA-SK-65 / Black / 42  x1  @2300   ← الراجع
       exchangeLineItems: []                                  ← فاضية!

lineItems:
  17498284523842  WA-SK-65 / Black / 42  currentQuantity 0  unfulfilled 0  @2300  ← الراجع
  17510574686530  WA-SK-65 / Black / 43  currentQuantity 0  unfulfilled 0  @2200  ← قطعة الاستبدال الأصلية، اتشالت بتعديل
  17511038058818  WA-SK-65 / Black / 43  currentQuantity 1  unfulfilled 1  @2300  ← القطعة اللي اتحطت بالإيد = اللي هتتشحن فعلاً

fulfillmentOrders:
  8103203864898  CLOSED  (الراجع)
  8109962821954  CLOSED  totalQuantity 0  (المشالة)
  8110210711874  OPEN    remainingQuantity 1  → LineItem 17511038058818   ← الحقيقة الفيزيائية
```

الأثر في ملف بوسطة: `Package Description` فاضي · `No. of Items` فاضي ·
`Goods Value` رجع لسعر القطعة **الراجعة**.

### 1.2 · حالة تانية مستقلة — `#53701`

نفس التوقيع بالظبط: `exchangeLineItems: []`، الراجع `Hi1 / Beige / 46 @2600`،
والخارج فعلاً `HI-COL-20 / Black / 45 @2400` (`currentQuantity 1`،
`unfulfilledQuantity 1`).
👈 هنا الغلط **في الفلوس ظاهر**: الملف كان هيقول `Goods Value = 2600` بدل `2400`.
يعني ده مش عيب تجميلي — ده رقم غلط بيروح للكوريير.

### 1.3 · الضابط — استبدال سليم `#53227`

```
exchangeLineItems: [ RN-AD-115 / Black / 42  x1 @2400 ]
lineItems ذات unfulfilledQuantity > 0: RN-AD-115 / Black / 42  ← نفس القطعة بالظبط، ١:١
lineItems أخرى بـ currentQuantity 1 بس unfulfilled 0: AKS35 / Grey / 44 · AKS35 / Navy / 44  ← اتسلّمت، مش خارجة
```

👈 المصدر البديل **مابيزوّدش** حاجة على الاستبدال السليم، فالدمج بين المصدرين
كان هيعدّ القطعة **مرتين**. لازم يكون fallback مش merge.

### 1.4 · الاسترجاعات الصافية

`#53517` · `#53389` · `#53240` · `#52704` · `#52457` — كلها
`unfulfilledQuantity = 0` على كل السطور. 👈 المصدر البديل **فاضي** على
الاسترجاع، فمابيقلبش استرجاع لاستبدال.

### 1.5 · حجم الظاهرة

مسح `return_status:in_progress` (أحدث ٢٥ أوردر بدورة مفتوحة): **٢ من ٢٥**
عليهم التوقيع (`#53531` · `#53701`). نادرة بس مش استثنائية — وكل واحدة منهم
بتنتج صف بوسطة غلط بصمت.

---

## 2 · `ecommoda-order-lifecycle` — المقترح: **v1.4.0 → v1.5.0**

> MINOR: البند الكاسر **تصحيح توثيق لقاعدة ناقصة**، مش قلب قاعدة. القاعدة كانت
> بتقول حقيقة صحيحة بس غير مكتملة، والأدوات اللي بنت عليها بتغلط في حالة واحدة
> محدودة. (نفس منطق v1.4.0.)

### 2.1 · 🔴 كاسر — Rule 8 ناقصة: `exchangeLineItems` ممكن تفضى على استبدال حي

**النص الحالي (SKILL.md، Rule 8):**

> 8. **Return vs Exchange is answered by the API, not by a metafield.**
>    `return.exchangeLineItems` empty → a return. Non-empty → an exchange. This is
>    available for every historical order and needs no new field. (Supersedes the
>    `custom.s2_type` proposal — see `known-gaps.md` G-2.)

**النص المقترح:**

> 8. **Return vs Exchange is answered by the API, not by a metafield.**
>    `return.exchangeLineItems` non-empty → an exchange. This is available for
>    every historical order and needs no new field. (Supersedes the
>    `custom.s2_type` proposal — see `known-gaps.md` G-2.)
>
>    ⚠️ **The reverse does NOT hold: empty is not proof of a return.** Verified
>    live 09-09-2026 on `#53531` and `#53701` — when the exchange line item
>    Shopify created is removed by an **order edit** and a replacement is added
>    by hand (routine when the size or colour changes after the exchange was
>    already booked), the connection goes empty and **stays** empty. The Shopify
>    Admin still prints *"Exchange item for return #X"* on the removed line, so
>    the UI and the API disagree and only the API is visible to a tool.
>
>    **Read `empty` as "no exchange pieces recorded on this cycle", never as
>    "this is a return".** Where the answer decides money or what physically
>    ships, corroborate before concluding:
>
>    | Question | Source |
>    |---|---|
>    | *"Is this cycle an exchange?"* (classification, KPIs, history) | `exchangeLineItems` non-empty → yes. Empty → **unknown**, not "return" — flag it. |
>    | *"What physically leaves the warehouse?"* | `exchangeLineItems` first; if empty, the order's own lines with `currentQuantity > 0 && unfulfilledQuantity > 0`. |
>
>    ```js
>    // ✅ fallback, never a merge — merging double-counts a healthy exchange
>    const fromCycle = (current?.exchangeLineItems?.nodes || []);
>    const outgoing  = fromCycle.length
>      ? fromCycle
>      : (order.lineItems?.nodes || []).filter(li =>
>          li.currentQuantity > 0 && li.unfulfilledQuantity > 0);
>    ```
>
>    `currentQuantity > 0` drops the line the edit removed (its original
>    `quantity` stays intact — only `currentQuantity` and `unfulfilledQuantity`
>    go to zero); `unfulfilledQuantity > 0` drops everything already delivered.
>    Validated on 25 live orders with an open cycle: empty on every pure return,
>    1:1 with `exchangeLineItems` on a healthy exchange (`#53227`), and the only
>    place the hand-added replacement appears.
>
>    ⚠️ **The fallback must not reclassify.** Run it only once the job is
>    already known to be an exchange. On a return job an unfulfilled line is far
>    more likely to be a never-shipped piece of the original order, and on a
>    partially fulfilled order it is a false positive by construction.

### 2.2 · 🟡 مُستحسن — `known-gaps.md` G-2 اتقفلت أوسع من الحقيقة

**الحالي:** `### G-2 · Return vs Exchange — **SOLVED via the API**`

**المقترح:** تفضل مقفولة (الاتجاه الإيجابي شغّال)، بس يتضاف تحتها:

> ⚠️ **مقفولة في اتجاه واحد.** `exchangeLineItems` غير فاضية = استبدال، دايمًا.
> فاضية **مش** = استرجاع: تعديل أوردر بيفضّيها على استبدال حي (متقاس
> 09-09-2026 — `#53531` · `#53701`). التفاصيل والمصدر البديل → Rule 8.
> ده **مش** سبب لإحياء مقترح `custom.s2_type`: الميتافيلد كان هيتكتب مرة
> ويبوظ بنفس التعديل. الحل قراءة، مش حقل جديد.

### 2.3 · 🟡 مُستحسن — ثغرة جديدة `G-16`

> ### G-16 · تعديل الأوردر بعد الاستبدال الرسمي بيقطع الرابط ومفيش تنبيه
>
> **الوضع:** خدمة العملاء بتعمل الاستبدال في شوبيفاي (بيولّد
> `ExchangeLineItem`)، وبعدين المقاس/اللون بيتغيّر فبتتشال القطعة وتتحط
> واحدة بالإيد. الرابط بين الدورة والقطعة الخارجة **بيموت صامت**.
>
> **الأثر المتقاس:** ٢ من أحدث ٢٥ أوردر بدورة مفتوحة. كل واحد بيطلع في ملف
> بوسطة من غير وصف شحنة ومن غير عدد، وبـ `Goods Value` بتاع القطعة الراجعة
> (`#53701`: 2600 بدل 2400).
>
> **الحل المطبّق (قراءة):** fallback على السطور غير المشحونة — Rule 8.
> بيصلّح الملف، بس **مابيصلّحش** بيانات شوبيفاي: الدورة نفسها بتفضل من غير
> قطع استبدال، فأي KPI بيعدّ «دورات استبدال» من `exchangeLineItems` هيفضل
> ناقص عليها.
>
> **الحل الجذري (عملية، مش كود):** خدمة العملاء تعدّل قطعة الاستبدال **جوّه**
> الـ Return في شوبيفاي بدل ما تشيلها وتضيف سطر جديد. لو ده مش ممكن في واجهة
> شوبيفاي، الثغرة تفضل مفتوحة ويتسجّل عليها الأثر على التقارير.
>
> **الأولوية:** 🔴 P1 — بيأثر على صحة أرقام معروضة (قيمة الشحنة + عدّ دورات
> الاستبدال).

### 2.4 · ⚪ تحريري — `references/sweep-checks.yaml`

وصفة فحص جديدة (الصيغة زي الموجودة في الملف):

```yaml
- id: OLC-R8-exchange-empty-fallback
  rule: "Rule 8"
  since: "v1.5.0"
  severity: high
  question: >
    هل الأداة بتقرا `exchangeLineItems` وبتفسّر الفاضي على إنه استرجاع،
    أو بتبني عليه وصف/عدد/قيمة شحنة خارجة من غير fallback؟
  grep: "exchangeLineItems"
  verdict: >
    مصاب لو الفاضي بيتحوّل لـ "return"/"no exchange" أو لو قيمة الشحنة
    بترجع للقطع الراجعة من غير ما يتفحص
    `currentQuantity > 0 && unfulfilledQuantity > 0` على `order.lineItems`.
    سليم لو فيه fallback (مش merge) ومحصور على وظيفة الاستبدال.
  fixed_reference: "Bosta-Return-Exchange-Exporter index.js v5.5.0 §SHOPIFY::outgoingItems"
```

### 2.5 · بند CHANGELOG المقترح

```markdown
## v1.5.0 — 09-09-2026

> **بند 🔴 كاسر + بندين 🟡 + بند ⚪.** المصدر: حالة `#53531` من أحمد + فحص
> حي على ٢٥ أوردر بدورة مفتوحة — `skillsupdates20260909.md`.
>
> **ليه MINOR رغم البند الكاسر:** Rule 8 ما اتقلبتش — اتكمّلت. الاتجاه
> الموجب («غير فاضية = استبدال») صح زي ما هو؛ اللي كان غلط هو عكسه الضمني.
> الأدوات اللي بتقرا الاتجاه الموجب بس سليمة.

🔴 كاسر — **Rule 8: `exchangeLineItems` الفاضية مش دليل على استرجاع**
   تعديل أوردر بيشيل قطعة الاستبدال بيفضّي الـ connection نهائيًا على استبدال
   حي، والـ Admin لسه بيعرض الرابط — الشاشة والـ API بيتناقضوا. اتضاف جدول
   «السؤال ← المصدر» والمصدر البديل (`currentQuantity > 0 &&
   unfulfilledQuantity > 0`) بشرط إنه fallback مش merge وإنه مايعيدش التصنيف.
   متقاس على `#53531` · `#53701`، وضابط سليم `#53227`.

🟡 مُستحسن — **`known-gaps.md` G-2 بقت «مقفولة في اتجاه واحد»**
   من غير إحياء مقترح `custom.s2_type` — الميتافيلد كان هيبوظ بنفس التعديل.

🟡 مُستحسن — **ثغرة جديدة G-16** (P1) — تعديل الأوردر بعد الاستبدال الرسمي
   بيقطع الرابط صامت؛ الحل القرائي بيصلّح الملفات مش البيانات، فـ KPIs
   «دورات الاستبدال» بتفضل ناقصة.

⚪ تحريري — **وصفة فحص جديدة** `OLC-R8-exchange-empty-fallback` في
   `references/sweep-checks.yaml`.
```

---

## 3 · `shopify-graphql-helper` — المقترح: **v2.0.0 → v2.1.0**

### 3.1 · 🔴 كاسر — **اسم حقل غلط في Step 10** (مستقل عن الحالة دي)

الـ SKILL.md حاليًا فيها في Step 10:

```graphql
exchangeLineItems(first: 10) { nodes { lineItem { id title } } }
```

```javascript
.flatMap(r => (r.exchangeLineItems?.nodes || []).map(el => el.lineItem.id));
```

**`ExchangeLineItem` مالهاش حقل اسمه `lineItem`.** الـ introspection الحي
(`__type(name: "ExchangeLineItem")`) بيقول الحقول هي:

```
id · lineItems (LIST of LineItem!) · processableQuantity ·
processedQuantity · quantity · unprocessedQuantity · variantId
```

يعني **`lineItems` جمع، وقايمة مش object**. أي حد نسخ السنيبت ده هياخد
`undefinedField` على الـ query، أو `TypeError: Cannot read properties of
undefined` على الـ JS. (الكود المنشور في `Bosta-Return-Exchange-Exporter`
بيستخدم `lineItems` الصح — يعني المهارة اتأخرت عن الكود، مش العكس.)

**التصحيح المطلوب:**

```graphql
exchangeLineItems(first: 10) {
  nodes { quantity lineItems { id title sku } }
}
```

```javascript
const exchangeIds = new Set(
  (order.returns?.nodes || [])
    .filter(r => !['CANCELED', 'DECLINED'].includes(r.status))
    .flatMap(r => (r.exchangeLineItems?.nodes || [])
      .flatMap(el => (el.lineItems || []).map(li => li.id)))
);
```

### 3.2 · 🔴 كاسر — صف خامس في جدول «Four behaviours that break naive matching»

(العنوان يبقى **Five behaviours**.)

| Behaviour | Consequence |
|---|---|
| An **order edit** that removes the exchange line and adds a replacement by hand **empties `exchangeLineItems` permanently** — while the Admin still shows *"Exchange item for return #X"* on the removed line | An exchange reads as a return. Anything built from the connection (shipment description, item count, goods value) comes out empty or falls back to the returned piece. Verified 09-09-2026 — `#53531`, `#53701` |

### 3.3 · 🟡 مُستحسن — قسم فرعي جديد تحت Step 10

> ### 🔴 «ما الذي يخرج فعلاً؟» — `exchangeLineItems` مش إجابة كافية
>
> الـ connection دي بتوصف **الاستبدال زي ما اتسجّل**، مش **الشحنة زي ما هي
> دلوقتي**. أي تعديل أوردر بعد كده بيفكّهم عن بعض من غير أي إشارة.
>
> المصدر الفيزيائي للي مستني يتشحن — تلات صيغ مكافئة، متقاسة على نفس
> الأوردرات:
>
> | المصدر | الاستعلام | ملاحظة |
> |---|---|---|
> | ✅ **الأرخص والموصى به** | `order.lineItems { currentQuantity unfulfilledQuantity }` ثم `currentQuantity > 0 && unfulfilledQuantity > 0` | connection واحدة، ~25 نقطة |
> | مكافئ وأغلى | `order.fulfillmentOrders(status: OPEN) { lineItems { remainingQuantity } }` | connection متداخلة، أغلى بكتير |
> | ❌ **غلط** | `lineItem.quantity` | بيفضل ثابت على السطر المشال — بيرجّع القطعة المتلغية |
>
> **الشرطان مطلوبين مع بعض.** السطر اللي التعديل شاله بيحتفظ بـ `quantity`
> الأصلي؛ اللي بيروح صفر هو `currentQuantity` و`unfulfilledQuantity` بس.
> والسطر اللي اتسلّم للعميل بيبقى `currentQuantity > 0` و
> `unfulfilledQuantity = 0` — فشرط واحد بس بيلم قطع مش خارجة (متقاس على
> `#53227`: `AKS35 / Grey / 44` و`AKS35 / Navy / 44`).
>
> ⚠️ **fallback مش merge.** على استبدال سليم المصدرين بيرجّعوا **نفس** القطعة،
> فالدمج بيعدّها مرتين.
>
> ⚠️ **مايتستخدمش للتصنيف.** «ده استبدال ولا استرجاع؟» تفضل من الدورة
> (`ecommoda-order-lifecycle` Rule 8). سطر غير مشحون على أوردر مشحون جزئيًا
> هو false positive بالتعريف.

### 3.4 · ⚪ تحريري — «Quick Pitfall Checklist»

يتضاف بند:

```
□ بتقرا exchangeLineItems؟ الفاضي = "مش مسجّل"، مش "استرجاع".
  لو بتبني منها شحنة → لازم fallback على السطور غير المشحونة.
□ بتكتب el.lineItem؟ الحقل اسمه lineItems (جمع، LIST).
```

### 3.5 · بند CHANGELOG المقترح

```markdown
## v2.1.0 — 09-09-2026

> **بندين 🔴 + بند 🟡 + بند ⚪.** المصدر: `skillsupdates20260909.md`.
>
> **ليه MINOR رغم بندين كاسرين:** الأول تصحيح اسم حقل غلط في سنيبت (مافيش
> أداة منشورة نسخته — الكود الحي بيستخدم الصح أصلاً)، والتاني إضافة سلوك
> خامس لجدول موجود. مفيش أداة محتاجة retrofit من المهارة نفسها.

🔴 كاسر — **Step 10: `ExchangeLineItem.lineItem` مش موجود — الحقل `lineItems`
   (جمع، LIST)**. السنيبت والـ JS المثال كانوا هيرموا `undefinedField` /
   `TypeError`. متأكد من introspection حي.

🔴 كاسر — **صف خامس في جدول السلوكيات: تعديل الأوردر بيفضّي
   `exchangeLineItems` نهائيًا** والـ Admin لسه بيعرض الرابط.

🟡 مُستحسن — **قسم فرعي جديد «ما الذي يخرج فعلاً؟»** — جدول المصادر التلاتة،
   قاعدة الشرطين، وقاعدة fallback-not-merge.

⚪ تحريري — بندين في Quick Pitfall Checklist.
```

---

## 4 · `ecommoda-debugger` — إضافة بدون إصدار

> `ecommoda-debugger` **مالهاش `references/CHANGELOG.md` ولا رقم إصدار**، فحسب
> `ecommoda-skill-versioning` هي بره جدول البصمة. الإضافة دي تحريرية على
> SKILL.md مباشرة، ومن غير bump.

يتضاف لعيلة **false-success** (الأداة بتقول نجحت وهي منتجة حاجة غلط):

> **«الملف اتصدّر والأعمدة فاضية».** عمود بيتملى من connection مشروطة
> (`exchangeLineItems`، `fulfillmentLineItem`…) وطلع فاضي **مش** معناه إن
> الحقل مش متسحوب. اتأكد بالترتيب ده:
> 1. الـ query طالبة الحقل أصلاً؟ (الفخ الكلاسيكي — ٣ أعمدة في
>    `Bosta-Return-Exchange-Exporter` كانت مقروءة في الكود ومش متسحوبة من
>    الـ query لحد v5.2.0.)
> 2. الحقل متسحوب وراجع فاضي **من شوبيفاي نفسها**؟ افتح الأوردر في الـ Admin
>    وقارن. **لو الشاشة بتعرض العلاقة والـ API لأ — الشاشة مش مرجع، بس هي
>    الدليل إن العلاقة موجودة وبتتقرا بطريقة تانية.** ده بالظبط اللي حصل مع
>    `exchangeLineItems` بعد تعديل أوردر (09-09-2026 — `#53531`).
> 3. القيمة موجودة في مكان تاني في نفس الأوردر؟ (هنا: `order.lineItems` بـ
>    `currentQuantity > 0 && unfulfilledQuantity > 0`.)
>
> ⚠️ **العمود الفاضي أخطر من الـ error**: الصف بيتصدّر، الموظف بيرفعه، والغلط
> بيوصل للكوريير. ولما يكون فيه `else` بيحسب قيمة بديلة (زي `Goods Value` اللي
> كان بيرجع للقطعة الراجعة)، العمود **مش** بيبان فاضي أصلاً — بيبان **مليان
> برقم غلط**. دور على الـ fallback branches قبل ما تصدّق عمود مليان.

---

## 5 · حاجات **ما اتغيّرتش** — مقصود

| # | البند | السبب |
|---|---|---|
| 1 | **Rule 15 ② (الدورة المفتوحة الأحدث)** | صحيحة ومابتتأثرش. `resolveOutgoingItems` بتشتغل **جوّه** الدورة المختارة، مش حواليها. |
| 2 | **الاتجاه الموجب لـ Rule 8** | «غير فاضية = استبدال» متأكد حيًا، ماحصلش عليه استثناء. |
| 3 | **`custom.s2_type`** (G-2 القديم) | ما يتحييش. ميتافيلد بيتكتب مرة كان هيبوظ بنفس تعديل الأوردر — الحل قراءة مش حقل. |
| 4 | **`ecommoda-worker-builder` / `ecommoda-html-builder`** | مافيش قاعدة فيهم اتكسرت. التغيير طبّق قواعدهم (Rule 13/14، fallback على cost error، «الواجهة ما تشوفش الخام») ما غيّرهاش. |
| 5 | **`ecommoda-constants`** | مفيش قيمة `tool`/`type`/`extra.result` جديدة. `EXCHANGE_ITEMS_RECOVERED` كود دورة داخلي بيتكتب جوّه `cycle_block.extra`، مش قيمة `type` جديدة. |

---

## 6 · أدوات تانية محتاجة فحص بعد ما البنود دي تتطبّق

> مالهاش علاقة بالأداة اللي اتصلحت — ده اللي المفروض `skills-sweep` يمسكه
> بوصفة `OLC-R8-exchange-empty-fallback`. اتساب هنا كنقطة بداية، **مش**
> كنتيجة جرد (الجرد ما اتعملش في الجلسة دي).

- أي أداة أو داشبورد بتعدّ «دورات استبدال» أو «نسبة الاستبدال» من
  `exchangeLineItems` → بتقلّل العدد بمقدار الحالات دي (٢ من ٢٥ في العينة).
- أي أداة بتحسب قيمة شحنة خارجة من الدورة.
- `Performance-Dashboard` وأي KPI بيفرّق استرجاع/استبدال.

---

## 7 · اللي اتعمل بالفعل في الكود (للمرجعية)

`Bosta-Return-Exchange-Exporter` — فرع `claude/zen-hypatia-mdo5yg`:

- **Worker v5.4.0 → v5.5.0** — بلوك `§SHOPIFY::outgoingItems` جديد
  (`itemsFromCycle` / `itemsFromUnfulfilledLines` / `resolveOutgoingItems`)،
  `outgoingItems` + `outgoingSource` في رد `fetch_candidates`،
  `EXCHANGE_ITEMS_RECOVERED` تحذير جديد، `EXCHANGE_WITHOUT_ITEMS` بقى
  **حاجب** (قرار أحمد)، وحارس `confirm_upload` بقى يقرا المصدرين
  (batch 50 → 20 + halve-and-retry).
- **الواجهة v5.5.0 → v5.6.0** — `Package Description` / `No. of Items` /
  `Goods Value` بقت تتبني من `order.outgoingItems`؛ الصفحة مابقتش تشوف
  `exchangeLineItems` ولا `lineItems` خام؛ `MIN_WORKER_VERSION` → `5.5.0`.
- **اتقاس بعد التعديل** على بيانات شوبيفاي الحقيقية — ٦ حالات، كلها ناجحة:
  `#53227` استبدال سليم (المصدر = الدورة، من غير عدّ مزدوج) ·
  `#53701` مسترجع (2400 مش 2600) · `#53531` مسترجع (43 @2300 مش المشالة @2200) ·
  `#53389` استرجاع صافي (ما اتمسّش) · استبدال من غير أي قطعة خارجة (**بيحجب**) ·
  استبدال سليم على وظيفة استرجاع (`TYPE_MISMATCH` شغّال، والـ fallback ما اشتغلش).

</div>
