export function fmtDateTimeRD(d: string | Date) {
    const dt = typeof d === 'string' ? new Date(d) : d
    return new Intl.DateTimeFormat('es-DO', {
      dateStyle: 'medium', timeStyle: 'short', hour12: true,
      timeZone: 'America/Santo_Domingo'
    }).format(dt)
  }
  
  export function renderTemplateBody(body: string, sample: Record<string,string>) {
    return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => sample[k] ?? '')
  }
  