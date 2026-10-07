import QRCode from 'qrcode'
import JsBarcode from 'jsbarcode'
import type { LabelTemplate, Specimen } from '../types/label'
import {
  formatDate,
  labelInnerWidth,
  paginateSpecimens,
  safeFilePart,
  scientificFontScale,
} from './layout'

function download(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

async function barcodeMarkup(specimen: Specimen, mode: LabelTemplate['barcodeMode']) {
  if (mode === 'qr') {
    const dataUrl = await QRCode.toDataURL(specimen.accessionNo, {
      margin: 0,
      width: 160,
      color: { dark: '#111111', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
    return `<img class="mark" src="${dataUrl}" alt="">`
  }
  if (mode === 'code128') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    JsBarcode(svg, specimen.accessionNo, {
      format: 'CODE128',
      width: 1,
      height: 38,
      displayValue: false,
      margin: 0,
      background: '#ffffff',
      lineColor: '#111111',
    })
    svg.setAttribute('class', 'mark')
    return svg.outerHTML
  }
  return ''
}

export function exportTemplateConfig(template: LabelTemplate) {
  download(
    JSON.stringify(
      {
        schema: 'specimen-label-layout/v1',
        exportedAt: new Date().toISOString(),
        template,
        physicalUnit: 'mm',
      },
      null,
      2,
    ),
    `${safeFilePart(template.name)}-排版配置.json`,
    'application/json;charset=utf-8',
  )
}

export async function exportPrintableHtml(
  specimens: Specimen[],
  template: LabelTemplate,
) {
  const pages = paginateSpecimens(specimens, template)
  const labelWidth = labelInnerWidth(template)
  const rows = Array.from({ length: pages.length }, (_, pageIndex) =>
    pages[pageIndex].map((specimen) => {
      const scale = scientificFontScale(specimen.scientificName, template)
      const mark = ''
      return {
        pageIndex,
        html: `<article class="label">
          <div class="label__main">
            <div class="label__top"><strong>${escapeHtml(specimen.taxonName || '待鉴定类群')}</strong><span>${escapeHtml(specimen.accessionNo)}</span></div>
            <div class="scientific" style="font-size:${(template.fontSizePt * scale).toFixed(2)}pt;font-style:${template.italicScientific ? 'italic' : 'normal'}">${escapeHtml(specimen.scientificName || '学名待补')}</div>
            ${template.includeCollection ? `<div>${escapeHtml(specimen.locality || '采集地待补')}</div>` : ''}
            ${template.includeCollection ? `<div>${formatDate(specimen.collectedAt)} · ${escapeHtml(specimen.collector || '采集人待补')}${template.includeHabitat && specimen.habitat ? ` · ${escapeHtml(specimen.habitat)}` : ''}</div>` : ''}
            ${template.includeNotes && specimen.notes ? `<div>${escapeHtml(specimen.notes)}</div>` : ''}
          </div>
          <div class="mark-slot" data-code="${escapeHtml(specimen.accessionNo)}">${mark}</div>
        </article>`,
      }
    }),
  )
  const pageHtml = pages
    .map(
      (_, pageIndex) => `<section class="sheet">${rows[pageIndex].map((item) => item.html).join('')}</section>`,
    )
    .join('')
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(template.name)} - 可打印标签</title>
<style>
@page { size: ${template.paperWidthMm}mm ${template.paperHeightMm}mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #111; font-family: "Songti SC", "SimSun", serif; }
.sheet {
  display: grid;
  width: ${template.paperWidthMm}mm;
  height: ${template.paperHeightMm}mm;
  padding: ${template.marginTopMm}mm ${template.marginRightMm}mm ${template.marginBottomMm}mm ${template.marginLeftMm}mm;
  grid-template-columns: repeat(${template.columns}, ${labelWidth}mm);
  grid-auto-rows: ${template.rowHeightMm}mm;
  column-gap: ${template.columnGapMm}mm;
  row-gap: ${template.rowGapMm}mm;
  align-content: start;
  page-break-after: always;
  overflow: hidden;
}
.sheet:last-child { page-break-after: auto; }
.label {
  display: grid;
  position: relative;
  min-width: 0;
  min-height: 0;
  padding: 1.3mm 1.5mm;
  border: ${template.borderWidthMm}mm ${template.borderStyle} #222;
  grid-template-columns: minmax(0, 1fr) ${template.barcodeMode === 'none' ? '0' : '14mm'};
  gap: 1mm;
  overflow: hidden;
  font-size: ${template.fontSizePt}pt;
  line-height: ${template.lineHeightMm}mm;
}
.label__main { min-width: 0; overflow: hidden; }
.label__top { display: flex; justify-content: space-between; gap: .8mm; white-space: nowrap; }
.label__top strong { overflow: hidden; text-overflow: ellipsis; }
.label__top span { font-family: "Menlo", monospace; font-size: .78em; }
.scientific { font-family: "Times New Roman", serif; white-space: normal; overflow-wrap: anywhere; line-height: 3.5mm; }
.mark-slot { display: grid; place-items: center; min-width: 0; }
.mark { display: block; width: 100%; height: 15mm; object-fit: contain; }
</style>
</head>
<body>${pageHtml}</body>
</html>`

  const templateElement = document.createElement('template')
  templateElement.innerHTML = html
  const codeElements = Array.from(templateElement.content.querySelectorAll<HTMLElement>('.mark-slot'))
  for (const marker of codeElements) {
    marker.innerHTML = await barcodeMarkup(
      { accessionNo: marker.dataset.code || '' } as Specimen,
      template.barcodeMode,
    )
  }
  download(templateElement.innerHTML, `${safeFilePart(template.name)}-可打印.html`, 'text/html;charset=utf-8')
}
