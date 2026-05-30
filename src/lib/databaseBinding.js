export function resolveTemplateText(text, source = null) {
  if (!text || !source) return text;
  return String(text).replace(/\{\{(.*?)\}\}/g, (match, field) => {
    const key = field.trim();
    return source[key] !== undefined ? String(source[key]) : match;
  });
}

export function resolveDatabaseRecord({
  database = null,
  tableName = '',
  filterField = '',
  filterValue = '',
  templateSource = null,
  fallbackData = null,
}) {
  const rows = database?.data?.[tableName] || [];
  if (!tableName || rows.length === 0) return fallbackData || null;

  if (!filterField || filterValue === '' || filterValue === undefined || filterValue === null) {
    return rows[0] || null;
  }

  const resolvedValue = resolveTemplateText(filterValue, templateSource || fallbackData || {});
  const match = rows.find(row => String(row?.[filterField]) === String(resolvedValue));
  return match || null;
}

