import { createApp } from './app.factory';

async function bootstrap() {
  const app = await createApp();
  // خلف وكيل عكسي (HTTPS) فعّل trust proxy ليظهر IP الحقيقي في السجلات وتحديد المعدل
  if (process.env.TRUST_PROXY === 'true') (app.getHttpAdapter().getInstance() as any).set('trust proxy', 1);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`الخادم يعمل على المنفذ ${port}`);
}
bootstrap();
