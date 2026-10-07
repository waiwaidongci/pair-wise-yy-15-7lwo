/// <reference types="vite/client" />

declare module 'jsbarcode' {
  interface JsBarcodeOptions {
    format?: string
    width?: number
    height?: number
    displayValue?: boolean
    margin?: number
    background?: string
    lineColor?: string
    font?: string
    fontSize?: number
    textMargin?: number
  }
  function JsBarcode(
    element: SVGElement | HTMLCanvasElement | string,
    data: string,
    options?: JsBarcodeOptions,
  ): void
  export default JsBarcode
}
