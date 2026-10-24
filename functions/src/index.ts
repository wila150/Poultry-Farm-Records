import express from 'express';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onRequest } from 'firebase-functions/v2/https';
import { authenticate } from './lib/auth';
import { LINE_CHANNEL_ACCESS_TOKEN } from './lib/config';
import { errorHandler } from './lib/http';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { recordsRouter } from './routes/records';
import { shipmentsRouter } from './routes/shipments';
import { usersRouter } from './routes/users';

setGlobalOptions({ region: 'asia-east1', maxInstances: 10, memory: '256MiB' });

// 所有 API 放在同一個函式，只要有人在用就保持醒著，減少冷啟動。
// Hosting 把 /api/** 轉到這裡，前後端同網域，不需要 CORS。
const app = express();
app.use(express.json({ limit: '100kb' }));

const router = express.Router();
router.get('/ping', (_req, res) => {
  res.json({ ok: true });
});
router.use('/auth', authRouter);
router.use(authenticate);
router.use(usersRouter);
router.use(adminRouter);
router.use(recordsRouter);
router.use(shipmentsRouter);

app.use('/api', router);
app.use(errorHandler);

export const api = onRequest({ secrets: [LINE_CHANNEL_ACCESS_TOKEN], invoker: 'public' }, app);
export { lineWebhook } from './webhook';
export { remindManagers, remindStaff } from './jobs/reminders';
