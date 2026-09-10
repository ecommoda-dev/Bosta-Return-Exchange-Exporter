// ══════════════════════════════════════════════════════════════
// عقد إنشاء شحنة الاسترجاع/الاستبدال — node tests/re-payload.test.cjs
//
// كل تأكيد هنا بيقفل حالة **مقيسة حيًا** على حساب بوسطة (10-09-2026،
// PHASE2-LIVE-CHECKS §٢). الملف ده هو اللي بيمنع رجوع الأربع أخطاء اللي
// كل واحدة فيهم بتعمل شحنة بفلوس حقيقية غلط:
//   ① العنوان في الحقل الغلط (CRP بيرد 500 مش 400)
//   ② Math.abs على الـ cod — بيقلب «رجّعله ٢٠٠٠» لـ«حصّل منه ٢٠٠٠»
//   ③ uniqueBusinessReference = رقم الأوردر — بيصطدم بشحنة S1
//   ④ القص عند -2000 بصمت — العميل بياخد أقل من حقه بلا تحذير
// ══════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
  .replace(/export default \{[\s\S]*$/, '');
const api = new Function(src + `
 return { buildRePayload, buildUniqueRef, resolveCod, buildPayloadParts,
          resolveReturnItems, validateReOrder, resolveAddress, ensureNormalized,
          wirePhone, normPhone, flattenNote, COD_REFUND_MIN, BOSTA_TYPE_BY_JOB };`)();

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}${extra !== undefined ? `  →  ${JSON.stringify(extra)}` : ''}`); }
}
function eq(label, got, want) { ok(label, JSON.stringify(got) === JSON.stringify(want), { got, want }); }

// ─── fixtures ────────────────────────────────────────────────
const SA = {
  name: 'Ahmed El Deeb', firstName: 'Ahmed', lastName: 'El Deeb',
  phone: '+20 12 71043044',                       // 🔴 الشكل التالت المقيس حيًا (#53849)
  address1: 'B12 - Group 123 - Building 57', address2: null,
  city: 'مدينة نصر', province: 'Cairo', provinceCode: 'C',
};

const returnedPiece = (sku, qty, price) => ({
  node: { quantity: qty, fulfillmentLineItem: { lineItem: { sku, name: sku, originalUnitPriceSet: { shopMoney: { amount: String(price) } } } } },
});

function order({ outstanding = -1650, cycleName = '#53517-R1', outgoing = [], returned = [['SKU-A', 1, 1650]] } = {}) {
  return {
    id: 'gid://shopify/Order/1', name: '#53517', note: 'أوردر استرجاع\nلا يوجد مصاريف شحن',
    shippingAddress: { ...SA },
    customer: { phone: '01019191915' },
    totalOutstandingSet: { shopMoney: { amount: String(outstanding) } },
    outgoingItems: outgoing,
    currentCycle: { name: cycleName, returnLineItems: { edges: returned.map((r) => returnedPiece(...r)) } },
  };
}

const plan = { ok: true, mode: 'district', province: 'Cairo', cityId: 'FceDyHXwpSYYF9zGW', cityName: 'Cairo', districtId: 'c1', districtName: 'Nasr City' };

// ─── ① الاتجاه بيتقلب حسب النوع ──────────────────────────────
console.log('\n① اتجاه العنوان — الفرق اللي بيرجّع 500 لو اتعكس');
{
  const o = order();
  const parts = { ...api.buildPayloadParts(o, 'return'), uref: '#53517-R1' };
  const crp = api.buildRePayload(o, plan, 'district', 'return', parts);
  ok('CRP: عنوان العميل في pickupAddress', !!crp.pickupAddress && crp.pickupAddress.districtId === 'c1');
  ok('CRP: مفيش dropOffAddress خالص (بوسطة بتملاه من businessLocationId)', crp.dropOffAddress === undefined);
  ok('CRP: مفيش specs — مفيش حاجة خارجة من المخزن', crp.specs === undefined);
  eq('CRP: type = 25', crp.type, 25);

  const oe = order({ outstanding: 100, cycleName: '#53517-R2', outgoing: [{ label: 'SKU-B', qty: 1, unitPrice: 2400 }] });
  const pe = { ...api.buildPayloadParts(oe, 'exchange'), uref: '#53517-EX2' };
  const exc = api.buildRePayload(oe, plan, 'district', 'exchange', pe);
  ok('Exchange: عنوان العميل في dropOffAddress', !!exc.dropOffAddress && exc.dropOffAddress.districtId === 'c1');
  ok('Exchange: مفيش pickupAddress', exc.pickupAddress === undefined);
  ok('Exchange: specs = القطع الخارجة', exc.specs?.packageDetails?.description === 'SKU-B x1');
  eq('Exchange: type = 30', exc.type, 30);
  ok('النوعين: returnSpecs = القطع الراجعة', crp.returnSpecs?.packageDetails?.description === 'SKU-A x1'
     && exc.returnSpecs?.packageDetails?.description === 'SKU-A x1');
}

// ─── ② الحقل اسمه city مش cityName ───────────────────────────
console.log('\n② شكل العنوان');
{
  const o = order();
  const parts = { ...api.buildPayloadParts(o, 'return'), uref: '#53517-R1' };
  const crp = api.buildRePayload(o, plan, 'district', 'return', parts);
  ok('city موجودة و cityName مش موجودة (الڤاليديتور بيتجاهل cityName بصمت)',
     crp.pickupAddress.city === 'Cairo' && crp.pickupAddress.cityName === undefined);
  const zoneP = api.buildRePayload(o, { ...plan, mode: 'zoneName', districtName: '6 October' }, 'zoneName', 'return', parts);
  ok('zoneName: cityId + districtName مع بعض', zoneP.pickupAddress.cityId === 'FceDyHXwpSYYF9zGW' && zoneP.pickupAddress.districtName === '6 October');
  const provP = api.buildRePayload(o, plan, 'province', 'return', parts);
  ok('province: الاسم بس، من غير districtId ولا cityId', provP.pickupAddress.districtId === undefined && provP.pickupAddress.cityId === undefined);
}

// ─── ③ الـ cod بإشارته ───────────────────────────────────────
console.log('\n③ الـ cod — الإشارة محمولة للمعنى');
{
  eq('سالب بيفضل سالب (مفيش Math.abs)', api.resolveCod({ totalOutstandingSet: { shopMoney: { amount: '-1650' } } }).cod, -1650);
  eq('موجب بيفضل موجب', api.resolveCod({ totalOutstandingSet: { shopMoney: { amount: '100' } } }).cod, 100);

  const clipped = api.resolveCod({ totalOutstandingSet: { shopMoney: { amount: '-2700' } } });
  eq('تحت -2000 بيتقص عند الحد (بوسطة بترد 3008)', clipped.cod, api.COD_REFUND_MIN);
  ok('والقص **معلَن** مش صامت', clipped.clipped === true && clipped.remainder === 700, clipped);
  ok('اللي مش متقصوص مش بيتعلّم بالغلط', api.resolveCod({ totalOutstandingSet: { shopMoney: { amount: '-2000' } } }).clipped === false);
}

// ─── ④ uniqueBusinessReference ───────────────────────────────
console.log('\n④ المرجع الفريد — الحاجز ضد شحنة تانية بفلوس');
{
  eq('استرجاع → #53517-R1', api.buildUniqueRef({ name: '#53517', currentCycle: { name: '#53517-R1' } }, 'return').uref, '#53517-R1');
  eq('استبدال → #53517-EX2', api.buildUniqueRef({ name: '#53517', currentCycle: { name: '#53517-R2' } }, 'exchange').uref, '#53517-EX2');

  const bad = api.buildUniqueRef({ name: '#53517', currentCycle: { name: 'return-2024' } }, 'return');
  ok('اسم دورة مش مفهوم = وقف صريح، مش تخمين رقم', bad.ok === false && bad.code === 'CYCLE_NAME_UNPARSEABLE', bad);
  ok('ومفيش دورة خالص = وقف كمان', api.buildUniqueRef({ name: '#53517' }, 'return').ok === false);

  const o = order();
  const p = api.buildRePayload(o, plan, 'district', 'return', { ...api.buildPayloadParts(o, 'return'), uref: '#53517-R1' });
  eq('businessReference = اسم الأوردر بالحرف (بالهاش) — كل السكانرات بتدوّر بيه', p.businessReference, '#53517');
  ok('والمرجع الفريد ≠ رقم الأوردر لوحده (ده بتاع شحنة S1 وهيصطدم 11000)',
     p.uniqueBusinessReference !== '53517' && p.uniqueBusinessReference !== '#53517');
}

// ─── ⑤ التليفون ──────────────────────────────────────────────
console.log('\n⑤ التليفون — تلات أشكال مقيسة في المتجر');
{
  eq('بمسافات → محلي', api.wirePhone('+20 12 71043044'), '01271043044');
  eq('+201… → محلي', api.wirePhone('+201019191915'), '01019191915');
  eq('01… زي ما هو', api.wirePhone('01019191915'), '01019191915');
  const o = order();
  const p = api.buildRePayload(o, plan, 'district', 'return', { ...api.buildPayloadParts(o, 'return'), uref: '#53517-R1' });
  ok('اللي اتبعت مفيهوش مسافات ولا +', /^0\d+$/.test(p.receiver.phone), p.receiver.phone);
  ok('secondPhone بيتبعت لما يكون رقم تاني فعلًا', p.receiver.secondPhone === '01019191915');

  const same = api.buildRePayload(
    { ...o, customer: { phone: '+201271043044' } }, plan, 'district', 'return',
    { ...api.buildPayloadParts(o, 'return'), uref: '#53517-R1' },
  );
  ok('ونفس الرقم بشكل تاني مابيتبعتش مرتين', same.receiver.secondPhone === undefined);
}

// ─── ⑥ قيمة البضاعة ─────────────────────────────────────────
console.log('\n⑥ goodsInfo — قيمة اللي بيتحرك فعلًا');
{
  const ret = api.buildPayloadParts(order({ returned: [['SKU-A', 2, 1750]] }), 'return');
  eq('استرجاع: قيمة الراجع', ret.goodsValue, 3500);
  const exc = api.buildPayloadParts(
    order({ outgoing: [{ label: 'SKU-B', qty: 1, unitPrice: 2400 }], returned: [['SKU-A', 1, 2600]] }), 'exchange');
  eq('استبدال: قيمة الخارج مش الراجع (#53701: 2400 مش 2600)', exc.goodsValue, 2400);
}

// ─── ⑦ اللي عمدًا مش بيتبعت ──────────────────────────────────
console.log('\n⑦ اللي مش بيتبعت عن قصد');
{
  const o = order();
  const p = api.buildRePayload(o, plan, 'district', 'return', { ...api.buildPayloadParts(o, 'return'), uref: '#53517-R1' });
  ok('flexShippingInfo مش بيتبعت — بوسطة بتحطها Not Applicable على R/E', p.flexShippingInfo === undefined);
  ok('allowToOpenPackage = true (مطابق للإكسيل، ب-٨ لسه مفتوح)', p.allowToOpenPackage === true);
  eq('الملاحظة بتتحوّل لسطر واحد', p.notes, 'أوردر استرجاع / لا يوجد مصاريف شحن');
}

// ─── ⑧ الوقف قبل أي فعل لا رجعة فيه ──────────────────────────
console.log('\n⑧ الوقف قبل النداء اللي بيكلّف فلوس');
{
  const good = api.buildPayloadParts(order(), 'return');
  eq('أوردر سليم = مفيش مشاكل', api.validateReOrder(order(), plan, good, 'return'), []);

  const noPieces = order({ returned: [] });
  ok('مفيش قطعة راجعة = وقف', api.validateReOrder(noPieces, plan, api.buildPayloadParts(noPieces, 'return'), 'return').length > 0);

  const noPhone = order(); noPhone.shippingAddress.phone = '';
  ok('تليفون ناقص = وقف', api.validateReOrder(noPhone, plan, good, 'return').some((m) => m.includes('تليفون')));

  ok('محافظة مش في الجدول = وقف برسالة صريحة',
     api.validateReOrder(order(), { ok: false, error: 'المحافظة مش في الجدول' }, good, 'return').length === 1);

  const excNoOut = order({ outstanding: 100 });
  ok('استبدال بلا قطعة خارجة = وقف', api.validateReOrder(excNoOut, plan, api.buildPayloadParts(excNoOut, 'exchange'), 'exchange')
     .some((m) => m.includes('خارجة')));
}

// ─── ⑨ الكتالوج اتغيّر تحتينا ─────────────────────────────────
console.log('\n⑨ مدينة من الجدول مش في كتالوج بوسطة الحي');
{
  // الجدول مقفول وحتمي، فالحالة دي معناها كتالوج بوسطة اتغيّر.
  // 🔴 قبل الإصلاح: `findLocalZones(null)` كانت بترمي، والاستثناء كان بيطلع
  //    من `fetch_candidates` كله — يعني أوردر واحد بيوقّع القايمة كلها
  //    **ويقفل معاها مسار الإكسيل** اللي المفروض يفضل شغّال مهما حصل لبوسطة.
  const emptyCatalog = { cities: [] };
  api.ensureNormalized(emptyCatalog);
  let threw = null, plan = null;
  try { plan = api.resolveAddress({ shippingAddress: { ...SA } }, emptyCatalog); }
  catch (e) { threw = e; }
  ok('مابيرميش استثناء', threw === null, threw && threw.message);
  ok('بيوقف الصف برسالة صريحة بدل ما يقول «مفيش مطابقة»', plan && plan.ok === false && /الكتالوج الحي/.test(plan.error), plan);
}

console.log(`\n${'═'.repeat(50)}\nنجح ${pass} · فشل ${fail}\n`);
process.exit(fail ? 1 : 0);
