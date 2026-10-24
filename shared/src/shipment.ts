// 出貨單計算。前端即時顯示、後端存檔時再算一次，以後端結果為準。
// 重量單位是台斤；出貨單只記數量、重量、顆數，不記金額。

export const CATTY_G = 600; // 1 台斤 = 600 g

export interface ShipmentSettings {
  grades: string[];
  traysPerCart: number;
  eggsPerTray: number;
  /** 蛋盤車上秤時要扣除的車＋盤重量（公斤） */
  cartTareKg: number;
  /** 原料箱每箱固定重量（台斤） */
  boxCatty: number;
  /** 原料箱每箱合理顆數，超出範圍會提醒 */
  boxEggsMin: number;
  boxEggsMax: number;
}

export const DEFAULT_SHIPMENT_SETTINGS: ShipmentSettings = {
  grades: ['原料蛋', '大', '中', '小'],
  traysPerCart: 144,
  eggsPerTray: 30,
  cartTareKg: 150,
  boxCatty: 20,
  boxEggsMin: 180,
  boxEggsMax: 200,
};

export type ShipmentItemKind = 'box' | 'cart';

/** 開單時輸入的品項 */
export interface ShipmentItemInput {
  kind: ShipmentItemKind;
  grade: string;
  /** 原料箱：箱數；蛋盤：車數 */
  quantity: number;
  /** 蛋盤：上車秤的總重（台斤）。原料箱固定每箱 boxCatty 台斤，由系統計算 */
  weightCatty: number;
}

export interface ShipmentItem extends ShipmentItemInput {
  netCatty: number;
  eggs: number;
}

export interface ShipmentInput {
  date: string;
  customerId: string;
  /** 換算顆數用的平均蛋重（g），預設帶當天紀錄 */
  avgEggWeight: number;
  items: ShipmentItemInput[];
  note: string;
}

export interface Shipment extends Omit<ShipmentInput, 'items'> {
  farmId: string;
  no: string;
  customerName: string;
  items: ShipmentItem[];
  totalEggs: number;
  totalCatty: number;
  voided: boolean;
  createdBy: string;
  updatedBy: string;
}

export interface Customer {
  farmId: string;
  name: string;
  phone: string;
  address: string;
  note: string;
  active: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function calcItem(input: ShipmentItemInput, avgEggWeight: number, s: ShipmentSettings): ShipmentItem {
  // 原料箱不秤重，重量 = 箱數 × 每箱固定台斤
  const item = input.kind === 'box' ? { ...input, weightCatty: round1(input.quantity * s.boxCatty) } : input;
  const tareCatty = item.kind === 'cart' ? (item.quantity * s.cartTareKg * 1000) / CATTY_G : 0;
  const netCatty = round1(item.weightCatty - tareCatty);
  const eggs =
    item.kind === 'cart'
      ? item.quantity * s.traysPerCart * s.eggsPerTray
      : avgEggWeight > 0
        ? Math.round((netCatty * CATTY_G) / avgEggWeight)
        : 0;
  return { ...item, netCatty, eggs };
}

export function calcShipment(input: Pick<ShipmentInput, 'items' | 'avgEggWeight'>, s: ShipmentSettings) {
  const items = input.items.map((i) => calcItem(i, input.avgEggWeight, s));
  return {
    items,
    totalEggs: items.reduce((t, i) => t + i.eggs, 0),
    totalCatty: round1(items.reduce((t, i) => t + i.netCatty, 0)),
  };
}

export interface ShipmentValidation {
  errors: string[];
  /** 依品項索引 */
  itemErrors: Record<number, string>;
  itemWarnings: Record<number, string>;
}

export function validateShipment(input: ShipmentInput, s: ShipmentSettings): ShipmentValidation {
  const errors: string[] = [];
  const itemErrors: Record<number, string> = {};
  const itemWarnings: Record<number, string> = {};

  if (!input.customerId) errors.push('請選擇客戶');
  if (!(input.avgEggWeight > 0)) errors.push('請填平均蛋重');
  if (input.items.length === 0) errors.push('請至少新增一個品項');

  input.items.forEach((item, i) => {
    const nums = item.kind === 'cart' ? [item.quantity, item.weightCatty] : [item.quantity];
    if (!['box', 'cart'].includes(item.kind)) itemErrors[i] = '品項類型錯誤';
    else if (!item.grade) itemErrors[i] = '請選擇規格';
    else if (!Number.isInteger(item.quantity) || item.quantity <= 0) itemErrors[i] = item.kind === 'box' ? '箱數請填正整數' : '車數請填正整數';
    else if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) {
      itemErrors[i] = '請填上車總重';
    }
    if (itemErrors[i]) return;

    const calc = calcItem(item, input.avgEggWeight, s);
    if (calc.netCatty <= 0) {
      itemErrors[i] = item.kind === 'cart' ? '扣除車重後重量小於 0，請確認總重' : '重量請大於 0';
      return;
    }
    if (item.kind === 'box' && input.avgEggWeight > 0) {
      const perBox = calc.eggs / item.quantity;
      if (perBox < s.boxEggsMin || perBox > s.boxEggsMax) {
        itemWarnings[i] = `換算每箱約 ${Math.round(perBox)} 顆，超出 ${s.boxEggsMin}–${s.boxEggsMax}，請確認平均蛋重`;
      }
    }
    if (item.kind === 'cart') {
      const g = (calc.netCatty * CATTY_G) / calc.eggs;
      if (g < 40 || g > 75) itemWarnings[i] = `換算每顆約 ${g.toFixed(1)} g，請確認總重`;
    }
  });

  if (input.note.length > 500) errors.push('備註最多 500 字');
  return { errors, itemErrors, itemWarnings };
}

export const shipmentHasErrors = (v: ShipmentValidation) => v.errors.length > 0 || Object.keys(v.itemErrors).length > 0;

/** 當天各雞舍蛋重，以產蛋數加權平均 */
export function weightedEggWeight(records: { eggsTotal: number; avgEggWeight: number | null }[]): number | null {
  let eggs = 0;
  let sum = 0;
  for (const r of records) {
    if (r.avgEggWeight && r.eggsTotal > 0) {
      eggs += r.eggsTotal;
      sum += r.avgEggWeight * r.eggsTotal;
    }
  }
  return eggs > 0 ? round1(sum / eggs) : null;
}

export const shipmentSettingsOf = (farm: { shipmentSettings?: Partial<ShipmentSettings> }): ShipmentSettings => ({
  ...DEFAULT_SHIPMENT_SETTINGS,
  ...farm.shipmentSettings,
});
