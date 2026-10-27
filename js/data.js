export const CATEGORIES = [
  { id: 'coin', label: 'Moneta' },
  { id: 'ammo', label: 'Amunicja' },
  { id: 'weapon', label: 'Broń i części' },
  { id: 'uniform', label: 'Mundur i oporządzenie' },
  { id: 'tool', label: 'Narzędzia i przedmioty' },
  { id: 'jewel', label: 'Ozdoby i biżuteria' },
  { id: 'other', label: 'Inne' }
];

export const SOILS = [
  'piasek',
  'glina',
  'torf / mokradło',
  'ściółka leśna',
  'ziemia orna',
  'żwir / kamienie',
  'inne'
];

export function catLabel(id) {
  return (CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1]).label;
}

export function isCat(id) {
  return CATEGORIES.some((c) => c.id === id);
}
