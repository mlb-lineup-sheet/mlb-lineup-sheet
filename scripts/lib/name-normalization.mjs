export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u02bc']/g, '')
    .replace(/[.]/g, '')
    .replace(/[-\u2010-\u2015]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function matchingKey(name, birthDate) {
  return `${normalizeName(name)}|${birthDate ?? ''}`;
}

