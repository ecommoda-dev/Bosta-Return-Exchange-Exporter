<div dir="rtl" style="text-align: right;">

# Bosta Return / Exchange Exporter

![version](https://img.shields.io/badge/version-v6.0.0-blue)

أداة داخلية لفريق EcomModa — فحص أوردرات الاسترجاع والاستبدال الجاهزة
للرفع على بوسطة، و**رفعها على بوسطة مباشرةً بالـ API**: الأداة بتنشئ الشحنة
وبتحدّث حالة الأوردر (S2) على شوبيفاي في نفس النداء.

تصدير Excel لسه موجود كخطة بديلة — لو عقد بوسطة اتغيّر، أو المفتاح مش متاح،
أو أوردر الـ API رافضه.

🔴 **الأداة دي بتنشئ شحنات بفلوس حقيقية.** اقرا «فخاخ الرفع المباشر» في
`CLAUDE.md` قبل أي تعديل على `§RE-UPLOAD`.

## البنية

```
index.js                Cloudflare Worker — شوبيفاي · بوسطة · D1
wrangler.toml           إعدادات الـ Worker (bindings + vars)
index.html              الواجهة (GitHub Pages)
CLAUDE.md               قواعد الأداة وسياق الصيانة
PHASE2-LIVE-CHECKS.md   الفحوصات الحية اللي عقد الرفع اتبنى عليها
skillsupdates*.md       تصحيحات المهارات الناتجة من الفحص (بتتطبّق في جلسة منفصلة)
tests/                  اختبارات Node عادي، من غير أي تنصيب
```

## الاختبارات

```
node tests/re-payload.test.cjs        # عقد إنشاء الشحنة
node tests/upload-flow.test.cjs       # مسار الرفع كامل على fetch مزيّف
node tests/address-matching.test.cjs  # ترجيح مطابقة المنطقة
```

## النشر

مربوطة بـ Cloudflare Workers Builds — أي push على `main` بينشر الـ Worker
أوتوماتيك، والواجهة بتتنشر عبر GitHub Pages. تفاصيل النشر والفخاخ →
سكيل `ecommoda-tool-migration-playbook`.

## الإعدادات المطلوبة

راجع `CLAUDE.md` لقايمة الـ bindings والأسرار والـ vars المطلوبة.

آخر تحديث: 10-09-2026

</div>
