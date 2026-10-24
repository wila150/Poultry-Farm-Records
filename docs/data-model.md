# Firestore 資料結構

所有寫入都經由 Cloud Functions（Admin SDK），前端只能讀取，權限由 `firestore.rules` 控制。
Firebase Auth 的 `uid` 直接等於 LINE `userId`，所以 `users/{uid}` 即可對應登入者。

日期一律存成台灣時間的字串 `YYYY-MM-DD`，時間戳記存 Firestore `Timestamp`。

## 集合一覽

| 集合 | 文件 ID | 說明 |
|---|---|---|
| `farms` | 自動 | 雞場 |
| `houses` | 自動 | 雞舍 |
| `users` | LINE userId | 使用者、角色、審核狀態 |
| `assignments` | 自動 | 員工負責雞舍（含起訖日，保留歷史） |
| `dailyRecords` | `{houseId}_{date}` | 每日紀錄（核心），ID 保證一棟一天一筆 |
| `dailyRecords/{id}/logs` | 自動 | 修改留痕 |
| `medicationEvents` | 自動 | 投藥／疫苗 |
| `weather` | `{farmId}_{date}` | 氣象資料 |
| `alertRules` | 規則代號 | 警報門檻（可在後台調整） |
| `alerts` | `{houseId}_{rule}_{date}` | 警報紀錄，ID 保證同日同規則不重複 |

## 欄位

### farms/{farmId}
| 欄位 | 型別 | 說明 |
|---|---|---|
| name | string | 名稱 |
| location | string | 地點 |
| weatherStationId | string \| null | 氣象署測站代號 |
| createdAt | Timestamp | |

### houses/{houseId}
| 欄位 | 型別 | 說明 |
|---|---|---|
| farmId | string | |
| name | string | A棟、B棟… |
| breed | string | 品種 |
| placementDate | string | 入雛日期 |
| initialCount | number | 初始隻數 |
| active | boolean | 啟用狀態 |

### users/{lineUserId}
| 欄位 | 型別 | 說明 |
|---|---|---|
| name | string | 申請時填的姓名 |
| lineDisplayName | string | LINE 顯示名稱 |
| role | `owner` \| `manager` \| `staff` | 老闆／場長／員工 |
| status | `pending` \| `active` \| `disabled` | 待審核／啟用／停用 |
| farmIds | string[] | 所屬雞場（老闆可為空，代表全部） |
| houseIds | string[] | 目前負責的雞舍（由 assignments 同步，供權限規則使用） |
| createdAt / updatedAt | Timestamp | |

### assignments/{id}
| 欄位 | 型別 | 說明 |
|---|---|---|
| userId | string | |
| farmId | string | |
| houseId | string | |
| startDate | string | |
| endDate | string \| null | null 代表目前仍負責 |

### dailyRecords/{houseId}_{date}
| 欄位 | 型別 | 說明 |
|---|---|---|
| farmId, houseId, date | string | |
| birdCount | number | 在養隻數 |
| deaths / culls | number | 死亡數／淘汰數 |
| eggsTotal / eggsBroken | number | 總蛋數／破蛋軟殼數 |
| avgEggWeight | number \| null | 平均蛋重（g） |
| feedKg / waterL | number \| null | 飼料量／飲水量 |
| tempMax / tempMin / humidity | number \| null | 環境 |
| note | string | 備註 |
| createdBy / updatedBy | string | userId |
| createdAt / updatedAt | Timestamp | |

產蛋率、死淘率等衍生數字不儲存，讀取時計算（`shared/src/metrics.ts`）。

### dailyRecords/{id}/logs/{logId}
`field`, `oldValue`, `newValue`, `by`, `at`

### medicationEvents/{id}
`farmId`, `houseId`, `date`, `type`（`vaccine` \| `medication`）, `name`, `dose`, `by`, `createdAt`

### weather/{farmId}_{date}
`farmId`, `date`, `tempMax`, `tempMin`, `humidity`, `source`

### alertRules/{code}
`enabled`, `params`（各規則的門檻，見 `shared/src/alertRules.ts`）

### alerts/{houseId}_{rule}_{date}
`farmId`, `houseId`, `rule`, `date`, `message`, `resolved`, `resolvedBy`, `resolvedAt`, `createdAt`

## 已定案的規則

- 產蛋率驟降以「百分點」計算。
- 熱緊迫以員工填寫的最高溫為主，沒填才用 `weather`。
- 在養隻數預填：往前找最近一筆紀錄，`birdCount − deaths − culls`，可手動修改。
- 排程時區一律 `Asia/Taipei`。
- 員工只能改今天和昨天、且目前指派給自己的雞舍；場長可改自己雞場的任何紀錄；老闆可改全部。
