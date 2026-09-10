<div dir="rtl" style="text-align: right;">

# المرحلة ٢ — فحوصات حية مطلوبة قبل كتابة أي كود

![status](https://img.shields.io/badge/الحالة-محتاج_فحص_حي-orange)

**الغرض:** رفع أوردرات الاسترجاع/الاستبدال على بوسطة **بالـ API** بدل تصدير
ملف إكسيل ورفعه يدوي على الداشبورد — يعني نقل نفس اللي عملته
`Bosta-Orders-Upload` في S1، بس على S2.

**الملف ده مش خطة تنفيذ.** ده **قايمة كل حاجة مش متأكدين منها**، ومعاها إزاي
تتفحص بالظبط، وإيه اللي بيتغيّر في الكود حسب كل نتيجة. اللي بيملاه بيشتغل في
جلسة منفصلة على حساب EcomModa الحي، وبيرجّع **جدول §٧** متملي.

> 📌 **الترتيب مقصود.** **ب-٠** لوحده بيقفل تمن بنود من غير ما تعمل ولا شحنة
> جديدة. متبدأش بأي حاجة تانية قبله.

**آخر تحديث:** 10-09-2026 · اتكتب بناءً على قراءة كاملة لـ
`Bosta-Orders-Upload` (`index.js` v1.3.0 · `SPEC.md`) و
`Bosta-Return-Exchange-Exporter` (`index.js` v5.5.0 · `index.html` v5.6.0)
والمهارات (`bosta-api-helper` v1.1.0 · `ecommoda-constants` v2.0.0 ·
`ecommoda-order-lifecycle` v1.5.0 · `ecommoda-worker-builder` v3.0.0)
واستعلامات حية على شوبيفاي و D1.

---

## ٠. اقرا ده الأول

### ٠.١ — أمان

```
🔴 حساب بوسطة بتاع EcomModa حساب إنتاج واحد. أي POST /deliveries بينشئ
   شحنة حقيقية بفلوس حقيقية وبيتحسب في فاتورة الشهر.
```

- **الأفضل:** اطلب من بوسطة **مفتاح Staging** (`https://stg-app.bosta.co/api/v2`).
  `ecommoda-constants` §3 بتقول الـ Staging **دايمًا مفتاح مختلف** عن الإنتاج،
  ومفيش عندنا واحد دلوقتي. لو المفتاح جه، اعمل كل فحوصات §٣ عليه وخلاص.
- **لو مفيش Staging:** كل شحنة تجريبية **تتلغي فورًا** بعد قراءتها:
  ```
  DELETE /api/v2/deliveries/business/{trackingNumber}/terminate   → 200
  ```
  🔴 بالـ **`trackingNumber`** مش بالـ `_id` — الـ `_id` بيدّي 404
  (`bosta-api-helper` 8.7).
- 🔴 **ولا شحنة تجريبية على رقم أوردر حقيقي.** استخدم
  `businessReference: "#PROBE-…"`. لو استخدمت `#53517` هتبقى شحنة وهمية
  بيلاقيها كل سكانر في الستاك بعد كده.
- سجّل **كل** رقم تتبع اتعمل في §٧-ج عشان نتأكد إن مفيش واحد فضل شغّال.

### ٠.٢ — تجهيز البيئة

```bash
export BOSTA="https://app.bosta.co/api/v2"      # أو stg-app لو فيه مفتاح staging
export KEY="<BOSTA_API_KEY>"                    # ⚠️ متكتبش المفتاح في أي ملف أو رد
# 🔴 المفتاح خام، من غير كلمة Bearer — الـ Bearer بيدّي 401 من غير رسالة واضحة
alias bosta='curl -sS -H "Authorization: $KEY" -H "Content-Type: application/json"'
```

**قيم ثابتة من `ecommoda-constants` §3.1 — متخترعش ولا تنسخ من شات قديم:**

```
businessLocationId : GeZMkbD7o              (كلية البنات - مصر الجديدة)
countryId          : 60e4482c7cb7d4bc4849c4d5
cityId (Cairo)     : FceDyHXwpSYYF9zGW
```

**قيم `type` (من SDK بوسطة الرسمي — `ecommoda-constants` §3.2):**

```
10 = Package Delivery (Send)   ← اللي الستاك بيستخدمه دلوقتي، وبس
15 = Cash Collection
20 = RTO
25 = Customer Return Pickup    ← الاسترجاع
30 = Exchange                  ← الاستبدال
```

### ٠.٣ — ليه الملف ده موجود أصلًا

`bosta-api-helper` Step 8 (عقد إنشاء شحنة) **مكتوبة كلها على `type: 10`**.
القيمة الوحيدة المسجّلة في المهارة كلها عن الاسترجاع/الاستبدال سطر واحد في 8.9:

```yaml
returnNotes:  string    # Exchange/CRP بس
```

مفيش أي وصف للطرد **الراجع**، ولا لاتجاه العنوان، ولا لسلوك بوسطة لما القطعة
الخارجة تكون ناقصة. و`docs.bosta.co` **محجوب من بروكسي جلسات Claude Code**
(اتجرب `curl` و`WebFetch` — الاتنين رجّعوا حجب على مستوى الدومين)،
والـ SDKs الرسمية (Node · Python · Ruby · PHP) مابتوثّقش الحقول دي.

---

## ١. فهرس البنود

| # | البند | أولوية | بيمنع الكود؟ |
|---|---|---|---|
| **ب-٠** | **تشريح شحنات الاستبدال/الاسترجاع الموجودة فعلًا** | 🔴 الأول | ✅ **أيوه — وهو أهم بند في الملف** |
| ب-١ | عقد `type: 25` (CRP) — الحقول المقبولة | 🔴 | ✅ |
| ب-٢ | عقد `type: 30` (Exchange) — وصف الطرد الراجع | 🔴 | ✅ |
| ب-٣ | `cod` سالب — موثّق للـ CRP، مش متأكد للـ Exchange | 🔴 | ✅ |
| ب-٤ | **`uniqueBusinessReference` مكرر — هل بوسطة بتقبل؟** | 🔴 | ✅ |
| ب-٥ | `businessReference` مكرر → البحث بيرجّع كام شحنة | 🔴 | ⚠️ بيغيّر أدوات تانية |
| ب-٦ | العقدين (`apiVersion=1` والغير موثّق) مع 25/30 | 🟡 | ✅ |
| ب-٧ | `flexShippingInfo` على CRP — ليها معنى؟ فلوس؟ | 🟡 | ❌ |
| ب-٨ | `allowToOpenPackage` على CRP — بتتحسب EGP 7؟ | 🟡 | ❌ |
| ب-٩ | `terminate` على CRP/Exchange | 🟡 | ❌ |
| ب-١٠ | حدود الاستهلاك (`UPLOAD_CONC`) | 🟡 | ❌ |
| ب-١١ | مواقع الاستلام الأربعة | 🟢 | ❌ |
| ب-١٢ | `mass-awb` — طباعة البوليصة | 🟢 | ❌ |
| ش-١ | تعريف `custom.bosta_tracking_number_s2` | 🔴 | ✅ |
| ش-٢ | تصادم تاج `Bosta_Uploaded_S2` | 🟡 | ❌ |
| ش-٣ | امتلاء `firstName`/`lastName`/`provinceCode` في عناوين المرتجعات | 🔴 | ✅ |
| ش-٤ | الويبهوك القديم على `ecommoda24` — حي ولا ميت | 🟡 | ❌ |
| ش-٥ | محرك مطابقة العنوان على عناوين مرتجعات حقيقية | 🔴 | ✅ |
| ت-١ | الفلتر: `courier = Bosta` ولا `zone = Other_Regions`؟ | 🔴 | ✅ |
| ت-٢ | سقف الـ `-2000` — مصدره إيه | 🟡 | ❌ |
| ت-٣ | `return_shipping_fees` مقابل الـ `cod` | 🟡 | ❌ |
| ت-٤ | الفواتير PDF وطباعة البوليصة — مين بيعملهم | 🟢 | ❌ |
| م-١ | تسجيل قيم `tool`/`type` في `ecommoda-constants` §7 | 🔴 | ⚠️ بيمنع أول `writeLog` |
| م-٢ | `skills-sweep` على الريبوين | 🟡 | ❌ |

---

## ٢. ب-٠ — المسار الذهبي: تشريح شحنات موجودة فعلًا

> 🎯 **البند ده بيقفل ب-١ · ب-٢ · ب-٣ · ب-٥ · ب-٧ · ب-٨ · ب-١٢ · ت-٣ دفعة
> واحدة، من غير ما تعمل ولا شحنة جديدة، ومن غير ولا جنيه.**

### الفكرة

الملف اللي الأداة بتصدّره دلوقتي بيترفع على
`business.bosta.co/orders/upload/smart-upload`، **وبوسطة نفسها بتحوّله لشحنات
`EXCHANGE` و`CUSTOMER_RETURN_PICKUP`**. يعني على الحساب دلوقتي فيه عشرات
الشحنات **اللي بوسطة بنتها بنفسها من نفس البيانات اللي إحنا هنبعتها بالـ API**.

فبدل ما نخمّن أسماء الحقول، **نقرا شحنة منهم ونشوف بوسطة خزّنت إيه**.

### الأوردرات (من سجل D1 الحي — آخر أسبوع)

| النوع | أرقام الأوردرات |
|---|---|
| **استبدال** | `#53849` · `#53197` · `#51261` (09-09) · `#53531` · `#52928` (08-09) |
| **استرجاع** | `#53240` (08-09) · `#53517` · `#53027` (07-09) · `#52704` (06-09) |

### الخطوة أ — هات الشحنات

```bash
for ORD in 53849 53197 51261 53531 52928 53240 53517 53027 52704; do
  echo "════════ #$ORD ════════"
  bosta -X POST "$BOSTA/deliveries/search" \
    -d "{\"businessReference\":\"#$ORD\",\"limit\":50,\"page\":1}" \
    | python3 -m json.tool
done > /tmp/probe0-search.json 2>&1
```

🔴 **الهاش إلزامي** — `"53849"` من غير `#` بيرجّع صفر نتيجة **بصمت**، مش error
(`bosta-api-helper` Step 2).

### الخطوة ب — هات الشكل الكامل لكل شحنة

الـ search بيرجّع شكل مختصر. الشكل الكامل من:

```bash
bosta "$BOSTA/deliveries/business/<trackingNumber>" | python3 -m json.tool
```

اعمل كده على **شحنة استبدال واحدة** و**شحنة استرجاع واحدة** على الأقل، واحفظ
الردين كاملين.

### الخطوة ج — الأسئلة اللي الردود دي بتجاوب عليها

انسخ الرد الكامل في §٧-أ، وجاوب على:

| السؤال | بيقفل |
|---|---|
| ١. الشحنة فيها كام حقل بيوصف طرد؟ `specs` بس، ولا فيه حقل تاني للراجع (`returnSpecs`؟ `returnPackageDetails`؟)؟ **ونصّ الاسم بالظبط** | **ب-٢** |
| ٢. في الاستبدال — `specs.packageDetails.description` فيه القطعة **الخارجة** ولا **الراجعة**؟ قارن بالأوردر على شوبيفاي | **ب-٢** |
| ٣. `cod` قيمته كام؟ سالبة ولا موجبة ولا صفر؟ قارن بـ `totalOutstandingSet` بتاع نفس الأوردر (👈 `#53517` مستحق عليه **-2700**، و`#51656` **-1650**) | **ب-٣** |
| ٤. `dropOffAddress` = عنوان **العميل** ولا عنوان **المخزن**؟ | **ب-١** |
| ٥. فيه `pickupAddress` أصلًا؟ وقيمته إيه؟ | **ب-١** |
| ٦. `businessLocationId` موجود؟ وقيمته `GeZMkbD7o`؟ | **ب-١** |
| ٧. `businessReference` شكله إيه بالظبط — `#53849` ولا `53849`؟ (ملف الإكسيل بيبعت `order.name` = **بالهاش**) | **ب-٥** |
| ٨. فيه `uniqueBusinessReference`؟ ولا الملف مابيبعتوش خالص؟ | **ب-٤** |
| ٩. `type.value` نصّه إيه بالظبط للاستبدال وللاسترجاع؟ | ب-١ · ب-٢ |
| ١٠. `allowToOpenPackage` قيمته إيه؟ و`flexShippingInfo`؟ | **ب-٧ · ب-٨** |
| ١١. `specs.size` و`specs.packageType` — بوسطة حطّت إيه لما الملف سابهم فاضيين؟ | ب-١ |
| ١٢. `notes` و`returnNotes` — أنهي واحد اتملى من عمود «Delivery Notes»؟ | ب-٢ |
| ١٣. `goodsInfo.amount` = «Goods Value Amount» بتاع الملف؟ | ب-١ |
| ١٤. `state` و`state.code` — لسه في نفس أكواد `STATE_MAP`؟ | ب-١٢ |

### الخطوة د — والأهم

> **لو `#53531` أو `#52928` ظهروا فيهم أكتر من شحنة** (لأنهم اتصدّروا أكتر من
> مرة — `#53531` اتصدّر ٣ مرات في يومين حسب D1)، ده بيجاوب **ب-٤ و ب-٥ مرة
> واحدة**: يعني بوسطة **قبلت** أكتر من شحنة على نفس الـ `businessReference`،
> وسجّل عددهم وترتيبهم في الرد.

---

## ٣. فحوصات بوسطة

### ب-١ · ب-٢ — عقد الإنشاء لـ CRP والاستبدال

**الحالة دلوقتي:** غير معروف. `bosta-api-helper` Step 8 على `type: 10` بس.

**اعمل ب-٠ الأول.** لو ب-٠ جاوب على كل حاجة → **البند ده اتقفل، متعملش شحنات
تجريبية**. لو فضل غموض، الفحص التجريبي:

**① CRP — `type: 25`**

```bash
bosta -X POST "$BOSTA/deliveries" -d '{
  "type": 25,
  "cod": -500,
  "goodsInfo": { "amount": 500 },
  "receiver": { "firstName": "Probe", "lastName": "CRP", "phone": "01000000000" },
  "dropOffAddress": { "city": "Cairo", "firstLine": "probe line one two three four five" },
  "specs": {
    "packageType": "Parcel",
    "size": "SMALL",
    "packageDetails": { "itemsCount": 1, "description": "probe returning piece" }
  },
  "businessLocationId": "GeZMkbD7o",
  "businessReference": "#PROBE-CRP-1",
  "uniqueBusinessReference": "PROBE-CRP-1",
  "allowToOpenPackage": true,
  "notes": "probe notes",
  "returnNotes": "probe return notes"
}' | python3 -m json.tool
```

**② Exchange — `type: 30` مع تخمين `returnSpecs`**

```bash
bosta -X POST "$BOSTA/deliveries" -d '{
  "type": 30,
  "cod": 100,
  "goodsInfo": { "amount": 2400 },
  "receiver": { "firstName": "Probe", "lastName": "EXC", "phone": "01000000000" },
  "dropOffAddress": { "city": "Cairo", "firstLine": "probe line one two three four five" },
  "specs": {
    "packageType": "Parcel",
    "size": "SMALL",
    "packageDetails": { "itemsCount": 1, "description": "OUTGOING new piece" }
  },
  "returnSpecs": {
    "packageType": "Parcel",
    "size": "SMALL",
    "packageDetails": { "itemsCount": 1, "description": "RETURNING old piece" }
  },
  "businessLocationId": "GeZMkbD7o",
  "businessReference": "#PROBE-EXC-1",
  "uniqueBusinessReference": "PROBE-EXC-1",
  "allowToOpenPackage": true,
  "returnNotes": "probe return notes"
}' | python3 -m json.tool
```

**③ ثم — الخطوة اللي بتكشف الفخ الحقيقي**

```bash
bosta "$BOSTA/deliveries/business/<tn>" | python3 -m json.tool
```

🔴 **الرد بـ 201 مش إثبات إن `returnSpecs` اتقبلت.** ده بالظبط فخ `cityName`
(`bosta-api-helper` 8.2): الڤاليديتور مش شايف الحقل، بيتجاهله **بصمت**،
والشحنة بترفع بنجاح ناقصة. **الإثبات الوحيد إن الحقل رجع في الـ GET.**

- ✅ `returnSpecs` رجعت في الـ GET → الاسم صح
- ❌ مارجعتش → الاسم غلط، والاسم الصح لازم ييجي من ب-٠
- 🔴 `type: 30` نجح **من غير أي وصف للراجع** → معناها بوسطة مش بتطلبه، وساعتها
  **إحنا** اللي لازم نمنع الحالة دي (زي `EXCHANGE_WITHOUT_ITEMS` الحاجب دلوقتي)

**④ ألغي فورًا**

```bash
bosta -X DELETE "$BOSTA/deliveries/business/<tn>/terminate" -i
```

**بيغيّر إيه في الكود:** ده اللي بيحدّد شكل `buildRePayload()` كله.

---

### ب-٣ — `cod` سالب

**الحالة دلوقتي:** `SPEC.md` بند **ب-١٠** بيقول من `api.yaml` الرسمي:
> ✅ `number`، والوصف الحرفي: *"The limit is 30,000 EGP"*، **وبيقدر يبقى سالب لـ CRP**

يعني **موثّق للـ CRP**، **مش مذكور للـ Exchange**، و**لسه ما اتجربش حي** ولا مرة.

**ليه مهم:** من ٤ أوردرات R/E بصّيت عليها حية، **٣ منهم `totalOutstanding` سالب**
(`#51656: -1650` · `#53517: -2700` · `#53701: -200`). لو السالب مرفوض، مسار
«الفلوس ترجع للعميل عند الباب» **كله** مش قابل للرفع بالـ API.

**الفحص:** جوّه ب-٠ (سؤال ٣) — شوف `cod` بتاع شحنة استرجاع حقيقية. ولو عملت
شحنة تجريبية، جرّب `cod: -500` على 25 و`cod: -500` على 30.

🔴 **فخ نقل مهم:** `Bosta-Orders-Upload` بتعمل
`Math.abs(totalOutstandingSet…)` (`index.js` §BOSTA::buildDeliveryPayload).
ده **صح لـ S1** (سالب هناك = العميل دفع زيادة)، و**كارثة لو اتنسخ للـ S2**
(هيحوّل «رجّعله 2700» لـ «حصّل منه 2700»). **الدالة دي متتنسخش كما هي.**

---

### ب-٤ — 🔴 `uniqueBusinessReference` مكرر — هل بوسطة بتقبل؟

**الحالة دلوقتي:** 🟠 **موضع خلاف — الاسم بيقول حاجة والتجربة بتقول حاجة تانية.**

| المصدر | بيقول إيه |
|---|---|
| `bosta-api-helper` 8.3 | «بدون هاش — **حماية بوسطة من التكرار** (`errorCode 11000`)» |
| `ecommoda-constants` §3.3 | «رقم الأوردر بدون هاش ← **حماية بوسطة من التكرار** (`errorCode 11000`)» |
| `Bosta-Orders-Upload/index.js` | `humanizeBostaError`: `'11000' → 'رقم الأوردر ده مرفوع عندها قبل كده'` |
| **أحمد (10-09-2026)** | **«الاسم يوحي إن بوسطة مش بتقبل، لكن هي بتقبل عادي — بنرفع أوردرات كتير بنفس الـ reference»** |

**ليه ده مهم جدًا:** لو **بوسطة بتقبل التكرار فعلًا**، فالحاجز اللي حطّيته في
تحليلي الأول (**«رفع CRP لأوردر مرفوع قبل كده هيترفض بـ 11000»**) **مش موجود
أصلًا**، والتصميم بيبقى أبسط بكتير — نبعت نفس القيم زي ما هي ومحتاجينش نخترع
`53701-R1`.

⚠️ **وممكن الاتنين صح:** التكرار اللي أحمد شافه ممكن يكون على
`businessReference` (اللي أكيد بيقبل التكرار)، مش على
`uniqueBusinessReference` (اللي الاسم بيقول عكسه). و**الحقلين اتنين مختلفين**.
والاحتمال التالت إن `11000` ييجي من حاجة تانية خالص. **الفحص لازم يفصل بينهم.**

**الفحص — ٣ نداءات بالترتيب:**

```bash
# ① شحنة أساس
bosta -X POST "$BOSTA/deliveries" -d '{
  "type": 10, "cod": 0, "goodsInfo": {"amount": 100},
  "receiver": {"firstName":"Probe","phone":"01000000000"},
  "dropOffAddress": {"city":"Cairo","firstLine":"probe line one two three four"},
  "specs": {"packageType":"Parcel","size":"SMALL","packageDetails":{"itemsCount":1,"description":"dup test"}},
  "businessLocationId": "GeZMkbD7o",
  "businessReference": "#PROBE-DUP", "uniqueBusinessReference": "PROBE-DUP",
  "allowToOpenPackage": true }'

# ② نفس الـ uniqueBusinessReference بالظبط  ← ده السؤال الحقيقي
#    (كرر النداء ① حرفيًا، من غير أي تغيير)

# ③ نفس businessReference بس uniqueBusinessReference مختلف
#    (غيّر "PROBE-DUP" لـ "PROBE-DUP-2" وسيب الـ businessReference زي ما هو)
```

**سجّل لكل نداء:** كود HTTP · `success` · `errorCode` (**نص مش رقم** — `String()`) · `trackingNumber`.

| النتيجة | معناها | الأثر على التصميم |
|---|---|---|
| ② نجح | ✅ **أحمد صح** — الحقل مش حاجز | نبعت `uniqueBusinessReference = orderNumber` زي S1 بالظبط. **بند ب-٥ يفضل قايم برضه** |
| ② رجّع `11000` | 🔴 الحقل حاجز فعلًا | لازم قيمة فريدة لكل دورة — الاقتراح `orderNumber + '-' + cycleName` (مثال `53701-R1`) من `currentCycle.name` اللي الـ Worker بيحسبها أصلًا. و`businessReference` **يفضل `#53701`** وإلا كل سكانرات الستاك تفقد الشحنة |
| ③ نجح في الحالتين | `businessReference` بيقبل التكرار | يأكد **ب-٥** |

🔴 **وبعد الفحص:** المهارتين (`bosta-api-helper` 8.3 · `ecommoda-constants` §3.3)
لازم يتعدّلوا بالنتيجة **مع bump** (`ecommoda-skill-versioning` — تغيير قيمة =
MAJOR، كود كان صح بقى غلط). دلوقتي الاتنين بيقولوا حاجة أحمد بيقول إنها مش دقيقة.

**متنساش:** ألغي التلات شحنات بالـ `terminate`.

---

### ب-٥ — `businessReference` مكرر → البحث بيرجّع كام شحنة

**ليه مهم:** ده **مش بند على الأداتين دول — ده بند على الستاك كله.**

من ساعة ما نرفع S2 بالـ API، الأوردر الواحد بيبقى عنده **شحنتين على الأقل** تحت
نفس الـ `businessReference` (`#53701`): شحنة `Send` من S1، وشحنة `CRP`/`EXCHANGE`
من S2. وأي أداة بتعمل:

```javascript
const d = extractDeliveries(raw)[0];   // ← بقت غلط
```

بقت بتقرا شحنة عشوائية من الاتنين.

> ⚠️ **وده بيحصل النهاردة كمان** — الملف الحالي بيبعت `Order Reference` =
> `order.name` = `#53701`، فبوسطة **بتنشئ الشحنة التانية دي فعلًا** من غير API.
> يعني المشكلة **قايمة أصلًا** والـ API مش بيخلقها — بس بيخلينا مسؤولين عنها.

**الفحص:**

1. من ب-٠: كام شحنة رجعت لكل أوردر؟ وترتيبها في الرد ثابت؟
2. جرد الستاك — أنهي أدوات بتبحث بـ `businessReference` وتاخد أول نتيجة:
   ```bash
   grep -rn "businessReference" --include="*.js" --include="*.html" .
   grep -rn "extractDeliveries" --include="*.js" . | grep -n "\[0\]"
   ```
   (لازم يتعمل على **الـ ٢٨ أداة**، مش على الريبوين دول — راجع `skills-sweep`)

**بيغيّر إيه:** كل أداة بتقرا شحنة من بوسطة بالأوردر لازم تفلتر على `type`
**client-side** (`type: 'SEND'` في الـ body **بيتجاهل بصمت** — `bosta-api-helper`
Step 2). وقيم الـ `type` من `/deliveries/search`:
`Send · EXCHANGE · CASH_COLLECTION · Return · RTO · CUSTOMER_RETURN_PICKUP`
— 🔴 **مش نفس قيم الويبهوك** (Step 8a).

---

### ب-٦ — العقدين مع `type` 25/30

`Bosta-Orders-Upload` بتختار العقد **لكل أوردر لوحده** (`bosta-api-helper` 8.5):

```
مطابقة منطقة واحدة → POST /deliveries?apiVersion=1   (موثّق، مع districtId/districtName)
مفيش مطابقة أو غموض → POST /deliveries               (غير موثّق، city بالاسم بس)
400 errorCode "3003" → رجوع تلقائي للتاني
```

**الفحص:** كرر ب-١/ب-٢ على المسارين، ومرة بـ `districtId` غلط عمدًا عشان تشوف
هل `3003` بييجي بنفس الشكل على `type` 25/30.

🔴 **`errorCode` نص مش رقم** — `String(body.errorCode) === '3003'`. المقارنة
بالرقم معناها الرجوع التلقائي **عمره ما هيشتغل** (فخ مسجّل في الأداة الأولى).

---

### ب-٧ · ب-٨ — `flexShippingInfo` و `allowToOpenPackage` على الاسترجاع

**الحالة دلوقتي:** الأداة بتكتب `flexship: 'Yes'` و`openPackage: 'Yes'`
**ثابتين للنوعين** في ملف الإكسيل. و`Bosta-Orders-Upload` بتبعت
`flexShippingInfo: { isOrderEligible: true, amountToBeCollected: 100 }` و
`allowToOpenPackage: true`.

**الشك:**
- `flexShippingInfo` معناها «المبلغ اللي العميل بيدفعه كمصاريف شحن **لو رفض
  الاستلام**». في **CRP مفيش استلام أصلًا** — العميل بيسلّم مش بيستلم. يعني
  الحقل ممكن يكون بلا معنى، أو أسوأ: بيتحسب.
- `allowToOpenPackage` = **EGP 7 لكل شحنة** (`ecommoda-constants` §3.4، قرار
  تشغيلي محسوم لـ S1). على CRP الطرد جاي من العميل — «السماح بالفتح» مالوش معنى
  واضح، بس ممكن الـ 7 جنيه تتحسب برضه.

**الفحص:** من ب-٠ — شوف بوسطة حطّت إيه في الحقلين على شحنة CRP اتعملت من الملف.
وبعدين **راجع فاتورة بوسطة لشهر أغسطس أو سبتمبر** وشوف هل شحنات الاسترجاع عليها
رسم فتح الطرد.

**بيغيّر إيه:** لو الرسم بيتحسب على CRP بلا فايدة → دي **وفر مباشر** والقيمة
تتقفل على `false` للاسترجاع. وده قرار أحمد مش قرار كود.

---

### ب-٩ — `terminate` على CRP/Exchange

**ليه مهم:** عناوين المرتجعات أوسخ من عناوين الشحن (شوف `#51656`: `address1`
كتلة نص حرة ٩٠ حرف والمحافظة جوّاها). زرار «إلغاء الشحنة» في المرحلة ٢ أهم منه
في المرحلة ١.

**الفحص:** كل `terminate` هتعمله في §٣ — سجّل كود الرد. جرّب كمان `terminate`
على شحنة **بعد** ما حالتها تتحرك (لو لقيت واحدة تجريبية اتسلّمت لمندوب).

**بيغيّر إيه:** لو شغّال على النوعين → زرار تراجع في الواجهة من اليوم الأول.

---

### ب-١٠ — حدود الاستهلاك

**الحالة دلوقتي:** `UPLOAD_CONC = 3` (متحفّظ). و`SPEC.md` بند **ب-٩**:
> ✅ **صفر ذكر لأي rate limit في `api.yaml` كله** (بحث نصي على 12,976 سطر)

**الفحص:** ده **مش بند عاجل للمرحلة ٢** — حجم الطابور من D1: **٢٢–٣٠ أوردر في
الشهر كله** (١–٢.٥ في اليوم). التوازي مالوش أثر على الحجم ده.

يتقاس مع أول تشغيل حي لـ **المرحلة ١** (٢٣٤ أوردر مؤهّل وقت الكتابة) وبعدين
يتسجّل في `ecommoda-constants`. لو ظهر `429` سجّل الـ headers كلها.

---

### ب-١١ — مواقع الاستلام

```bash
bosta "$BOSTA/pickup-locations" | python3 -m json.tool
```

`ecommoda-constants` §3.1: **٤ مواقع** على الحساب، والمستخدم فعليًا **واحد بس**
(`GeZMkbD7o` — كلية البنات، مصر الجديدة)، والتلاتة الباقيين **مش متسجّلين**.

**السؤال الحقيقي:** في الاسترجاع، الطرد بيرجع **لفين**؟ نفس الموقع ولا مخزن
المرتجعات مكان تاني؟ **سؤال لأحمد، مش للـ API.** لو مكان تاني → الـ `_id` بتاعه
يتسجّل في `ecommoda-constants` §3.1 **قبل** الاستخدام.

سجّل الأربعة (اسم + `_id`) في §٧-ب حتى لو الإجابة «نفس المكان».

---

### ب-١٢ — `mass-awb`

النهاردة الموظف بيطبع البوليصة من داشبورد بوسطة بعد رفع الملف. مع الـ API
الشحنة بتتعمل **من غير ما حد يفتح الداشبورد** — فالبوليصة لازم تيجي من
`mass-awb` (مذكور في `bosta-api-helper` Step 8a كمسار مستخدم بالفعل).

⚠️ **الطباعة أداة تانية** (`bosta-awb-api.md` — مشار ليها في `SPEC.md` §١١٠٣).
البند هنا بس عشان نعرف: **لو رفعنا بالـ API، الموظف هيطبع منين؟** لو الإجابة
«يفضل يطبع من الداشبورد» — تمام، مفيش شغل. لو لأ، ده نطاق زيادة لازم يتقال
**قبل** ما نبدأ مش بعدين.

---

## ٤. فحوصات شوبيفاي

### ش-١ — 🔴 تعريف `custom.bosta_tracking_number_s2`

**الحالة دلوقتي — مجرودة حية 10-09-2026:** تعريفات ميتافيلد الأوردر **٣٢
تعريف**، فيهم:

```
custom.bosta_tracking_number      number_integer      ← واحد بس، مفيش مقابل لـ S2
custom.bosta_order_type           single_line_text_field
custom.bosta_number_of_attempts   number_integer
custom.bosta_last_sync            date
custom.bosta_last_sync_time       date_time
custom.bosta_webhook              single_line_text_field
```

🔴 **يعني كتابة رقم تتبع الاسترجاع في `bosta_tracking_number` = مسح رقم تتبع
الشحنة الأصلية.** ومن غير مكان يتكتب فيه، الأداة هتعمل شحنة بفلوس حقيقية
ومالهاش أثر في شوبيفاي — وده بالظبط فخ **«🟠 تم جزئيًا»** المسجّل في
`Bosta-Orders-Upload/CLAUDE.md`.

**المطلوب (أحمد، في داشبورد شوبيفاي):**

```
Namespace & key : custom.bosta_tracking_number_s2
Name            : Bosta Tracking Number (S2)
Type            : Integer          ← number_integer، نفس نوع الأصلي بالظبط
Owner           : Order
```

🔴 **النوع لازم يطابق بالحرف.** `metafieldsSet` بيطلب تطابق النوع مع التعريف
الحي، واختلافه **بيسقّط النداء كله** — بما فيه أي ميتافيلد تاني في نفس النداء
(فخ مسجّل في `Bosta-Orders-Upload/CLAUDE.md`).

✅ **والاسم متسق مع الموجود فعلًا:** `printing_time_s2` · `s2_packed_by` ·
`s2_packing_date_time` — نفس عُرف الـ `_s2`.

**التأكيد بعد الإنشاء:**

```graphql
query { metafieldDefinitions(ownerType: ORDER, first: 50, namespace: "custom") {
  nodes { key type { name } } } }
```

---

### ش-٢ — تصادم تاج `Bosta_Uploaded_S2`

`SPEC.md` بند **ش-٧** لقى إن `Bosta_Uploaded_S1` استخدامه **صفر**، بس فيه تاجات
بوسطة تانية شغّالة على **آلاف** الأوردرات: `Bosta` · `bosta_synced`.

**الفحص:**

```graphql
query {
  s2:     ordersCount(query: "tag:'Bosta_Uploaded_S2'", limit: 10000) { count }
  wild:   ordersCount(query: "tag:Bosta*", limit: 10000) { count }
}
```

**بيغيّر إيه:** لو صفر → التاج آمن. وفي الحالتين، أي أداة بتفلتر `tag:Bosta*`
هتلقط الاتنين — يتراجع قبل الإطلاق.

---

### ش-٣ — 🔴 امتلاء حقول العنوان في المرتجعات

**ليه مهم:** استعلام الـ Exporter الحالي (`buildDetailsQuery`) بيسحب:

```graphql
shippingAddress { name phone address1 address2 city province zip }
```

**ناقص `firstName` · `lastName` · `provinceCode`.** والتلاتة مطلوبين:

- `receiver.firstName` هو **الحقل الوحيد الإلزامي** للاسم عند بوسطة
  (`bosta-api-helper` 8.9: `required: [firstName, phone]`)
- `resolveAddress()` بتبدأ بـ `PROVINCE_BY_CODE.get(provinceCode)` وبعدين
  بترجع للاسم — من غير الكود المطابقة بتشتغل بس أضعف

**الفحص:**

```graphql
query {
  orders(first: 50, query: "metafields.custom.status_2_r_e:'Confirmed + RETURN' OR metafields.custom.status_2_r_e:'Confirmed + EXCHANGE' OR metafields.custom.status_2_r_e:'In-Return' OR metafields.custom.status_2_r_e:'Ready'") {
    nodes { name shippingAddress { name firstName lastName phone address1 address2 city province provinceCode zip } }
  }
}
```

**سجّل:** نسبة امتلاء كل حقل. `SPEC.md` بند **ش-٦** قاس على أوردرات S1:
`shippingAddress.phone` = **100%**، والأرقام مخزّنة **بشكلين** (`01…` و`+201…`)
→ التطبيع إلزامي. **الرقم ده لازم يتقاس تاني على المرتجعات** — عينة مختلفة.

---

### ش-٤ — الويبهوك القديم على `ecommoda24`

**بند مفتوح رقم ٢ في `Bosta-Orders-Upload/CLAUDE.md`** (و`SPEC.md` §٩.١ · م-١):
Worker اسمه `bosta-webhook` على حساب Cloudflare مهجور — شغّال ولا لأ؟

**دليل جديد من جلسة 10-09-2026:** قرينا آخر **١٠ أوردرات** حالتها `Shipped`،
وكلها معاها `bosta_tracking_number` — و**`bosta_order_type` و
`bosta_last_sync_time` و`bosta_number_of_attempts` كلهم `null` في العشرة**.

🟡 **دي قرينة قوية إن السنك مش بيكتب، مش إثبات إنه ميت.** الفلتر
`metafields.custom.X:*` **مابيشتغلش** في بحث شوبيفاي (جرّبته — رجّع كل الأوردرات
من غير فلترة)، فماقدرتش أجيب آخر أوردر اتكتب فيه القيم دي.

**الفحص المطلوب:**

1. من داشبورد بوسطة: **Settings → API Integration** (محمية بـ OTP لصاحب الحساب)
   — إيه الـ URL المسجّل بالظبط؟ `SPEC.md` §٩.١ بيقول إنه شكله
   `bosta-webhook.ecommoda24.worke…` **ومعاه Authorization Key متحطوط، مش فاضي**.
2. من Cloudflare (حساب `ecommoda24`): الـ Worker موجود؟ آخر deploy إمتى؟ فيه
   requests في آخر ٧ أيام؟
3. تصدير من شوبيفاي (Matrixify أو تقرير) لعمود `bosta_order_type` — **آخر أوردر
   فيه قيمة**. ده بيدي تاريخ موت السنك بالظبط.

**بيغيّر إيه:** لو السنك حي، الشحنات اللي المرحلة ٢ هترفعها هتبعت تحديثات حالتها
لمستقبِل **مش عارفين هو بيعمل بيها إيه** — وممكن يكتب فوق `bosta_tracking_number`
بتاع S1. **مش حاجز على البناء، بس لازم يتعرف قبل التشغيل الحي.**

---

### ش-٥ — 🔴 محرك مطابقة العنوان على عناوين مرتجعات

**ليه مهم:** الخطة إن محرك العنوان بتاع `Bosta-Orders-Upload`
(`§BOSTA::catalog` → `§BOSTA::resolveAddress`، ~٤٥٠ سطر) يتنقل كما هو. بس هو
**اتظبط ومُقيس على عناوين S1 بس**. عناوين المرتجعات نفس الأوردرات نظريًا — بس
مافيش قياس.

مثال حقيقي (`#51656`):
```
province : Gharbia
city     : طنطا
address1 : الغربيه - طنطا -شارع عبد العزيز محمد مع المأمون عماره زهره البستان رقم ٤٠ خلف مساكن الموظفين امام جمعيه السمك.
```
اسم المحافظة مكرر جوّه `address1` — وده بالظبط النمط اللي القاعدة القديمة
(«الأطول يكسب») كانت بتقع فيه.

**الفحص — من غير رفع أي شحنة:**

1. هات آخر **٣٠ أوردر R/E** بالاستعلام بتاع ش-٣
2. شغّل عليهم `resolveAddress()` من `Bosta-Orders-Upload/index.js` (نفس أسلوب
   `tests/address-matching.test.cjs` — بيحمّل `index.js` في sandbox)
3. عدّ النتايج: `mode = district` كام · `zoneName` كام · `province` كام ·
   **`cityDoubt = true` كام** 🟠 · و**العنوان اللي المحافظة بتاعته مش في الجدول** كام

**بيغيّر إيه:** لو `cityDoubt` طلعت نسبة عالية على المرتجعات، الواجهة محتاجة
نفس استثناء «تحديد الكل» بتاع المرحلة ١ — وممكن أكتر. ولو ظهرت حالات فشل
جديدة، دي بنود على المحرك **قبل** ما يتنقل.

---

## ٥. أسئلة تشغيلية (لأحمد — مش فحص تقني)

### ت-١ — 🔴 الفلتر: `courier` ولا `zone`؟

الأداتين بيستخدموا فلترين **مختلفين**:

| الأداة | الفلتر | معناه |
|---|---|---|
| `Bosta-Orders-Upload` (S1) | `metafields.custom.zone = 'Other_Regions'` | «الأوردر ده هيتشحن ببوسطة» — قرار CS وقت التأكيد |
| `Bosta-Return-Exchange-Exporter` (S2) | `metafields.custom.courier = 'Bosta'` | «الأوردر ده **اتشحن** ببوسطة» — أثر رجعي |

و`ecommoda-order-lifecycle` **Rule 16** بيقول `custom.zone` هو حقل **قناة
الكوريَر**، وهو اللي بيقرر مين بيشحن. و`custom.courier` بتتكتب **بعد** الرفع.

**السؤال:** أوردر بوسطة، مرتجعه ممكن يتجمع بمندوبنا؟ والعكس — أوردر شحنه
مندوبنا، مرتجعه ممكن يروح لبوسطة؟

- لو **أيوه** → الفلتر الحالي بيرفع أوردرات المفروض ماترفعش، وبيسيب أوردرات
  المفروض ترفع. محتاج قرار: `zone`، ولا حقل تالت للـ S2.
- لو **لأ، المرتجع دايمًا بنفس كوريَر الأصل** → الفلتر الحالي صح، ويتكتب في
  `CLAUDE.md` كقرار موثّق بدل ما يفضل ضمني.

📌 **ملحوظة مؤيّدة:** `#53701` عليه `zone = Cairo+Giza` و`courier = Sobhy` —
فهو **مش** في قايمة الأداة أصلًا. الفلتر الحالي متسق مع نفسه، السؤال بس هل
متسق مع الواقع التشغيلي.

---

### ت-٢ — سقف الـ `-2000` على Cash Amount

الواجهة بتعمل `Math.max(rawCash, -2000)` — يعني **قص صامت**.

**قياس حي:** `#53517` عليه **-2700** للعميل. الملف بيقول **-2000**. وملاحظة
الأوردر نفسه مكتوب فيها **«متبقي 700ج»** — يعني الفرق بيتسوّى مكتبيًا.

**السؤال:** الـ 2000 دي **حد من بوسطة** (بوسطة مابترجّعش أكتر من كده عند الباب)،
ولا **قرار داخلي**؟

**بيغيّر إيه:** في أداة API القص ده لازم يبقى **حالة صف معلنة** مش `Math.max`
صامت:
```
🟡 العميل ليه 2,700 — بوسطة هترجّع 2,000 · الباقي 700 يتسوّى مكتبيًا
```
ولو الحد من بوسطة، يتسجّل في `ecommoda-constants` §3 جنب `COD_MAX = 30000`.

---

### ت-٣ — `return_shipping_fees` مقابل الـ `cod`

فيه ميتافيلد `custom.return_shipping_fees` عليه قيم حقيقية:
`#51656 = 100` · `#53517 = 100` · `#53701 = 75`.

**السؤال:** المبلغ ده بيتحصّل من العميل **إزاي**؟ داخل الـ `cod`؟ ولا بوسطة
بتخصمه؟ ولا بيتسوّى بعدين؟

على `#53517` الحساب: `totalOutstanding = -2700` و`return_shipping_fees = 100`.
لو الـ 100 المفروض تتخصم، الرقم الصح **-2600** مش -2700.

**بيغيّر إيه:** لو الرسم جزء من الـ `cod`، الحساب الحالي **غلط بمقدار الرسم في
كل أوردر مرتجع**. ب-٠ سؤال ٣ بيجاوب على نص ده (بمقارنة `cod` الفعلي).

---

### ت-٤ — الفواتير والبوليصة

الواجهة الحالية بتسأل الموظف قبل تحديث الحالة:

```
☐ هل رفعت الأوردرات على موقع بوسطة؟        ← ده اللي الـ API بيلغيه
☐ هل أرسلت الفواتير PDF للمخزن؟             ← ده بيفضل؟
```

**السؤال:** خطوة الفواتير دي بتفضل يدوية؟ ومين بيطبع البوليصة بعد الرفع بالـ API
(ب-١٢)؟

---

## ٦. بنود توثيق وتسجيل

### م-١ — 🔴 تسجيل قيم `tool`/`type` في `ecommoda-constants` §7

`ecommoda-worker-builder` **Rule 7**: التسجيل **قبل** أول `writeLog` مش بعده.

**الدين الحالي (بندين مفتوحين قبل ما نضيف حاجة):**

| القيمة | الأداة | الحالة |
|---|---|---|
| `bosta_orders_upload` (الصف كله) | Bosta-Orders-Upload | 🔴 **مش مسجّل** — بند ١٨ في §7 |
| `cycle_block` (`type`) | هذه الأداة (v5.4.0) | 🔴 **مش مسجّل** |

**والمطلوب للمرحلة ٢** — قيم `type` جديدة على `tool = 'bosta_exchange_export'`.
الاقتراح، مبني على `worker-builder` ⑭ (**الـ `type` بيقسّم بالأثر الخارجي، مش
بالـ endpoint**) وعلى الفصل المتعمّد في المرحلة ١:

```
upload_re_return          رفع شحنة CRP نجح + الكتابة على شوبيفاي تمّت
upload_re_exchange        رفع شحنة Exchange نجح + الكتابة تمّت
re_upload_failed          الشحنة ما اترفعتش أصلًا  ← إعادة المحاولة آمنة
re_shopify_write_failed   🔴 الشحنة موجودة عند بوسطة ومعاها رقم تتبع،
                             والكتابة الرجعية هي اللي فشلت
                             ← إعادة الرفع بتعمل شحنة تانية بفلوس حقيقية
```

⚠️ **الفصل بين آخر اتنين مش تجميل.** ده نفس الفصل اللي `Bosta-Orders-Upload`
عاملاه (`upload_failed` مقابل `shopify_write_failed`)، وسببه إن خلطهم بيخلي أي
إعادة محاولة **شحنة مكررة بفلوس حقيقية**، مش مجرد صف سجل ناقص.

**سؤال قبل التنفيذ:** المرحلة ٢ تتسجّل تحت **نفس** `tool = 'bosta_exchange_export'`
(عشان السجل يفضل مكان واحد ومايتكسرش) ولا `tool` جديد؟ لو `tool` جديد، راجع
`ecommoda-tool-rename` — الصفوف القديمة بتتيتّم.

### م-٢ — `skills-sweep` على الريبوين

بصمة المهارات في الاتنين **متأخرة**:

| المهارة | الحالي | Orders-Upload | R/E-Exporter |
|---|---|---|---|
| ecommoda-worker-builder | **v3.0.0** | v2.1.0 | v2.0.0 |
| ecommoda-html-builder | **v7.0.0** | v6.6.0 | v6.2.0 |
| ecommoda-order-lifecycle | **v1.5.0** | v1.3.0 | v1.2.0 |
| ecommoda-constants | **v2.0.0** | v1.10.0 | v1.4.3 |
| shopify-graphql-helper | **v2.1.0** | v1.1.0 | — |
| bosta-api-helper | v1.1.0 | ✅ v1.1.0 | — |

`CLAUDE.md` بتاع الأداة دي **طالب الجرد ده صراحةً**. وفيه `skillsupdates20260909.md`
في الريبو لسه ما اتطبّقش على المهارات.

⚠️ ومن ضمن الجديد: **Rule 16** (`custom.zone` قناة كوريَر مش جغرافيا) — وده
بالظبط اللي بند **ت-١** بيسأل عنه.

---

## ٧. جدول النتائج — املا وابعت

### أ) ب-٠ — تشريح الشحنات الموجودة

```
شحنة استبدال:  الأوردر #_______  ·  trackingNumber _______

<<< الصق رد GET /deliveries/business/{tn} كامل هنا >>>


شحنة استرجاع:  الأوردر #_______  ·  trackingNumber _______

<<< الصق رد GET كامل هنا >>>
```

| # | السؤال | الإجابة |
|---|---|---|
| ١ | اسم حقل الطرد الراجع (لو موجود) | |
| ٢ | `specs.description` في الاستبدال = خارج ولا راجع؟ | |
| ٣ | `cod` الفعلي مقابل `totalOutstanding` | |
| ٤ | `dropOffAddress` = عميل ولا مخزن؟ | |
| ٥ | فيه `pickupAddress`؟ | |
| ٦ | `businessLocationId` | |
| ٧ | شكل `businessReference` | |
| ٨ | فيه `uniqueBusinessReference`؟ | |
| ٩ | `type.value` للنوعين | |
| ١٠ | `allowToOpenPackage` · `flexShippingInfo` | |
| ١١ | `specs.size` · `packageType` | |
| ١٢ | `notes` مقابل `returnNotes` | |
| ١٣ | `goodsInfo.amount` | |
| ١٤ | `state.code` | |
| **د** | **كام شحنة رجعت لكل أوردر؟** | |

### ب) الفحوصات

| البند | النتيجة | ملاحظات |
|---|---|---|
| ب-١ CRP | ⬜ | |
| ب-٢ Exchange + `returnSpecs` | ⬜ | |
| ب-٣ `cod` سالب (25 / 30) | ⬜ | |
| **ب-٤ `uniqueBusinessReference` مكرر** | ⬜ | نداء ② نجح ولا `11000`؟ |
| ب-٥ عدد شحنات الأوردر الواحد | ⬜ | |
| ب-٦ العقدين + `3003` | ⬜ | |
| ب-٧ `flexShippingInfo` على CRP | ⬜ | فيه أثر في الفاتورة؟ |
| ب-٨ `allowToOpenPackage` على CRP | ⬜ | EGP 7 بتتحسب؟ |
| ب-٩ `terminate` | ⬜ | |
| ب-١١ مواقع الاستلام (٤) | ⬜ | الاسم + `_id` لكل واحد |
| ب-١٢ `mass-awb` | ⬜ | |
| ش-١ الميتافيلد اتعمل | ⬜ | |
| ش-٢ تصادم التاج | ⬜ | |
| ش-٣ امتلاء حقول العنوان | ⬜ | نسبة لكل حقل |
| ش-٤ الويبهوك | ⬜ | URL المسجّل + آخر نشاط |
| ش-٥ المطابقة على ٣٠ عنوان مرتجع | ⬜ | توزيع الـ modes |
| ت-١ الفلتر | ⬜ | قرار أحمد |
| ت-٢ سقف -2000 | ⬜ | حد بوسطة ولا داخلي؟ |
| ت-٣ `return_shipping_fees` | ⬜ | |
| ت-٤ الفواتير + البوليصة | ⬜ | |
| م-١ التسجيل في §7 | ⬜ | |

### ج) شحنات تجريبية — كلها اتلغت؟

| # | trackingNumber | type | اتلغت؟ | كود `terminate` |
|---|---|---|---|---|
| ١ | | | ⬜ | |
| ٢ | | | ⬜ | |
| ٣ | | | ⬜ | |
| ٤ | | | ⬜ | |
| ٥ | | | ⬜ | |

🔴 **متقفلش الجلسة والجدول ده فيه صف مش متأكد إنه اتلغى.**

---

## ٨. اللي بيحصل بعد ما الملف ده يرجع

1. تحديث `bosta-api-helper` — **Step 8b جديدة** لعقد CRP/Exchange،
   وتصحيح 8.3 حسب نتيجة **ب-٤**. ومعاه bump + بند CHANGELOG مصنّف
   (`ecommoda-skill-versioning` — تغيير قيمة = **MAJOR**).
2. تحديث `ecommoda-constants` §3.3 بنفس نتيجة ب-٤، وتسجيل قيم §7 (**م-١**).
3. ترقية محرك العنوان لبلوك «انسخه حرفيًا» في `bosta-api-helper` — نفس نمط
   `§SHARED` في `worker-builder` — بدل نسختين بيفترقوا.
4. `skills-sweep` (**م-٢**).
5. بناء المسار: `get_districts` + `upload_re` في الـ Worker + الواجهة،
   **والإكسيل يفضل موجود** كخطة بديلة.

> 🔴 **وبند خارج نطاق الفحص ده بس بيحكم التوقيت:**
> `Bosta-Orders-Upload` **لسه ما اشتغلتش حيًا ولا مرة**
> (`CLAUDE.md`: «لسه ما اتشغّلتش حيًا»). المرحلة ٢ كلها قايمة على محركها.
> تشغيلها حي وتسجيل خط الأساس المطلوب فيها **قبل** بناء المرحلة ٢ — عشان لو
> فيه باج في المطابقة، اكتشافه يبقى على شحنة عادية، مش على مندوب رايح يستلم
> قطعة من فرع غلط.

</div>
