import type { Specimen, LabelTemplate } from '../types/label'

const FAMILIES = [
  ['螽斯科', 'Tettigoniidae', 'Tettigonia'],
  ['蝗科', 'Acrididae', 'Acrida'],
  ['凤蝶科', 'Papilionidae', 'Papilio'],
  ['灰蝶科', 'Lycaenidae', 'Lycaena'],
  ['步甲科', 'Carabidae', 'Carabus'],
  ['锹甲科', 'Lucanidae', 'Lucanus'],
  ['天牛科', 'Cerambycidae', 'Aromia'],
  ['胡蜂科', 'Vespidae', 'Vespa'],
  ['蜜蜂科', 'Apidae', 'Xylocopa'],
  ['蜻科', 'Libellulidae', 'Sympetrum'],
  ['蟌科', 'Coenagrionidae', 'Ischnura'],
  ['蜣螂科', 'Scarabaeidae', 'Copris'],
]
const LOCALITIES = [
  '云南省勐腊县补蚌村',
  '四川省峨眉山清音阁',
  '浙江省天目山南坡',
  '福建省武夷山桐木关',
  '海南省尖峰岭三号样线',
  '湖北省神农架大九湖',
  '广西壮族自治区猫儿山',
  '陕西省太白山红桦坪',
]
const HABITATS = ['常绿阔叶林林缘', '溪流边灌丛', '针阔混交林', '人工草地', '高海拔草甸', '腐木堆']
const COLLECTORS = ['沈砚', '孟川', '赵禾', '郭清', '贺屿', '唐映', '程野']

export const DEFAULT_TEMPLATE: LabelTemplate = {
  id: 'template-standard-a4',
  name: '馆藏标准标签 · A4 四栏',
  paperWidthMm: 210,
  paperHeightMm: 297,
  marginTopMm: 10,
  marginRightMm: 10,
  marginBottomMm: 10,
  marginLeftMm: 10,
  columns: 4,
  rowHeightMm: 25,
  columnGapMm: 2,
  rowGapMm: 2,
  lineHeightMm: 4.2,
  fontSizePt: 7,
  borderWidthMm: 0.2,
  borderStyle: 'solid',
  italicScientific: true,
  barcodeMode: 'qr',
  includeCollection: true,
  includeHabitat: false,
  includeNotes: false,
  updatedAt: new Date().toISOString(),
}

export function createMockSpecimens(count = 64): Specimen[] {
  return Array.from({ length: count }, (_, index) => {
    const family = FAMILIES[index % FAMILIES.length]
    const speciesSuffix = ['sinensis', 'chinensis', 'yunnanensis', 'magnifica', 'aureus', 'formosana'][index % 6]
    const genus = family[2]
    const scientificName = `${genus} ${speciesSuffix} ${index % 4 === 0 ? 'Walker, 1869' : ''}`.trim()
    return {
      id: `specimen-${String(index + 1).padStart(4, '0')}`,
      accessionNo: `INS-${2021 + (index % 5)}-${String(1078 + index * 13).padStart(5, '0')}`,
      taxonName: `${family[0]}${index % 3 === 0 ? '·待复核' : ''}`,
      scientificName,
      locality: LOCALITIES[(index * 3) % LOCALITIES.length],
      collectedAt: `${2021 + (index % 5)}-${String((index * 5) % 12 + 1).padStart(2, '0')}-${String((index * 3) % 27 + 1).padStart(2, '0')}`,
      collector: COLLECTORS[(index * 7) % COLLECTORS.length],
      habitat: HABITATS[(index * 5) % HABITATS.length],
      notes: index % 11 === 0 ? '灯光诱集' : index % 17 === 0 ? '马来氏网' : '',
    }
  })
}

export const SAMPLE_CSV = `编号,学名,采集地,采集日期,采集人,生境
INS-2026-02001,Papilio memnon Linnaeus 1758,云南省勐腊县补蚌村,2026-04-12,沈砚,常绿阔叶林林缘
INS-2026-02002,Carabus elysii Thomson,四川省峨眉山清音阁,2026-05-03,孟川,针阔混交林
INS-2026-02003,,浙江省天目山南坡,2026-05-18,赵禾,溪流边灌丛
INS-2026-02004,Lucanus parryi Boileau,福建省武夷山桐木关,2026-06-01,郭清,常绿阔叶林林缘
INS-2026-02005,Sympetrum darwinianum Selys,海南省尖峰岭三号样线,2026-06-11,贺屿,高海拔草甸`
