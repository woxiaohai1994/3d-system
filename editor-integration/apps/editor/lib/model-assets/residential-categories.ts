// Stable catalog IDs keep this curation separate from filename guesses and user overrides.
const groups: Record<string, string[]> = {
  architecture: ['column', 'pillar', 'fireplace-movn1fnn'],
  lighting: ['recessed-light', 'table-lamp', 'ceiling-lamp', 'floor-lamp'],
  decor: [
    'cactus',
    'small-indoor-plant',
    'indoor-plant',
    'books',
    'toy',
    'car-toy',
    'guitar',
    'piano',
    'easel',
    'picture',
    'rectangular-carpet',
    'round-mirror',
    'round-carpet',
    'trash-bin',
  ],
  landscape: ['bush', 'palm', 'fir-tree', 'tree'],
  streetscape: ['parking-spot', '1967-chevrolet-camaro-moa24wsf', 'scooter', 'tesla', 'hydrant'],
  kitchen: ['cabinet', 'toaster', 'kettle', 'coffee-machine', 'dishwasher-movn72ls'],
  bathroom: ['ironing-board', 'iron'],
  office: [
    'office-table',
    'office-chair',
    'standing-desk-mo8wgz95',
    'herman-miller-aeron-mo8x36k9',
  ],
}
const curated = new Map(
  Object.entries(groups).flatMap(([category, ids]) => ids.map((id) => [id, category] as const)),
)
export function residentialCategory(id: string, original: string) {
  return curated.get(id) ?? original
}
