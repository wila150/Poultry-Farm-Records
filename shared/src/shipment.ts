// 出貨單計算。前端即時顯示、後端存檔時再算一次，以後端結果為準。
// 重量單位是台斤；出貨單只記數量、重量、顆數，不記金額。
// 包裝方式（原料箱、蛋盤車…）在後台設定，每種由「重量怎麼算」＋「顆數怎麼算」組成。

export const CATTY_G = 600; // 1 台斤 = 600 g

/** fixed：每單位固定重量；gross：秤總重扣每單位空重；net：直接秤淨重 */
export type WeightMode = 'fixed' | 'gross' | 'net';
/** perUnit：每單位固定顆數；byWeight：淨重 ÷ 平均蛋重 */
export type EggMode = 'perUnit' | 'byWeight';

export interface PackageType {
  /** 系統產生，永不改變 */
  id: string;
  name: string;
  /** 數量單位，例如 箱、車、籃 */
  unit: string;
  weightMode: WeightMode;
  /** fixed：每單位台斤數 */
  unitCatty: number;
  /** gross：每單位要扣的空重（公斤） */
  tareKg: number;
  eggMode: EggMode;
  /** perUnit：每單位顆數 */
  eggsPerUnit: number;
  /** 每單位合理顆數，超出會提醒；0 表示不檢查 */
  eggsMin: number;
  eggsMax: number;
  active: boolean;
}

export interface ShipmentSettings {
  grades: string[];
  packages: PackageType[];
}

export const DEFAULT_PACKAGES: PackageType[] = [
  {
    id: 'box',
    name: '原料箱',
    unit: '箱',
    weightMode: 'fixed',
    unitCatty: 20,
    tareKg: 0,
    eggMode: 'byWeight',
    eggsPerUnit: 0,
    eggsMin: 180,
    eggsMax: 200,
    active: true,
  },
  {
    id: 'cart',
    name: '蛋盤車',
    unit: '車',
    weightMode: 'gross',
    unitCatty: 0,
    tareKg: 150,
    eggMode: 'perUnit',
    eggsPerUnit: 144 * 30,
    eggsMin: 0,
    eggsMax: 0,
    active: true,
  },
];

export const DEFAULT_SHIPMENT_SETTINGS: ShipmentSettings = {
  grades: ['原料蛋', '大', '中', '小'],
  packages: DEFAULT_PACKAGES,
};

/** 開單時輸入的品項 */
export interface ShipmentItemInput {
  packageId: string;
  grade: string;
  quantity: number;
  /** gross：總重；net：淨重（台斤）。fixed 由系統計算 */
  weightCatty: number;
}

