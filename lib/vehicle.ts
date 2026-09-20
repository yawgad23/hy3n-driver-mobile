export const VEHICLE_COLOURS: Record<string, { name: string; hex: string }> = {
  black: { name: 'Black', hex: '#1A1A1A' },
  white: { name: 'White', hex: '#F5F5F5' },
  silver: { name: 'Silver', hex: '#C0C0C0' },
  grey: { name: 'Grey', hex: '#808080' },
  gray: { name: 'Grey', hex: '#808080' },
  red: { name: 'Red', hex: '#CE1126' },
  blue: { name: 'Blue', hex: '#1D4ED8' },
  green: { name: 'Green', hex: '#006B3F' },
  gold: { name: 'Gold', hex: '#D4AF37' },
  brown: { name: 'Brown', hex: '#92400E' },
  orange: { name: 'Orange', hex: '#EA580C' },
  maroon: { name: 'Maroon', hex: '#7F1D1D' },
  yellow: { name: 'Yellow', hex: '#FBBF24' },
};

export function normalizeVehicleColour(value?: string) {
  const raw = String(value || '').trim();
  const match = VEHICLE_COLOURS[raw.toLowerCase()];
  if (match) return match;
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return { name: raw, hex: raw };
  return { name: raw || 'Not specified', hex: '#808080' };
}

export function buildVehicleFields(input: {
  make?: string;
  model?: string;
  plate?: string;
  colour?: string;
  year?: string;
}) {
  const colour = normalizeVehicleColour(input.colour);
  return {
    vehicle_make: String(input.make || '').trim(),
    vehicle_model: String(input.model || '').trim(),
    vehicle_plate: String(input.plate || '').trim().toUpperCase(),
    license_plate: String(input.plate || '').trim().toUpperCase(),
    vehicle_color: colour.name,
    vehicle_colour: colour.name,
    vehicle_colour_hex: colour.hex,
    vehicle_full_model: String(input.year || '').trim(),
  };
}
