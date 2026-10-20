// Self-authored synthetic color geometry and text. No book content or real photographs.
import AppKit
import ImageIO
import UniformTypeIdentifiers

do {
    let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let width = 1200, height = 800
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
      bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
      colorSpaceName: .deviceRGB, bytesPerRow: width * 4, bitsPerPixel: 32),
      let context = NSGraphicsContext(bitmapImageRep: bitmap) else { throw NSError(domain: "Fixture", code: 1) }
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
    NSColor.white.setFill(); NSRect(x:0,y:0,width:width,height:height).fill()
    for (color, x, y) in [(NSColor.red,0,700),(NSColor.green,1100,700),(NSColor.blue,0,0),(NSColor.yellow,1100,0)] {
        color.setFill(); NSRect(x:x,y:y,width:100,height:100).fill()
    }
    for (i, text) in ["The Quiet Lantern", "By Avery Reader", "ISBN 9780306406157"].enumerated() {
        (text as NSString).draw(in:NSRect(x:150,y:600-i*120,width:900,height:90), withAttributes:[
          .font:NSFont.systemFont(ofSize:38), .foregroundColor:NSColor.black])
    }
    NSGraphicsContext.restoreGraphicsState()
    guard let image = bitmap.cgImage else { throw NSError(domain:"Fixture",code:2) }
    for orientation in 1...8 {
        guard let dest = CGImageDestinationCreateWithURL(output.appendingPathComponent("o\(orientation).jpg") as CFURL, UTType.jpeg.identifier as CFString,1,nil) else { throw NSError(domain:"Fixture",code:3) }
        CGImageDestinationAddImage(dest,image,[kCGImagePropertyOrientation:orientation,
          kCGImageDestinationLossyCompressionQuality:1.0,
          kCGImagePropertyGPSDictionary:[kCGImagePropertyGPSLatitude:32.2,kCGImagePropertyGPSLatitudeRef:"N"]] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { throw NSError(domain:"Fixture",code:4) }
    }
    for (name, type) in [("page.png",UTType.png),("page.heic",UTType.heic)] {
        guard let dest = CGImageDestinationCreateWithURL(output.appendingPathComponent(name) as CFURL,type.identifier as CFString,1,nil) else { throw NSError(domain:"Fixture",code:5) }
        CGImageDestinationAddImage(dest,image,nil)
        guard CGImageDestinationFinalize(dest) else { throw NSError(domain:"Fixture",code:6) }
    }
} catch { FileHandle.standardError.write(Data("Synthetic photo fixture failed\n".utf8)); exit(1) }
