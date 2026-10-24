import { setGlobalOptions } from 'firebase-functions/v2';

// 必須在定義任何函式之前執行，所以 index.ts 第一個 import 這個檔案。
setGlobalOptions({ region: 'asia-east1', maxInstances: 10, memory: '256MiB' });
