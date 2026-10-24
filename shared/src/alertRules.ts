// 警報規則預設值，部署時寫入 alertRules 集合，之後由後台調整。
// 規則引擎在 Phase 3 實作。

export const DEFAULT_ALERT_RULES = {
  heat_stress: {
    enabled: true,
    params: { consecutiveDays: 3, tempMaxAbove: 33 },
  },
  laying_drop: {
    enabled: true,
    // 當日產蛋率比前 N 日平均低多少「百分點」
    params: { baselineDays: 7, dropPoints: 5 },
  },
  mortality_spike: {
    enabled: true,
    params: { baselineDays: 7, multiplier: 3, minDeaths: 5 },
  },
  water_drop: {
    enabled: true,
    params: { baselineDays: 7, dropPercent: 20 },
  },
} as const;

export type AlertRuleCode = keyof typeof DEFAULT_ALERT_RULES;
