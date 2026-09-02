<div dir="rtl" style="text-align: right;">

# Bosta Return / Exchange Exporter (`Bosta-Return-Exchange-Exporter`)

![version](https://img.shields.io/badge/version-v1.6.0-blue)

**بتعمل إيه:** فحص أوردرات الاسترجاع/الاستبدال الجاهزة لبوسطة، تصديرها Excel، وتأكيد الرفع على داشبورد بوسطة — بيحدّث S2 (`custom.status_2_r_e`) على شوبيفاي أوتوماتيك.
**مين بيستخدمها:** المخزن
**الإصدار:** Worker `v5.4.0` · الواجهة `v5.4.0`

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
| `fetch_candidates` | يجيب أوردرات الاسترجاع/الاستبدال المرشّحة من شوبيفاي (`status_2_r_e` + `courier = Bosta`) — بيرجّع `currentCycle` (الدورة المفتوحة **بس**) + `cycleInfo` لكل أوردر، ومابيرجّعش `returns[]` خالص (v5.2.0) |
| `check_export_duplicates` | يفحص لو **نفس دورة** الأوردر دي اتصدّرت قبل كده — المفتاح = اسم الأوردر + `cycleName` (v5.3.0) |
| `record_export` | يسجّل عملية تصدير Excel (بيتمنع لو فيه تكرار من غير `allowRepeat`) — بيخزّن `cycleName`/`cycleCreatedAt` في `extra` (v5.3.0) |
| `confirm_upload` | بيفحص دورات الاسترجاع من شوبيفاي الأول ويرفض بـ `409 CYCLE_BLOCKED` قبل أي كتابة (v5.2.0) — والرفض بيتسجّل في D1 كـ `cycle_block` مع `logged` في الرد (v5.4.0). بعدين يكتب S2 الجديد (`In-Return` للاسترجاع · `Ready` للاستبدال) + وقت التحديث، ويتحقق مباشرة من شوبيفاي |
| `record_manual_confirmation` | **غير مستخدم من الواجهة الحالية** (v4.0.0 دمجت خطوتين الاستبدال في `confirm_upload`) — الكود سايبه موجود لو احتاجوه تاني |
| `get_logs` / `get_logs_count` / `get_logs_export` | سجل العمليات — فلاتر multi-select (`employees`/`types` CSV) + `search`، موحّدة بين التلاتة عبر `buildLogFilterSQL`. `get_logs_export` بيرجّع `cap`/`total`/`truncated` كمان (v5.0.0) |
| `diag` | فحص ذاتي بدون كتابة (شوبيفاي · D1 · Origin) — مفيش قيم أسرار في الرد (v4.1.0) |
| `get_config` | رقم نسخة الـ Worker — تستخدمه الواجهة لحارس نسخة الـ Worker (v4.1.0) |

## D1

```
tool  : bosta_exchange_export
type  : scan · export_return · export_exchange · confirm_return · confirm_exchange ·
        manual_confirm_return · manual_confirm_exchange · login · cycle_block
```

> كل `confirm_upload` ناجح بيكتب **كمان** صف في `tool = 'metafields_change'` (`type = 'update'`)
> — ده مطلوب عشان الـ cycle-time / R-E-cycle KPIs (بتتقرا من `metafields_change` بس) تشوف التحديث ده.

> 🔴 **`cycle_block` (v5.4.0) لسه محتاج تسجيل في `ecommoda-constants` §7.** أحمد
> بيسجّله. باقي القيم متسجّلة بالفعل. القاعدة (`worker-builder` Rule 7) بتقول
> التسجيل **قبل** النشر مش بعده — ده استثناء واعي، متكتب هنا عشان اللي هيقرا
> بعد كده مايفتكرش إن التسجيل اتعمل.

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
  — البوابة الحقيقية هي مودال الواجهة، مش الـ Worker. (⚠️ ده **مابينطبقش**
  على حارس الدورات المضاف في v5.2.0 — ده بيتفحص سيرفر-سايد فعليًا من شوبيفاي
  وبيرفض قبل الكتابة.)
- **الأوردر ممكن يكون عدّى بأكتر من دورة استرجاع/استبدال، والـ S2 بيقول على
  الأخيرة بس.** أي حساب هنا (وصف الشحنة · العدد · `Goods Value`) لازم يتبني
  من `order.currentCycle` — الدورة المفتوحة الوحيدة — مش من `returns[]` كلها.
  ده كان **الباج الأساسي لحد v5.2.0**، وقيس حيًا على `#51656`: تلات دورات
  (R1 مقفولة · R2 مقفولة · R3 مفتوحة) طلّعت `Return #Items = 3` و
  `Goods Value = 6300` بدل قطعة واحدة و`1750` — يعني قطع رجعت المخزن خلاص
  اتشحنت تاني في ملف بوسطة. القاعدة → `ecommoda-order-lifecycle` Rule 15 ②.
  الحماية الهيكلية: الـ Worker مابيرجّعش `returns` للواجهة أصلاً، فالتجميع
  القديم بقى **مستحيل** من الفرونت إند.

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
| ecommoda-html-builder | v6.2.0 |
| ecommoda-order-lifecycle | v1.2.0 |
| ecommoda-constants | v1.4.3 |

آخر مطابقة: 02-09-2026 · `index.js` v5.4.0 · `index.html` v5.4.0
🔴 معلّقة: — `cycle_block` مستني التسجيل في `ecommoda-constants` §7

## مسائل مفتوحة

- ✅ **دورات الاسترجاع — اتصلحت 02-09-2026 (v5.2.0).** التفاصيل في «فخاخ
  الأداة دي» فوق. اللي اتعمل: الـ Worker بيرتّب `returns[]` بـ `createdAt`
  (مش بترتيب المصفوفة)، بيشيل `CANCELED`/`DECLINED` **قبل** الترتيب (الـ
  `closedAt` بتاعهم `null` وبيفبرك تداخل وهمي)، وبيرجّع `currentCycle` واحدة
  + `cycleInfo`. اتضاف حارس الدورة الواحدة: `CYCLE_OVERLAP_OPEN` ·
  `NO_OPEN_CYCLE` · `CYCLES_TRUNCATED` · `ORDER_NOT_READABLE` بيمنعوا التصدير
  وتحديث الحالة (واجهة + سيرفر-سايد في `confirm_upload`)، و`MULTI_CYCLE` ·
  `CYCLE_OVERLAP` · `TYPE_MISMATCH` · `EXCHANGE_WITHOUT_ITEMS` تحذير بس
  (flag it, never move it). عمود جديد «الدورة المفتوحة» + نافذة مراجعة في
  الواجهة.
- ✅ **«Delivery Notes» — اتقرر 02-09-2026 (v5.3.0): يتملى من `order.note`.**
  كان بيقرا الحقل من غير ما الـ query تطلبه، فكان **دايمًا فاضي** من أول يوم.
  ⚠️ الـ `note` ملاحظات **داخلية** لخدمة العملاء (على `#51656`: «أوردر استبدال
  / لا يوجد مصاريف شحن / أوردر استرجاع») — الكلام ده بقى بيوصل للمندوب فعليًا.
  `flattenNote()` بتحوّله لسطر واحد قبل الكتابة في الملف.
- ✅ **رفض `confirm_upload` بسبب الدورات — اتسجّل 02-09-2026 (v5.4.0).**
  قاعدة «reject + log» بقت مكتملة: صف D1 لكل أوردر متمنوع بـ
  `type = 'cycle_block'` شايل الكود والقيمة والإجراء والحالة اللي **ما
  اتكتبتش**، وفلتر جديد في تاب السجل. فشل الكتابة في D1 بيرجع `logged: false`
  والواجهة بتقوله صراحة (`worker-builder` Step 5A ⑦) — الرفض بيفضل قايم.
  🔴 **باقي:** تسجيل `cycle_block` في `ecommoda-constants` §7 (أحمد بيعمله).
- ✅ **مفتاح فحص التكرار — اتصلح 02-09-2026 (v5.3.0): اسم الأوردر + اسم
  الدورة.** كان بالاسم بس، فأوردر بدورة تانية **شرعية** (`MULTI_CYCLE`) كان
  بيتقفل كـ«مكرر» ويحتاج `allowRepeat` — والحماية كانت بتفقد معناها أوردر ورا
  التاني. `record_export` بقى بيخزّن `cycleName`/`cycleCreatedAt` في `extra`.
  **الصفوف القديمة** (قبل v5.3.0، مالهاش اسم دورة) لا بتتلغي ولا بتتحسب على
  عماها: بتتطابق مع الدورة الحالية **بس** لو `timestamp >= cycle.createdAt` —
  تصدير حصل قبل ما الدورة توجد مستحيل يكون تصدير ليها. مفيش migration.
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
- ✅ **تبسيط تبويب التصدير — اتعمل 02-09-2026 (v5.1.0)، بطلب مباشر من أحمد.**
  حذف صندوق الإحصائيات الخمسة (مطابق للشروط / محدد للتصدير / تم التصدير /
  تم تحديث الحالة؟ / الحالة التالية) وزراري "تنظيف" و"تحديث حالة الأوردر
  إلى ...". بقى فيه زرار تصدير واحد بس — كل الأوردرات محددة افتراضيًا
  (`fetchCandidates` بيملي `state.selectedOrderIds` بكل الـ IDs)، والزرار
  بيبدأ "📥 تصدير الكل" ويتحول لـ "📥 تصدير المحدد فقط (العدد)" لو الموظف
  شال تحديد أي أوردر (`updateExportBtnLabel`). بعد نجاح `performExcelExport`
  بيتفتحوا تلقائيًا: تاب جديد على `business.bosta.co/orders/upload/smart-upload`
  + نافذة تأكيد تحديث الحالة (`openStatusConfirmModal`) — من غير زرار وسيط.
  `clearResults()` لسه موجودة داخليًا (بتتنده عند تبديل نوع العملية/الدخول/
  الخروج) رغم حذف زرار "تنظيف" اللي كان بينده عليها.

آخر تحديث: 02-09-2026 — 18:05

</div>
