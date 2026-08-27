const textEntities: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
}

const attributeEntities: Readonly<Record<string, string>> = {
  ...textEntities,
  '"': '&quot;',
  "'": '&#39;',
}

function replaceEntities(value: string, entities: Readonly<Record<string, string>>, pattern: RegExp): string {
  return value.replace(pattern, (character) => entities[character]!)
}

export function escapeText(value: string): string {
  return replaceEntities(value, textEntities, /[&<>]/g)
}

export function escapeAttribute(value: string): string {
  return replaceEntities(value, attributeEntities, /[&<>"']/g)
}
