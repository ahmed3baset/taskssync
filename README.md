# تاسكاتي — TasksSync

قائمة تاسكات تعمل في المتصفح كـ PWA (زي برنامج)، وتتزامن لحظياً بين الكمبيوتر والايفون عن WebSocket. التغييرات بتفضل محفوظة محلياً لو النت انقطع، وتتزامن تلقائياً لما يرجع.

كل ملفات المشروع جوه **`D:\TasksSync`**.

## الملفات

| الملف | الوظيفة |
| --- | --- |
| `server.js` | سيرفر محلي: API + WebSocket + تقديم الواجهة |
| `store.js` | تخزين محلي في `data/tasks.json` أو Postgres لما يتحط `DATABASE_URL` |
| `worker.js` | نسخة النشر: توجيه الطلبات + التحقق من كلمة المرور + تقديم ملفات الـ PWA |
| `do.js` | Durable Object: تخزين التاسكات في SQLite + بثّ التحديثات لكل الأجهزة |
| `assets.generated.js` | ملفات الواجهة مجمّعة جوهWorker (بيتولد تلقائياً) |
| `wrangler.toml` | إعدادات النشر على Cloudflare |
| `public/` | واجهة الـ PWA (HTML/CSS/JS + Service Worker + أيقونات) |
| `scripts/generate-icons.js` | توليد أيقونات PWA |
| `scripts/build-assets.js` | تحديث `assets.generated.js` بعد تعديل أي ملف في `public/` |

## تشغيل محلي (للتجربة)

من PowerShell جوه `D:\TasksSync`:

```powershell
npm.cmd install
npm.cmd start
```

افتتح `http://localhost:3000`. أو ببساطة دبل-كلك على `start.cmd` لتشغيل السيرفر.

> ملاحظة على Windows: لو `npm` مبقاش شغال بسبب Execution Policy، استخدم `npm.cmd` زي فوق.

لتجربة الايفون على نفس الواي فاي: اعرف IP الكمبيوتر (`ipconfig` وابحث عن IPv4 Address) وافتح من الايفون:
`http://192.168.x.x:3000`

ده للاختبار بس — الـ Service Worker والـ PWA الكامل محتاجين HTTPS (أو localhost).

### تجربة نسخة Cloudflare محلياً

```powershell
npx.cmd wrangler dev --local
```

## النشر على النت (زامنة من أي مكان) — بدون بطاقة

النسخة المنشورة بتستخدم **Cloudflare Workers + Durable Objects** على الخطة المجانية. كل حاجة في مكان واحد: التخزين، الـ WebSocket، والـ PWA. مفيش كارت بنك ولا قاعدة بيانات منفصلة.

1. **حساب Cloudflare**
   - سجّل (أو ادخل) في [dash.cloudflare.com](https://dash.cloudflare.com) بالبريد أو GitHub. الخطة المجانية كافية.
   - من **Workers & Pages** → **Create** → **Worker** → اختار **Start from Hello World** (أو أي قالب) وسمّيه `taskssync`، ثم **Create**. (دي خطوة لإنشاء الاسم بس؛ الكود هيتبدّل في الخطوة 3.)

2. **API Token للنشر من الجهاز**
   - من [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → قالب **Edit Cloudflare Workers** → **Create Token** → انسخ التوكن.

3. **انشر من `D:\TasksSync`**

   ```powershell
   $env:CLOUDFLARE_API_TOKEN = "ال-token-اللي-نسخته"
   npx.cmd wrangler secret put APP_TOKEN
   npm.cmd run cf:deploy
   ```

   لما يسألك `wrangler secret put APP_TOKEN` اكتب كلمة مرور طويلة (مثلاً أنشئها بـ `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`). هتُطلب على كل جهاز مرة واحدة وبس.

4. **الرابط النهائي**
   - الرابط الحالي بعد النشر: **https://taskssync.taskssync.workers.dev**
   - لو غيّرت اسم الـ Worker في `wrangler.toml`، الرابط هيبقى `https://<الاسم>.<workers-dev-subdomain>.workers.dev`.
   - **الايفون**: افتح الرابط في Safari ← زر المشاركة ← *Add to Home Screen*.
   - **الكمبيوتر**: في Chrome/Edge اضغط أيقونة التثبيت في شريط العنوان، وبعدين ثبّت التطبيق لشريط المهام. هيظهر كنافذة مستقلة شبه البرنامج.

> لو عندك حساب Cloudflare فيه Worker باسم `taskssync` بالفعل، غيّر `name` في `wrangler.toml` لأي اسم تاني (مثلاً `taskssync-ahmed`).

## أهم ملاحظات

- التاسكات على النسخة المنشورة متخزنة في Durable Object SQLite جوه Cloudflare — مش في Neon. لو عملت مشروع Neon قبل كده مش محتاجه دلوقتي.
- `APP_TOKEN` مهم جداً لو الرابط عام؛ من غيره أي حد عنده الرابط يقدر يقرأ ويعدّل تاسكاتك.
- المزامنة لحظية: أي تعديل على جهاز بيتبعت فوراً لكل الأجهزة المفتوحة. لو جهاز مش متصل، التعديلات بتتصف في طابور محلي لحد ما يرجع الاتصال.
- السيرفر المحلي (`node server.js`) والنسخة المنشورة (`worker.js`) بيقدّموا نفس الـ API، بس التخزين مختلف.
- متغير `PORT` اختياري للسيرفر المحلي (الافتراضي `3000`). متغير `DATA_DIR` اختياري لتحديد مكان ملف التاسكات في الوضع المحلي.

## أوامر مفيدة

```powershell
npm.cmd test              # اختبار سريع للسيرفر المحلي والمزامنة بين عميلين
node test/worker-smoke.js # اختبار نسخة Cloudflare بعد wrangler dev --port 3200
npm.cmd run icons         # إعادة توليد الأيقونات
npm.cmd run assets:build  # تحديث ملفات الواجهة داخل الـ Worker
npm.cmd run cf:deploy     # بناء الأصول + نشر على Cloudflare
npm.cmd run dev           # تشغيل السيرفر المحلي مع إعادة تحميل تلقائي
```
