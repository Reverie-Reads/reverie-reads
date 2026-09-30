export type FrameDecoder = (video: HTMLVideoElement) => Promise<string[]>
type NativeDetector = {
  new (options: { formats: string[] }): {
    detect(video: HTMLVideoElement): Promise<{ rawValue: string }[]>
  }
  getSupportedFormats?: () => Promise<string[]>
}

/** Packaged locally and lazy-loaded; no CDN script, image upload or provider request. */
export async function createBarcodeDecoder(): Promise<FrameDecoder> {
  const Detector = (window as Window & { BarcodeDetector?: NativeDetector }).BarcodeDetector
  if (Detector) {
    try {
      const formats = Detector.getSupportedFormats
        ? await Detector.getSupportedFormats()
        : ['ean_13']
      if (formats.includes('ean_13')) {
        const native = new Detector({ formats: ['ean_13'] })
        return async (video) => (await native.detect(video)).map((code) => code.rawValue)
      }
    } catch {
      /* A present but unusable native API must still allow the JS decoder. */
    }
  }
  const { BrowserMultiFormatReader } = await import('@zxing/browser')
  const reader = new BrowserMultiFormatReader()
  return async (video) => {
    try {
      return [reader.decode(video).getText()]
    } catch (error) {
      // Empty, blurred and incomplete frames are routine observations, not camera failures.
      const exception = error as Error & { getKind?: () => string }
      const kind = exception.getKind?.() ?? exception.name
      if (['NotFoundException', 'ChecksumException', 'FormatException'].includes(kind)) return []
      throw error
    }
  }
}
