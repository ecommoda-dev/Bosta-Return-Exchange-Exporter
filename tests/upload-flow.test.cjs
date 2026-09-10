// ══════════════════════════════════════════════════════════════
// مسار الرفع كامل — node tests/upload-flow.test.cjs
//
// بيشغّل `uploadOne` على fetch مزيّف بيقلّد ردود بوسطة الحقيقية المقيسة.
// الملف ده بيغطي اللحظة اللي بتتصرف فيها فلوس، والقاعدة اللي بتحكمها:
// 🔴 بعد ما الشحنة تتعمل، أي فشل بعدها = warning مش error — لأن الأحمر
//    بيخلي الموظف يعيد الرفع، وإعادة الرفع = شحنة تانية بفلوس حقيقية.
// ══════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
  .replace(/export default \{[\s\S]*$/, '');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}${extra !== undefined ? `  →  ${JSON.stringify(extra)}` : ''}`); }
}

// كل تشغيل بياخد fetch مزيّف خاص بيه
function load(fetchImpl) {
  return new Function('fetch', 'caches', src + `
    return { uploadOne, ensureNormalized, runUploadBatch };`)(fetchImpl, { default: { match: async () => null, put: async () => {} } });
}
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

const D = (id, name, nameAr, zone = 'Z') => ({ id, name, nameAr, zone, zoneAr: '', dropOff: true });
const catalog = { cities: [
  { cityId: 'FceDyHXwpSYYF9zGW', cityName: 'Cairo', cityAr: 'القاهرة', districts: [
      D('c1', 'Nasr City', 'مدينة نصر'), D('c3', 'Heliopolis', 'مصر الجديدة')] },
  { cityId: 'yp3atroeTwnyiBNKE', cityName: 'El Kalioubia', cityAr: 'القليوبية', districts: [D('q1', 'Banha', 'بنها')] },
]};

function order(over = {}) {
  return {
    id: 'gid://shopify/Order/1', name: '#53517', note: null,
    shippingAddress: {
      name: 'Ahmed Ali', firstName: 'Ahmed', lastName: 'Ali', phone: '01019191915',
      address1: 'مدينة نصر شارع مصطفى النحاس', address2: null,
      city: 'مدينة نصر', province: 'Cairo', provinceCode: 'C',
    },
    customer: { phone: '01019191915' },
    totalOutstandingSet: { shopMoney: { amount: '-1650' } },
    outgoingItems: [],
    currentCycle: { name: '#53517-R1', returnLineItems: { edges: [
      { node: { quantity: 1, fulfillmentLineItem: { lineItem: { sku: 'SKU-A', name: 'SKU-A', originalUnitPriceSet: { shopMoney: { amount: '1650' } } } } } },
    ]}},
    ...over,
  };
}
const JOB = { jobType: 'return', label: 'استرجاع', nextStatus: 'In-Return' };
const env = { BOSTA_API_KEY: 'k' };

// ─── ① نجاح عادي ─────────────────────────────────────────────
console.log('\n① رفع ناجح على العقد الموثّق');
{
  const calls = [];
  const api = load(async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return reply(201, { success: true, data: { trackingNumber: '123456789', _id: 'x1' } }); });
  api.ensureNormalized(catalog);
  return_(api, calls);
}
function return_(api, calls) {
  api.uploadOne(env, order(), catalog, JOB, null).then((row) => {
    ok('الحالة success', row.status === 'success', row);
    ok('رقم التتبع اتقرا', row.trackingNumber === '123456789');
    ok('العقد الموثّق (?apiVersion=1) لأن المنطقة اتطابقت', calls[0].url.includes('apiVersion=1'), calls[0].url);
    ok('العنوان راح لـ pickupAddress (CRP)', !!calls[0].body.pickupAddress && !calls[0].body.dropOffAddress);
    ok('الـ cod سالب زي ما هو', calls[0].body.cod === -1650, calls[0].body.cod);
    run2();
  });
}

// ─── ② 3003 → رجوع تلقائي لمسار المحافظة ────────────────────
function run2() {
  console.log('\n② بوسطة رفضت المنطقة (3003) — الرجوع التلقائي');
  const calls = [];
  const api = load(async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    if (calls.length === 1) return reply(400, { success: false, errorCode: '3003', message: 'District Not Found' });
    return reply(201, { success: true, data: { trackingNumber: '999', _id: 'x2' } });
  });
  api.ensureNormalized(catalog);
  api.uploadOne(env, order(), catalog, JOB, null).then((row) => {
    ok('نداءين: الموثّق ثم غير الموثّق', calls.length === 2 && calls[0].url.includes('apiVersion=1') && !calls[1].url.includes('apiVersion=1'));
    ok('النتيجة warning مش error — الشحنة اتعملت', row.status === 'warning', row.status);
    ok('والسبب مكتوب للموظف', (row.warnings[0] || '').includes('المحافظة'));
    ok('النداء التاني بعت المدينة بالاسم بس', calls[1].body.pickupAddress.districtId === undefined);
    // 🔴 المقارنة بالرقم 3003 بدل النص كانت هتخلي الرجوع ده ما يحصلش خالص
    ok('errorCode اتقارن كنص', row.trackingNumber === '999');
    run3();
  });
}

// ─── ③ 11000 — الحاجز ضد الشحنة المكررة ─────────────────────
function run3() {
  console.log('\n③ 11000 — الدورة مرفوعة قبل كده');
  const api = load(async () => reply(400, { success: false, errorCode: '11000', message: 'duplicate key' }));
  api.ensureNormalized(catalog);
  api.uploadOne(env, order(), catalog, JOB, null).then((row) => {
    ok('error — ومفيش شحنة اتعملت', row.status === 'error' && row.trackingNumber === null);
    ok('والرسالة بتقول للموظف يعمل إيه (يلغي الأول)', row.error.includes('ألغيها') && row.error.includes('مرفوعة'), row.error);
    run4();
  });
}

// ─── ④ 500 من غير errorCode ─────────────────────────────────
function run4() {
  console.log('\n④ 500 من غير errorCode — الشكل اللي بوسطة بترده على عنوان في الحقل الغلط');
  const api = load(async () => reply(500, { message: "Cannot read properties of undefined (reading 'city')" }));
  api.ensureNormalized(catalog);
  api.uploadOne(env, order(), catalog, JOB, null).then((row) => {
    ok('اتعامل معاه من غير ما يقع', row.status === 'error');
    ok('والرسالة بتقول متعيدش المحاولة', row.error.includes('بلّغ') && row.error.includes('500'), row.error);
    run5();
  });
}

// ─── ⑤ التعديل اليدوي ───────────────────────────────────────
function run5() {
  console.log('\n⑤ التعديل اليدوي — بيوقف مش بيرجع في صمت');
  const api = load(async () => reply(201, { success: true, data: { trackingNumber: '1', _id: 'y' } }));
  api.ensureNormalized(catalog);

  api.uploadOne(env, order(), catalog, JOB, { districtId: 'NOT-REAL' }).then((row) => {
    // 🔴 لو رجع للمطابقة التلقائية في صمت، الشحنة بتروح لعنوان الموظف ما وافقش عليه
    ok('منطقة مش موجودة = وقف صريح', row.status === 'error' && row.error.includes('اتوقف'), row.error);
    return api.uploadOne(env, order(), catalog, JOB, { cityId: 'NOT-REAL' });
  }).then((row) => {
    ok('مدينة مش في الكتالوج = وقف كمان', row.status === 'error' && row.error.includes('الرفع اتوقف'));
    return run6();
  });
}

// ─── ⑥ تغيير المدينة يدويًا ─────────────────────────────────
function run6() {
  console.log('\n⑥ تغيير المدينة يدويًا — الرجوع بيمسك المدينة المعدّلة');
  const calls = [];
  const api = load(async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return reply(201, { success: true, data: { trackingNumber: '77', _id: 'z' } }); });
  api.ensureNormalized(catalog);
  return api.uploadOne(env, order(), catalog, JOB, { cityId: 'yp3atroeTwnyiBNKE' }).then((row) => {
    ok('المدينة اللي اتبعتت هي المعدّلة', calls[0].body.pickupAddress.city === 'El Kalioubia', calls[0].body.pickupAddress.city);
    ok('واتسجّل إن الموظف غيّرها (قياس city_overridden)', row.cityOverridden === true);
    ok('والمدينة التلقائية اتسجّلت جنبها للمقارنة', row.cityAuto === 'Cairo');
    ok('warning مش success — التغيير اليدوي لازم يبان', row.status === 'warning');
    ok('واتحوّل لمسار المحافظة (المنطقة القديمة مش تابعة للمدينة الجديدة)', calls[0].body.pickupAddress.districtId === undefined);
    return run7();
  });
}

// ─── ⑦ التوازي بيحافظ على الترتيب ───────────────────────────
function run7() {
  console.log('\n⑦ عقد الترتيب — النتايج بترجع بترتيب الإدخال');
  let n = 0;
  const api = load(async () => {
    const i = ++n;
    // ردود بترجع بترتيب مقلوب عمدًا
    await new Promise((r) => setTimeout(r, (6 - i) * 8));
    return reply(201, { success: true, data: { trackingNumber: `T${i}`, _id: `i${i}` } });
  });
  api.ensureNormalized(catalog);
  const orders = [1, 2, 3, 4, 5].map((k) => order({ name: `#${k}`, currentCycle: { name: `#${k}-R1`, returnLineItems: order().currentCycle.returnLineItems } }));
  return api.runUploadBatch(env, orders, catalog, JOB, {}).then((rows) => {
    ok('results[i] بتخص orders[i] مهما كان ترتيب الانتهاء',
       rows.map((r) => r.orderName).join(',') === '#1,#2,#3,#4,#5', rows.map((r) => r.orderName));
    ok('وكلهم نجحوا', rows.every((r) => r.status === 'success'));
    done();
  });
}

function done() {
  console.log(`\n${'═'.repeat(50)}\nنجح ${pass} · فشل ${fail}\n`);
  process.exit(fail ? 1 : 0);
}
