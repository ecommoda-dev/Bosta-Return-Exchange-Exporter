<div dir="rtl" style="text-align: right;">

# Bosta Return / Exchange Exporter

![version](https://img.shields.io/badge/version-v5.5.0-blue)

أداة داخلية لفريق EcomModa — فحص أوردرات الاسترجاع والاستبدال الجاهزة
للرفع على بوسطة، تصديرها Excel، وتأكيد الرفع بضغطة واحدة اللي بتحدّث
حالة الأوردر (S2) على شوبيفاي أوتوماتيك.

## البنية

```
index.js      Cloudflare Worker — القراءة من شوبيفاي والكتابة في D1 وشوبيفاي
wrangler.toml إعدادات الـ Worker (bindings + vars)
index.html    الواجهة (GitHub Pages)
CLAUDE.md     قواعد الأداة وسياق الصيانة
```

## النشر

مربوطة بـ Cloudflare Workers Builds — أي push على `main` بينشر الـ Worker
أوتوماتيك، والواجهة بتتنشر عبر GitHub Pages. تفاصيل النشر والفخاخ →
سكيل `ecommoda-tool-migration-playbook`.

## الإعدادات المطلوبة

راجع `CLAUDE.md` لقايمة الـ bindings والأسرار والـ vars المطلوبة.

آخر تحديث: 02-09-2026 — 19:30

</div>
