// The zones of a Zonal Admin as the shell receives them from /me (names and colours only). The top bar shows them in the
// zone scope switcher (ZoneSwitcher.tsx, M05).

export interface ShellZone {
  zoneId: string;
  name: string;
  code: string;
  colorHex: string;
  status: 'UPCOMING' | 'ACTIVE' | 'INACTIVE';
}

export function zoneChipLabel(zones: readonly ShellZone[]): string {
  if (zones.length === 0) return 'No zones';
  if (zones.length === 1) return zones[0]?.name ?? '';
  return `${zones.length} zones`;
}
