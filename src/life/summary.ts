export type DaySummary = { todos: number; focus: number; agents: number; waterMl: number; goalMl: number; pending: number };

export function summaryParts(day: DaySummary) {
  return {
    ...day,
    waterPercent: day.goalMl > 0 ? Math.min(100, Math.round((day.waterMl / day.goalMl) * 100)) : 0,
    quiet: day.todos === 0 && day.focus === 0 && day.agents === 0,
  };
}
