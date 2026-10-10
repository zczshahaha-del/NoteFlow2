const chinaTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", hourCycle: "h23", hour: "numeric", minute: "2-digit",
  second: "2-digit", year: "numeric", month: "2-digit", day: "2-digit",
});
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/;
const explicitZone = /(?:Z|[+-]\d{2}:\d{2})$/;

export function formatChatMessageTime(value?: string | null): {
  label: string; full: string; dateTime: string;
} | null {
  const raw = value?.trim();
  if (!raw || !isoTimestamp.test(raw)) return null;
  // Legacy chat APIs serialized naive UTC without an offset; never treat it as local time.
  const dateTime = explicitZone.test(raw) ? raw : `${raw}Z`;
  const date = new Date(dateTime);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = chinaTime.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)!.value;
  const label = `${Number(part("hour"))}:${part("minute")}`;
  return {
    label, dateTime,
    full: `${part("year")}-${part("month")}-${part("day")} ${label}:${part("second")}（中国时间）`,
  };
}
