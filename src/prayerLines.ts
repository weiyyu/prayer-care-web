export function splitPrayerLines(value: string): string[] {
  return value.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean)
}
