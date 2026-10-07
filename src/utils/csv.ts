import type { ImportResult, Specimen, ValidationIssue } from '../types/label'

const FIELD_ALIASES: Record<keyof Specimen | 'id', string[]> = {
  id: ['id', '记录id'],
  accessionNo: ['编号', '馆藏号', '标本号', 'accession', 'catalogno', 'catalog_no'],
  taxonName: ['类群', '分类', '中文名', '科名', 'taxon'],
  scientificName: ['学名', '拉丁名', 'scientificname', 'scientific_name', 'species'],
  locality: ['采集地', '产地', '地点', 'locality'],
  collectedAt: ['采集日期', '日期', '采集时间', 'date', 'collectedat'],
  collector: ['采集人', '采集者', 'collector'],
  habitat: ['生境', '栖息地', 'habitat'],
  notes: ['备注', '采集方式', 'notes', 'note'],
}

function parseCsvLine(line: string) {
  const values: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      values.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  values.push(current.trim())
  return values
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function resolveField(header: string): keyof Specimen | null {
  const normalized = normalizeHeader(header)
  const entry = Object.entries(FIELD_ALIASES).find(([, aliases]) =>
    aliases.some((alias) => normalizeHeader(alias) === normalized),
  )
  return entry ? (entry[0] as keyof Specimen) : null
}

export function validateSpecimens(specimens: Specimen[], existing = false): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const accessions = new Map<string, number>()
  specimens.forEach((specimen, index) => {
    const addIssue = (
      field: keyof Specimen,
      severity: ValidationIssue['severity'],
      message: string,
    ) => issues.push({
      id: `${existing ? 'existing' : 'import'}-${specimen.id}-${field}-${index}`,
      specimenId: specimen.id,
      field,
      severity,
      message,
    })

    if (!specimen.accessionNo.trim()) addIssue('accessionNo', 'error', '缺少标本编号')
    if (!specimen.scientificName.trim()) addIssue('scientificName', 'error', '缺少拉丁学名')
    if (!specimen.locality.trim()) addIssue('locality', 'error', '缺少采集地')
    if (!specimen.collectedAt.trim()) addIssue('collectedAt', 'error', '缺少采集日期')
    if (!specimen.collector.trim()) addIssue('collector', 'error', '缺少采集人')
    if (specimen.accessionNo.length > 24) addIssue('accessionNo', 'warning', '编号超过 24 个字符，标签上会缩小')
    if (specimen.scientificName.length > 42) addIssue('scientificName', 'warning', '学名超过 42 个字符，将自动换行并缩小')
    if (specimen.locality.length > 30) addIssue('locality', 'warning', '采集地超过 30 个字符，排版时会自动换行')
    if (specimen.collector.length > 12) addIssue('collector', 'warning', '采集人名称过长')

    if (specimen.accessionNo) {
      accessions.set(specimen.accessionNo, (accessions.get(specimen.accessionNo) || 0) + 1)
    }
  })
  accessions.forEach((count, accessionNo) => {
    if (count <= 1) return
    specimens
      .filter((specimen) => specimen.accessionNo === accessionNo)
      .forEach((specimen) =>
        issues.push({
          id: `duplicate-${specimen.id}`,
          specimenId: specimen.id,
          field: 'accessionNo',
          severity: 'error',
          message: `标本编号 ${accessionNo} 在清单中重复 ${count} 次`,
        }),
      )
  })
  return issues
}

export function parseSpecimenCsv(content: string): ImportResult {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 2) {
    return { specimens: [], issues: [], ignoredRows: 0 }
  }
  const headers = parseCsvLine(lines[0])
  const fieldMap = headers.map(resolveField)
  let ignoredRows = 0
  const specimens = lines.slice(1).flatMap((line, rowIndex) => {
    const values = parseCsvLine(line)
    const raw: Partial<Specimen> = {}
    fieldMap.forEach((field, columnIndex) => {
      if (!field) return
      raw[field] = values[columnIndex] || ''
    })
    if (!Object.values(raw).some(Boolean)) {
      ignoredRows += 1
      return []
    }
    const specimen: Specimen = {
      id: raw.id || `import-${Date.now()}-${rowIndex + 1}`,
      accessionNo: raw.accessionNo || '',
      taxonName: raw.taxonName || '',
      scientificName: raw.scientificName || '',
      locality: raw.locality || '',
      collectedAt: raw.collectedAt || '',
      collector: raw.collector || '',
      habitat: raw.habitat || '',
      notes: raw.notes || '',
    }
    return [specimen]
  })
  return {
    specimens,
    issues: validateSpecimens(specimens),
    ignoredRows,
  }
}
