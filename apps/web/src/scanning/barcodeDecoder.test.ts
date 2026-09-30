import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBarcodeDecoder } from './barcodeDecoder'
const decode = vi.hoisted(() => vi.fn())
vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: class {
    decode = decode
  },
}))
afterEach(() => {
  vi.unstubAllGlobals()
  decode.mockReset()
})
describe('barcode decoder selection', () => {
  it('uses a supported native EAN detector without the fallback', async () => {
    const detect = vi.fn().mockResolvedValue([{ rawValue: '9780141439518' }])
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        static getSupportedFormats = async () => ['ean_13']
        detect = detect
      },
    )
    const read = await createBarcodeDecoder()
    expect(await read(document.createElement('video'))).toEqual(['9780141439518'])
    expect(decode).not.toHaveBeenCalled()
  })
  it('falls back when the native API supports only QR codes', async () => {
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        static getSupportedFormats = async () => ['qr_code']
      },
    )
    decode.mockReturnValue({ getText: () => '9780141441146' })
    const read = await createBarcodeDecoder()
    expect(await read(document.createElement('video'))).toEqual(['9780141441146'])
  })
  it('treats ordinary empty frames as empty even with minified exception names', async () => {
    vi.stubGlobal('BarcodeDetector', undefined)
    decode.mockImplementation(() => {
      throw { name: 'a', getKind: () => 'NotFoundException' }
    })
    const read = await createBarcodeDecoder()
    expect(await read(document.createElement('video'))).toEqual([])
  })
  it('does not conceal unexpected decoder failures as empty observations', async () => {
    vi.stubGlobal('BarcodeDetector', undefined)
    decode.mockImplementation(() => {
      throw new Error('canvas failed')
    })
    const read = await createBarcodeDecoder()
    await expect(read(document.createElement('video'))).rejects.toThrow('canvas failed')
  })
})
