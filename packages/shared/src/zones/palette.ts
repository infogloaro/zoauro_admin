// Zone colours (doc 53 section 3): a fixed palette of 12 tokens, so chips and charts stay legible. zones.color_hex
// stores the hex (char(7), upper case). The values are the 600 shades of the Tailwind default palette, chosen in P5
// because no design document gives them (Assumed, doc 32): the designer may replace the hex values, not the count.

export const ZONE_PALETTE = [
  { token: 'red', hex: '#DC2626' },
  { token: 'orange', hex: '#EA580C' },
  { token: 'amber', hex: '#D97706' },
  { token: 'lime', hex: '#65A30D' },
  { token: 'green', hex: '#16A34A' },
  { token: 'emerald', hex: '#059669' },
  { token: 'teal', hex: '#0D9488' },
  { token: 'cyan', hex: '#0891B2' },
  { token: 'blue', hex: '#2563EB' },
  { token: 'indigo', hex: '#4F46E5' },
  { token: 'violet', hex: '#7C3AED' },
  { token: 'pink', hex: '#DB2777' },
] as const;

export type ZoneColorToken = (typeof ZONE_PALETTE)[number]['token'];
export type ZoneColorHex = (typeof ZONE_PALETTE)[number]['hex'];

export const ZONE_COLOR_HEXES = ZONE_PALETTE.map((c) => c.hex) as [ZoneColorHex, ...ZoneColorHex[]];
