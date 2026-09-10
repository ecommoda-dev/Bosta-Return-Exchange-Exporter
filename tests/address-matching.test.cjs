// ══════════════════════════════════════════════════════════════
// اختبار ترجيح مطابقة المنطقة — يتشغّل بـ:  node tests/address-matching.test.cjs
//
// 🔴 الملف ده **نسخة** من نفس الاختبار في ريبو `Bosta-Orders-Upload`، لأن
//    محرك المطابقة نفسه اتنسخ هنا (§BOSTA::catalog → §BOSTA::resolveAddress).
//    نسخة كود من غير نسخة اختبارها معناها إن النسختين هيفترقوا في صمت.
//    أي تعديل في الترجيح يتعمل في الاتنين — أو في البلوك المشترك المقترح في
//    `bosta-api-helper`.
//
// كل حالة هنا **أوردر حقيقي** من المتجر (أو حالة احتواء موثّقة)، وكلها كانت
// بتطلع غلط أو غامضة قبل ترجيح v1.1.0. الملف ده هو اللي بيمنع رجوع الباج.
// 🔴 الكتالوج هنا مصغّر ومكتوب بالإيد — مش بديل عن الكتالوج الحي، هو بس
//    بيثبّت **قواعد الترجيح** على أسماء حقيقية من بوسطة.
// ══════════════════════════════════════════════════════════════
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname,'..','index.js'),'utf8').replace(/export default \{[\s\S]*$/,'');
const api = new Function(src + `
 return { normText, ensureNormalized, matchDistrict, addressFields, resolveAddress, findCrossCity };`)();

const D = (id,name,nameAr,zone='Z') => ({ id, name, nameAr, zone, zoneAr:'', dropOff:true });

// كتالوج مصغّر بأسماء حقيقية من بوسطة
const catalog = { cities: [
  { cityId:'ByP7rFCjL6XzF6j4S', cityName:'Kafr Alsheikh', cityAr:'كفر الشيخ', districts:[
      D('k1','Kafr ElSheikh','كفر الشيخ'), D('k2','Sidi Salem','سيدي سالم'),
      D('k3','Qalin','قلين'), D('k4','Desouk','دسوق'), D('k5','Balteem','بلطيم') ]},
  { cityId:'RrDhS8YYsXAwZ9Zfo', cityName:'Dakahlia', cityAr:'الدقهلية', districts:[
      D('d1','Mansoura','المنصورة'), D('d2','Aga','اجا'), D('d3','Mit Ghamr','ميت غمر') ]},
  { cityId:'FceDyHXwpSYYF9zGW', cityName:'Cairo', cityAr:'القاهرة', districts:[
      D('c1','Nasr City','مدينة نصر'), D('c2','Nasr','نصر'), D('c3','Heliopolis','مصر الجديدة'),
      D('c4','Obour','العبور'), D('c5','Obour District 05','العبور - المنطقة 05'),
      D('c6','Gesr El Suez','جسر السويس'), D('c7','Maadi','المعادي') ]},
  { cityId:'yp3atroeTwnyiBNKE', cityName:'El Kalioubia', cityAr:'القليوبية', districts:[
      D('q1','Banha','بنها'), D('q2','Qalyub','قليوب'), D('q3','Shubra El Kheima','شبرا الخيمة') ]},
  { cityId:'ruBSjGBDX9wpRa3cc', cityName:'Monufia', cityAr:'المنوفية', districts:[
      D('m1','Shebin El Kom','شبين الكوم') ]},
  { cityId:'K3RwC677J8kJytdZD', cityName:'Gharbia', cityAr:'الغربية', districts:[
      D('g1','Tanta','طنطا'), D('g2','El Santa','السنطة') ]},
  { cityId:'qoZvYcZ8Cqji4pGp5', cityName:'Damietta', cityAr:'دمياط', districts:[
      D('t1','New Damietta','دمياط الجديدة') ]},
  // اسمين **متطابقين** لمنطقتين مختلفتين — لازم يفضلوا غموض، مش حسم عشوائي
  { cityId:'PJqNriLtFtx2cfkKP', cityName:'Ismailia', cityAr:'الإسماعيلية', districts:[
      D('i1','El Manshia A','المنشية'), D('i2','El Manshia B','المنشية') ]},
]};
api.ensureNormalized(catalog);

const cases = [
  ['#53774 كفر الشيخ/سيدي سالم', {city:'سيدي سالم', address1:'كفر الشيخ سيدي سالم بجوار بنك مصر', province:'Kafr el-Sheikh', provinceCode:'KFS'}, 'Sidi Salem'],
  ['#53834 قلين',               {city:'قلين', address1:'كفر الشيخ مركز قلين', province:'Kafr el-Sheikh', provinceCode:'KFS'}, 'Qalin'],
  ['#53818 المنصورة/اجا',        {city:'Al Daqahliya', address1:'المنصورة / اجا/ طنامل', province:'Dakahlia', provinceCode:'DK'}, 'ambiguous'],
  ['#53821 القاهرة/مصر الجديدة', {city:'القاهرة', address1:'١٣ ش القناطر ميدان صلاح الدين مصر الجديدة', province:'Cairo', provinceCode:'C'}, 'Heliopolis'],
  ['#53832 القاهرة/جسر السويس',  {city:'القاهرة', address1:'جسر السويس القاهره خلف مبنى ايه بي سي', province:'Cairo', provinceCode:'C'}, 'Gesr El Suez'],
  ['مدينة نصر (احتواء)',          {city:'مدينة نصر', address1:'١ إسكان شباب المهندسين طريق النصر مدينة نصر', province:'Cairo', provinceCode:'C'}, 'Nasr City'],
  ['محافظة بس — كفر الشيخ',      {city:'كفر الشيخ', address1:'كفر الشيخ شارع الجيش', province:'Kafr el-Sheikh', provinceCode:'KFS'}, 'Kafr ElSheikh'],
  ['#53698 العبور (عبر مدينة)',  {city:'العبور ', address1:'العبور شارع الشباب الجامع الكبير ٥٦٢ شقه ٨', province:'Qalyubia', provinceCode:'KB'}, 'cityDoubt'],
  ['#53800 شبين الكوم/الغربية',  {city:'شبين الكوم', address1:'شبين الكوم', province:'Gharbia', provinceCode:'GH'}, 'cityDoubt'],
  ['#53814 دمياط الجديدة/القاهرة',{city:'Cairo', address1:'دمياط الجديدة بن الزعيم المركزية مقابل البنك الاهلي', province:'Cairo', provinceCode:'C'}, 'cityDoubt'],
  // اسمين متطابقين لمنطقتين ≠ حسم — لو الاحتواء ما اشترطش طول أكبر، دي كانت
  // هتترفع على أول منطقة في الترتيب في صمت
  ['اسمين متطابقين = غموض',      {city:'المنشية', address1:'المنشية شارع الجيش', province:'Ismailia', provinceCode:'IS'}, 'ambiguous'],
  // محافظة مش في الجدول = وقف صريح، مش تخمين
  ['محافظة مش في الجدول',        {city:'مكان', address1:'عنوان', province:'Nowhere', provinceCode:'ZZ'}, 'BLOCKED'],
];

let pass = 0;
for (const [label, sa, want] of cases) {
  const p = api.resolveAddress({ shippingAddress: sa }, catalog);
  let got;
  if (!p.ok) got = 'BLOCKED:' + p.error;
  else if (p.mode === 'district') got = p.districtName;
  else if (p.ambiguous) got = 'ambiguous';
  else if (p.cityDoubt) got = 'cityDoubt';
  else got = 'province-only';
  const ok = want === 'BLOCKED' ? got.startsWith('BLOCKED:') : got === want;
  if (ok) pass++;
  console.log(`${ok?'✅':'❌'} ${label}\n     المتوقع: ${want}  ·  الناتج: ${got}`);
  if (p.ok && p.candidates.length > 1)
    console.log(`     الاحتمالات: ${p.candidates.map(c=>`${c.name} (${c.matchedText} من ${c.fieldLabel})`).join(' | ')}`);
  if (p.ok && p.crossCity?.length)
    console.log(`     اقتراح مدينة: ${p.crossCity.slice(0,3).map(c=>`${c.cityName} → ${c.districtName} (${c.matchedText})`).join(' | ')}`);
}
console.log(`\n${pass}/${cases.length} نجحت`);

process.exit(pass === cases.length ? 0 : 1);
