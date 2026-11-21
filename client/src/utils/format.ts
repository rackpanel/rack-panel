export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  const val = bytes / Math.pow(k, i);
  return `${val.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
}

export function formatBps(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
  return `${formatBytes(bytesPerSec, 1)}/s`;
}

export function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '0m';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function formatTemp(tempC: number | null, unit: 'C' | 'F' = 'C'): string {
  if (tempC === null || typeof tempC !== 'number' || isNaN(tempC)) return '--';
  if (unit === 'F') {
    return `${Math.round(((tempC * 9) / 5 + 32) * 10) / 10}°F`;
  }
  return `${Math.round(tempC * 10) / 10}°C`;
}

export function formatRelativeTime(timestampMs: number): string {
  if (!timestampMs) return '-';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function metricTone(percent: number): 'ok' | 'warn' | 'crit' {
  if (percent >= 88) return 'crit';
  if (percent >= 72) return 'warn';
  return 'ok';
}
