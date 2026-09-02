<div dir="rtl" style="text-align: right;">

# Bosta Return / Exchange Exporter (`Bosta-Return-Exchange-Exporter`)

![version](https://img.shields.io/badge/version-v1.0.0-blue)

**بتعمل إيه:** فحص أوردرات الاسترجاع/الاستبدال الجاهزة لبوسطة، تصديرها Excel، وتأكيد الرفع على داشبورد بوسطة — بيحدّث S2 (`custom.status_2_r_e`) على شوبيفاي أوتوماتيك.
**مين بيستخدمها:** المخزن
**الإصدار:** Worker `v4.0.0` · الواجهة `v4.0.0`

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
| `get_logs` / `get_logs_count` / `get_logs_export` | سجل العمليات |

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
| ecommoda-worker-builder | v1.0.0 |
| ecommoda-html-builder | v1.0.0 |
| ecommoda-order-lifecycle | v1.1.0 |
| ecommoda-constants | v1.2.0 |

آخر مطابقة: 26-08-2026 · `index.js` v4.0.0 · `index.html` v4.0.0
🔴 معلّقة: — لا شيء

## مسائل مفتوحة

- **`ALLOWED_ORIGINS` فيها لسه `https://ecommoda24.github.io` المهجور**
  (موثّق كبند تنظيف عام في `ecommoda-constants` §5 و§11 بند 10، الأداة دي
  واحدة من ٥ أدوات فيها نفس البقايا). اتنقلت الأداة **كما هي** (بايت ببايت)
  حسب قاعدة النقل — التنظيف ده تعديل كود منفصل، مش جزء من النقل.
- **خط الأساس بعد النقل معتمد على استنتاج من D1 مش رقم مؤكد من أحمد**
  — راجع "خط الأساس بعد النقل" فوق.
- **`record_manual_confirmation` endpoint حي بس غير مستخدم** من أي مكان
  في الواجهة الحالية (v4.0.0). سايبه الكود كما هو — قرار موثّق في هيدر
  `index.js` نفسه، مش حاجة اتكشفت في النقل.

آخر تحديث: 26-08-2026 — 20:31

</div>