export interface ShipmentItem extends ShipmentItemInput {
  /** 開單當時的包裝名稱與單位，之後改設定也不影響舊單 */
  packageName: string;
  unit: string;
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

export const findPackage = (s: ShipmentSettings, id: string) => s.packages.find((p) => p.id === id);

export const WEIGHT_MODE_LABEL: Record<WeightMode, string> = {
  fixed: '每單位固定重量',
  gross: '秤總重，扣每單位空重',
  net: '直接秤淨重',
};
export const EGG_MODE_LABEL: Record<EggMode, string> = {
  perUnit: '每單位固定顆數',
  byWeight: '用平均蛋重換算',
};

/** 這個包裝開單時要不要填重量 */
export const needsWeight = (p: PackageType) => p.weightMode !== 'fixed';

export function calcItem(input: ShipmentItemInput, avgEggWeight: number, s: ShipmentSettings): ShipmentItem {
  const p = findPackage(s, input.packageId);
  if (!p) return { ...input, packageName: '', unit: '', netCatty: 0, eggs: 0 };
  const weightCatty = p.weightMode === 'fixed' ? round1(input.quantity * p.unitCatty) : input.weightCatty;
  const tareCatty = p.weightMode === 'gross' ? (input.quantity * p.tareKg * 1000) / CATTY_G : 0;
  const netCatty = round1(weightCatty - tareCatty);
  const eggs =
    p.eggMode === 'perUnit'
      ? input.quantity * p.eggsPerUnit
      : avgEggWeight > 0
        ? Math.round((netCatty * CATTY_G) / avgEggWeight)
        : 0;
  return { ...input, weightCatty, packageName: p.name, unit: p.unit, netCatty, eggs };
}

export function calcShipment(input: Pick<ShipmentInput, 'items' | 'avgEggWeight'>, s: ShipmentSettings) {
  const items = input.items.map((i) => calcItem(i, input.avgEggWeight, s));
  // 填到一半的品項可能還不是數字，合計先略過
  const ok = (n: number) => (Number.isFinite(n) ? n : 0);
  return {
    items,
    totalEggs: items.reduce((t, i) => t + ok(i.eggs), 0),
    totalCatty: round1(items.reduce((t, i) => t + ok(i.netCatty), 0)),
  };
}

export interface ShipmentValidation {
  errors: string[];
  /** 依品項索引 */
  itemErrors: Record<number, string>;
  itemWarnings: Record<number, string>;
}

const validNum = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export function validateShipment(input: ShipmentInput, s: ShipmentSettings): ShipmentValidation {
  const errors: string[] = [];
  const itemErrors: Record<number, string> = {};
  const itemWarnings: Record<number, string> = {};

  if (!input.customerId) errors.push('請選擇客戶');
  if (input.items.length === 0) errors.push('請至少新增一個品項');
  const needsEggWeight = input.items.some((i) => findPackage(s, i.packageId)?.eggMode === 'byWeight');
  if (needsEggWeight && !(input.avgEggWeight > 0)) errors.push('請填平均蛋重');

  input.items.forEach((item, i) => {
    const p = findPackage(s, item.packageId);
    if (!p) itemErrors[i] = '請選擇包裝方式';
    else if (!item.grade) itemErrors[i] = '請選擇規格';
    else if (!Number.isInteger(item.quantity) || item.quantity <= 0) itemErrors[i] = `${p.unit}數請填正整數`;
    else if (needsWeight(p) && !validNum(item.weightCatty)) itemErrors[i] = p.weightMode === 'gross' ? '請填總重' : '請填淨重';
    if (itemErrors[i] || !p) return;

    const calc = calcItem(item, input.avgEggWeight, s);
    if (calc.netCatty <= 0) {
      itemErrors[i] = p.weightMode === 'gross' ? `扣除空重後重量小於 0，請確認總重` : '重量請大於 0';
      return;
    }
    if (calc.eggs > 0) {
      const perUnit = calc.eggs / item.quantity;
      if (p.eggsMin > 0 && p.eggsMax > 0 && (perUnit < p.eggsMin || perUnit > p.eggsMax)) {
        itemWarnings[i] = `換算每${p.unit}約 ${Math.round(perUnit)} 顆，超出 ${p.eggsMin}–${p.eggsMax}，請確認`;
      } else {
        const g = (calc.netCatty * CATTY_G) / calc.eggs;
        if (g < 40 || g > 75) itemWarnings[i] = `換算每顆約 ${g.toFixed(1)} g，請確認重量`;
      }
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

/** 舊版設定（boxCatty、cartTareKg…）沒有 packages 時，轉成預設的兩種包裝 */
type LegacySettings = Partial<ShipmentSettings> & {
  traysPerCart?: number;
  eggsPerTray?: number;
  cartTareKg?: number;
  boxCatty?: number;
  boxEggsMin?: number;
  boxEggsMax?: number;
};

export function shipmentSettingsOf(farm: { shipmentSettings?: LegacySettings }): ShipmentSettings {
  const s = farm.shipmentSettings ?? {};
  const grades = s.grades?.length ? s.grades : DEFAULT_SHIPMENT_SETTINGS.grades;
  if (s.packages?.length) return { grades, packages: s.packages };
  const [box, cart] = DEFAULT_PACKAGES;
  return {
    grades,
    packages: [
      { ...box, unitCatty: s.boxCatty ?? box.unitCatty, eggsMin: s.boxEggsMin ?? box.eggsMin, eggsMax: s.boxEggsMax ?? box.eggsMax },
      { ...cart, tareKg: s.cartTareKg ?? cart.tareKg, eggsPerUnit: (s.traysPerCart ?? 144) * (s.eggsPerTray ?? 30) },
    ],
  };
}

// 舊版出貨單的品項用 kind（box／cart）記錄，沒有 packageId、packageName
type AnyItem = Partial<ShipmentItem> & { kind?: 'box' | 'cart' };
const LEGACY = { box: { name: '原料箱', unit: '箱' }, cart: { name: '蛋盤車', unit: '車' } } as const;

export const itemPackageId = (i: AnyItem) => i.packageId ?? i.kind ?? '';
export const itemPackageName = (i: AnyItem) => i.packageName || (i.kind ? LEGACY[i.kind].name : '');
export const itemUnit = (i: AnyItem) => i.unit || (i.kind ? LEGACY[i.kind].unit : '');

/** 開單畫面重量欄的說明文字 */
export function weightHint(p: PackageType) {
  if (p.weightMode === 'fixed') return `每${p.unit} ${p.unitCatty} 台斤`;
  if (p.weightMode === 'gross') return `含空重的總重，每${p.unit}扣 ${p.tareKg} kg`;
  return '蛋的淨重';
}
