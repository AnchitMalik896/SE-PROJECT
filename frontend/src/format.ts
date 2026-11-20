export function money(paise: number): string {
  const rupees = paise / 100;
  return '₹' + rupees.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2, maximumFractionDigits: 2 });
}

export function toPaise(input: string | number): number | null {
  const n = typeof input === 'number' ? input : Number(String(input).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export const fromPaise = (paise: number) => String(paise / 100);

export function dateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
export function dateOnly(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function timeAgo(iso: string | Date): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const label = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const EMOJI: Record<string, string> = {
  vegetables: '🥬',
  fruits: '🍊',
  'grains & pulses': '🌾',
  dairy: '🥛',
  'honey & preserves': '🍯',
};
export const emojiFor = (categoryName?: string | null) => EMOJI[(categoryName ?? '').toLowerCase()] ?? '🧺';

export function mapsDirections(origin: string, destination: string) {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}
export const mapsPoint = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;
