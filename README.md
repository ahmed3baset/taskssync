# تاسكاتي — TasksSync

قائمة تاسكات تعمل في المتصفح كـ PWA (زي برنامج)، وتتزامن لحظياً بين الكمبيوتر والايفون عن WebSocket. التغييرات بتفضل محفوظة محلياً لو النت انقطع، وتتزامن تلقائياً لما يرجع.

كل ملفات المشروع جوه **`D:\TasksSync`**.

## الملفات

| الملف | الوظيفة |
| --- | --- |
| `server.js` | API + WebSocket + تقديم الواجهة |
| `store.js` | تخزين في ملف `data/tasks.json` أو في Postgres لما يتحط `DATABASE_URL` |
| `public/` | واجهة الـ PWA (HTML/CSS/JS + Service Worker + أيقونات) |
| `scripts/generate-icons.js` | توليد أيقونات PWA |
| `Dockerfile` | للنشر على خدمة سحابية |

## تشغيل محلي (للتجربة)

من PowerShell جوه `D:\TasksSync`:

```powershell
npm.cmd install
npm.cmd start
```

افتح `http://localhost:3000`. أو ببساطة دبل-كلك على `start.cmd` لتشغيل السيرفر.

> ملاحظة على Windows: لو `npm` مبقاش شغال بسبب Execution Policy، استخدم `npm.cmd` زي فوق.

لتجربة الايفون على نفس الواي فاي: اعرف IP الكمبيوتر (`ipconfig` وابحث عن IPv4 Address) وافتح من الايفون:
`http://192.168.x.x:3000`

ده للاختبار بس — الـ Service Worker والـ PWA الكامل محتاجين HTTPS (أو localhost).

## النشر على النت (زامنة من أي مكان)

الخطة: **Neon** (قاعدة بيانات Postgres مجانية) + **Render** (استضافة الـ web service).

1. **قاعدة البيانات**
   - سجّل في [neon.tech](https://neon.tech) وأنشئ project.
   - انسخ connection string واختر `Pooled connection`، وخلّي في آخره `?sslmode=require`.

2. **السيرفر**
   - ارفع محتوى `D:\TasksSync` إلى مستودع GitHub جديد (من غير `node_modules` و`data`).
   - في [render.com](https://render.com) → **New + → Web Service** → اختر المستودع.
   - Environment: `Docker`. Render هيبني من `Dockerfile` تلقائياً.
   - أضف متغيرات البيئة:
     - `DATABASE_URL` = connection string من Neon.
     - `APP_TOKEN` = كلمة مرور طويلة وعشوائية (مثلاً أنشئها بـ `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`).
   - Health Check Path: `/api/health`.
   - بعد النشر، افتح الرابط الذي يظهر لك (بشكل `https://...onrender.com`).

3. **التثبيت على الأجهزة**
   - **الايفون**: افتح الرابط في Safari ← زر المشاركة ← *Add to Home Screen*.
   - **الكمبيوتر**: في Chrome/Edge اضغط أيقونة التثبيت في شريط العنوان، وبعدين ثبّت التطبيق لشريط المهام. هيظهر كنافذة مستقلة شبه البرنامج.

4. **كلمة المرور**: أول ما تفتح الرابط على أي جهاز، هتطلب `APP_TOKEN`. أدخلها مرة واحدة وبتتذكر على الجهاز.

## أهم ملاحظات

- لو `DATABASE_URL` مش متحط، التاسكات بتتخزن في `data/tasks.json` على الكمبيوتر اللي شغّل السيرفر — ده كافي للتجربة المحلية بس، مش للزامنة برة البيت.
- `APP_TOKEN` مهم جداً لو الرابط عام؛ من غيره أي حد عنده الرابط يقدر يقرأ ويعدّل تاسكاتك.
- المزامنة لحظية: أي تعديل على جهاز بيتبعت فوراً لكل الأجهزة المفتوحة. لو جهاز مش متصل، التعديلات بتتصف في طابور محلي لحد ما يرجع الاتصال.
- متغير `PORT` اختياري (الافتراضي `3000`) وRender بيحطه تلقائياً.
- متغير `DATA_DIR` اختياري لتحديد مكان ملف التاسكات في وضع التخزين المحلي.

## أوامر مفيدة

```powershell
npm.cmd test        # اختبار سريع للـ API والمزامنة بين عميلين
npm.cmd run icons   # إعادة توليد الأيقونات
npm.cmd run dev     # تشغيل مع إعادة تحميل تلقائي عند تعديل الكود
```
