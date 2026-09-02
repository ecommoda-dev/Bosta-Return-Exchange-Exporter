<div dir="rtl" style="text-align: right;">

# Bosta Return / Exchange Exporter (`Bosta-Return-Exchange-Exporter`)

![version](https://img.shields.io/badge/version-v1.2.0-blue)

**بتعمل إيه:** فحص أوردرات الاسترجاع/الاستبدال الجاهزة لبوسطة، تصديرها Excel، وتأكيد الرفع على داشبورد بوسطة — بيحدّث S2 (`custom.status_2_r_e`) على شوبيفاي أوتوماتيك.
**مين بيستخدمها:** المخزن
**الإصدار:** Worker `v5.0.0` · الواجهة `v5.0.0`

## الروابط

```
الواجهة    : https://ecommoda-dev.github.io/Bosta-Return-Exchange-Exporter/
الـ Worker : https://bosta-return-exchange-exporter-worker.ecommoda-dev.workers.dev
اسم الـ Worker في الداشبورد: bosta-return-exchange-exporter-worker     ← لازم يطابق name في wrangler.toml
```

## الـ Endpoints

| `?action=` | بيعمل إيه |
|---|---|
| `check_employee` / `register_pin` / `verify_employee` / `log_logout` / `get_employees` | تسجيل الدخول |
| `fetch_candidates` | يجيب أوردرات الاسترجاع/الاستبدال المرشّحة من شوبيفاي (`status_2_r_e` + `courier = Bosta`) |
| `check_export_duplicates` | يفحص لو الأوردرات دي اتصدّرت قبل كده |
| `record_export` | يسجّل عملية تصدير Excel (بيتمنع لو فيه تكرار من غير `allowRepeat`) |
| `confirm_upload` | يكتب S2 الجديد (`In-Return` للاسترجاع · `Ready` للاستبدال) + وقت التحديث، ويتحقق مباشرة من شوبيفاي |
| `record_manual_confirmation` | **غير مستخدم من الواجهة الحالية** (v4.0.0 دمجت خطوتين الاستبدال في `confirm_upload`) — الكود سايبه موجود لو احتاجوه تاني |
| `get_logs` / `get_logs_count` / `get_logs_export` | سجل العمليات — فلاتر multi-select (`employees`/`types` CSV) + `search`، موحّدة بين التلاتة عبر `buildLogFilterSQL`. `get_logs_export` بيرجّع `cap`/`total`/`truncated` كمان (v5.0.0) |
| `diag` | فحص ذاتي بدون كتابة (شوبيفاي · D1 · Origin) — مفيش قيم أسرار في الرد (v4.1.0) |
| `get_config` | رقم نسخة الـ Worker — تستخدمه الواجهة لحارس نسخة الـ Worker (v4.1.0) |

## D1

```
tool  : bosta_exchange_export
type  : scan · export_return · export_exchange · confirm_return · confirm_exchange ·
        manual_confirm_return · manual_confirm_exchange · login
```

> كل `confirm_upload` ناجح بيكتب **كمان** صف في `tool = 'metafields_change'` (`type = 'update'`)
> — ده مطلوب عشان الـ cycle-time / R-E-cycle KPIs (بتتقرا من `metafields_change` بس) تشوف التحديث ده.

> القيم دي متسجّلة بالفعل في جدول D1 في `ecommoda-constants` §7 — مفيش تسجيل مطلوب.

## المضبوط فعليًا في الداشبورد

> اللي **متظبط بالفعل** — مش اللي المفروض يكون.

```
Bindings : DB → ecommoda-dev-logs
Secrets  : WORKER_SECRET · CLIENT_ID · CLIENT_SECRET
Vars     : SHOP_DOMAIN   ← من [vars] في wrangler.toml
Build watch paths : * (الافتراضي — لسه ما اتضيّقتش)
```

## CORS

`ALLOWED_ORIGINS` صارمة — لأن الأداة **كتابة**: بتعمل `metafieldsSet` على أوردرات حية (S2).

## خط الأساس بعد النقل

> مفيش خط أساس مباشر من أحمد وقت النقل. البديل — آخر صف `scan` ناجح في D1
> **قبل** النقل (23-08-2026، 08:25 UTC): فحص استرجاع رجّع **أوردر واحد مطابق**.
> استخدم نفس نوع الفحص (استرجاع) بعد النقل للمقارنة. بند مفتوح بوعي — راجع «مسائل مفتوحة».

## فخاخ الأداة دي

- **`In-Return` بتتكتب يدوي مش من مزامنة بوسطة تلقائية.** استثناء مقصود
  اتأكد مع أحمد 06-08-2026 (موثّق في رأس `index.js`) — الأصل حسب
  `ecommoda-order-lifecycle` إن `In-Return` "بوسطة بس". هنا لسه مفيش
  auto-sync حي من بوسطة لشوبيفاي، فالتأكيد اليدوي هو المُحفّز الوحيد.
  يتراجع لو/لما الـ sync ده يتعمل.
- **`checklist` في `confirm_upload` audit-only.** مش بتمنع الكتابة سيرفر-سايد
  — البوابة الحقيقية هي مودال الواجهة، مش الـ Worker.

## استرجاع النسخ القديمة

> ده بديل الـ tags — دفع الـ tags ممنوع من جلسات Claude Code السحابية.

```
آخر نسخة مرقّمة كانت 3.33.html، اتمسحت في commit 9695f10 (بعد ما اتسمّت Index.html).
git show 91c6027~1:3.33.html
```

## بصمة المهارات

> الصيغة والقواعد والمهارات اللي بتدخل الجدول → `ecommoda-skill-versioning`
> Step 4. مهارة مالهاش رقم إصدار مابتدخلش الجدول.

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-worker-builder | v2.0.0 |
| ecommoda-html-builder | v6.0.0 |
| ecommoda-order-lifecycle | v1.2.0 |
| ecommoda-constants | v1.4.3 |

آخر مطابقة: 02-09-2026 · `index.js` v5.0.0 · `index.html` v5.0.0
🔴 معلّقة: — لا شيء

## مسائل مفتوحة

- ✅ **`ALLOWED_ORIGINS` — راجعتها 02-09-2026: مفيش `ecommoda24.github.io` في الكود
  الحالي.** `ecommoda-constants` §5 و§11 بند 10 لسه بيحسبوا الأداة دي من الـ ٥
  اللي محتاجة تنظيف — القيمة الوحيدة الموجودة فعليًا هنا (`index.js`) هي
  `https://ecommoda-dev.github.io`. يظهر إن ده اتصلح قبل كده من غير ما يتسجّل،
  أو إن جرد `ecommoda-constants` عنده بيانات قديمة عن الأداة دي — يستاهل
  تصحيح هناك.
- **خط الأساس بعد النقل معتمد على استنتاج من D1 مش رقم مؤكد من أحمد**
  — راجع "خط الأساس بعد النقل" فوق.
- **`record_manual_confirmation` endpoint حي بس غير مستخدم** من أي مكان
  في الواجهة الحالية (v4.0.0+). سايبه الكود كما هو — قرار موثّق في هيدر
  `index.js` نفسه، مش حاجة اتكشفت في النقل.
- ✅ **تحويل الواجهة الكامل لـ `ecommoda-html-builder` v6.0.0 — اتعمل 02-09-2026
  (v5.0.0).** التابات الرئيسية (`.main-tabs-bar`/`.main-tab-btn`)، قسم
  فلاتر/جدول موحّد (`unified-section`) لكل من "الأوردرات الجاهزة للملف"
  وسجل العمليات، كل الفلاتر multi-select (`msState.orderStatus` /
  `msState.logType`)، `--container-max` Tier M (1200px)، About/Changelog على
  شِل `.eco-modal`، زرار الإغلاق بإطار أحمر حقيقي (كان نص أحمر بس رغم اسم
  الكلاس الصح)، سجل العمليات جدول حقيقي بعمودي تاريخ/وقت منفصلين وترتيب على
  الأعمدة، وصيغة `📅 …/…/… 🕐 …:…`. الـ Worker اتحدّث بالتوازي (v5.0.0) —
  `get_logs*` بقت تاخد `employees`/`types` CSV بدل قيمة واحدة.
  🟡 **لسه ما اتعملش (مُستحسن، معروف ومتعمّد):** Freeze on Scroll
  (`tabs-and-modals.md` § 1b — هيدر مضغوط + chip تاب عند السكرول). مش كاسر
  لأن الأداة من غيره بتشتغل عادي، بس التابات هتفضل واخدة مساحة تابتة أثناء
  السكرول. موثّق في مودال About (تشريح الكود) كمان.
  ⚠️ **"النتائج" في تاب سجل العمليات = عدد كلي من السيرفر مش `filtered.length`**
  — استثناء متعمّد عن `data-table-standard.md` § 7 بسبب الـ pagination
  الحقيقي (Log Filter Model v2)؛ موثّق في مودال About.

آخر تحديث: 02-09-2026 — 12:54

</div>
