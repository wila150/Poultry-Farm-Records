// 衍生數字一律從 dailyRecords 即時計算，不存進資料庫。

import type { DailyRecordInput } from './types';

type Counts = Pick<DailyRecordInput, 'birdCount' | 'deaths' | 'culls' | 'eggsTotal' | 'eggsBroken'>;

/** 產蛋率（%） */
export function layingRate(r: Pick<Counts, 'birdCount' | 'eggsTotal'>): number | null {
  return r.birdCount > 0 ? (r.eggsTotal / r.birdCount) * 100 : null;
}

/** 死淘率（%） */
export function mortalityRate(r: Pick<Counts, 'birdCount' | 'deaths' | 'culls'>): number | null {
  return r.birdCount > 0 ? ((r.deaths + r.culls) / r.birdCount) * 100 : null;
}

/** 破蛋率（%） */
export function brokenRate(r: Pick<Counts, 'eggsTotal' | 'eggsBroken'>): number | null {
  return r.eggsTotal > 0 ? (r.eggsBroken / r.eggsTotal) * 100 : null;
}

/** 隔天的在養隻數預填值 */
export function nextBirdCount(r: Pick<Counts, 'birdCount' | 'deaths' | 'culls'>): number {
  return Math.max(0, r.birdCount - r.deaths - r.culls);
}
