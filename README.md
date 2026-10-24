# 養雞場生產紀錄系統

LINE 官方帳號 + LIFF 每日生產紀錄、未填提醒、異常警報、數據看板。架構見 `養雞場生產紀錄系統_架構規劃書.pdf`，資料結構見 [docs/data-model.md](docs/data-model.md)。

## 專案結構

| 資料夾 | 內容 |
|---|---|
| `shared/` | 前後端共用：型別、防呆規則、衍生數字計算、日期（台灣時間） |
| `functions/` | Cloud Functions：API、LINE Webhook、排程 |
| `liff/` | LIFF 手機版：申請加入、今日總覽、填寫表單（防呆、草稿）、歷史紀錄 |
| `admin/` | 後台（網址 `/admin/`，與手機版共用 LIFF）：初始設定、填寫進度、出貨單、人員、雞場與雞舍 |
| `firestore.rules` | 前端唯讀權限；所有寫入經由 Functions |

## 網址

- 手機版（LINE 內開啟）：https://liff.line.me/2012188460-sKNHrih8
- 後台：https://poultry-farm-records-5f4e6.web.app/admin （場長、老闆；手機版首頁也有入口）

部署 `firebase deploy` 時會自動打包 `liff/` 和 `admin/`，後台輸出到 `liff/dist/admin/`。

## Cloud Functions

| 函式 | 觸發 | 說明 |
|---|---|---|
| `api` | HTTPS `/api/**` | 登入、申請／核准、每日紀錄 |
| `lineWebhook` | LINE Webhook | 加好友、訊息的免費回覆 |
| `remindStaff` | 每日 17:00 | 推播給負責未填雞舍的員工 |
| `remindManagers` | 每日 20:00 | 仍未填的雞舍通知場長 |

### API

| 方法 | 路徑 | 權限 |
|---|---|---|
| POST | `/api/auth/line` | LIFF ID Token 換 Firebase Custom Token |
| GET | `/api/me` | 登入者 |
| GET | `/api/farms/public` | 登入者（申請時選雞場） |
| POST | `/api/applications` | 新用戶申請加入 |
| POST | `/api/users/:uid/approve` | 場長、老闆 |
| PUT | `/api/users/:uid/assignments` | 場長、老闆 |
| POST | `/api/users/:uid/disable` | 場長、老闆 |
| GET | `/api/records/:houseId/:date/prefill` | 可看該雞舍者 |
| PUT | `/api/records/:houseId/:date` | 員工限今天／昨天且為指派雞舍 |

## 設定

1. `functions/.env`：參考 `functions/.env.example`
2. 本機模擬器密鑰：`functions/.secret.local`（已被 git 忽略）
3. 正式環境密鑰：
   ```
   firebase functions:secrets:set LINE_CHANNEL_SECRET
   firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN
   ```

## 指令

```
cd functions
npm install
npm run build      # 型別檢查 + 打包
npm run serve      # 本機模擬器（需要 Java）
```
