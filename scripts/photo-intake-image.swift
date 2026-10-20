// Private local decoding/normalization only. No URLs, network, model or database access.
import Foundation
import ImageIO
import CoreGraphics
import Vision
import UniformTypeIdentifiers

do {
    guard [3, 5].contains(CommandLine.arguments.count) else { throw NSError(domain: "Input", code: 1) }
    let input = URL(fileURLWithPath: CommandLine.arguments[1])
    let output = URL(fileURLWithPath: CommandLine.arguments[2])
    guard let source = CGImageSourceCreateWithURL(input as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
          CGImageSourceGetCount(source) == 1,
          let type = CGImageSourceGetType(source) as String?,
          ["public.jpeg", "public.png", "public.heic"].contains(type),
          let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = props[kCGImagePropertyPixelWidth] as? Int,
          let height = props[kCGImagePropertyPixelHeight] as? Int,
          width > 0, height > 0, width <= 12000, height <= 12000, width * height <= 16000000 else {
        throw NSError(domain: "BoundedImage", code: 2)
    }
    let orientation = (props[kCGImagePropertyOrientation] as? Int) ?? 1
    guard (1...8).contains(orientation) else { throw NSError(domain: "Orientation", code: 3) }
    // ImageIO applies all eight EXIF orientations, including mirrors, with no upscaling.
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: max(width, height),
        kCGImageSourceShouldCacheImmediately: true
    ] as CFDictionary) else { throw NSError(domain: "Decode", code: 4) }
    // Redraw into a fresh sRGB buffer. No EXIF, GPS, captions or original metadata are copied.
    guard let color = CGColorSpace(name: CGColorSpace.sRGB),
          let context = CGContext(data: nil, width: image.width, height: image.height,
            bitsPerComponent: 8, bytesPerRow: 0, space: color,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        throw NSError(domain: "Buffer", code: 5)
    }
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    guard let clean = context.makeImage(),
          let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        throw NSError(domain: "Output", code: 6)
    }
    CGImageDestinationAddImage(destination, clean, nil)
    guard CGImageDestinationFinalize(destination) else { throw NSError(domain: "Output", code: 7) }
    if CommandLine.arguments.count == 5 {
        guard let values = try JSONSerialization.jsonObject(with: Data(CommandLine.arguments[3].utf8)) as? [String: Int],
              Set(values.keys) == Set(["x", "y", "width", "height"]),
              let x = values["x"], let y = values["y"], let w = values["width"], let h = values["height"],
              x >= 0, y >= 0, w > 0, h > 0, x <= clean.width - w, y <= clean.height - h,
              let cropped = clean.cropping(to: CGRect(x: x, y: y, width: w, height: h)),
              let cropOut = CGImageDestinationCreateWithURL(URL(fileURLWithPath: CommandLine.arguments[4]) as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            throw NSError(domain: "Crop", code: 8)
        }
        CGImageDestinationAddImage(cropOut, cropped, nil)
        guard CGImageDestinationFinalize(cropOut) else { throw NSError(domain: "Crop", code: 9) }
    }
    let rectangles = VNDetectRectanglesRequest()
    rectangles.maximumObservations = 12
    rectangles.minimumConfidence = 0.4
    rectangles.minimumAspectRatio = 0.05
    let barcodes = VNDetectBarcodesRequest()
    barcodes.symbologies = [.ean13]
    var rectangleStatus = "complete", barcodeStatus = "complete"
    do { try VNImageRequestHandler(cgImage: clean).perform([rectangles]) } catch { rectangleStatus = "failed" }
    do { try VNImageRequestHandler(cgImage: clean).perform([barcodes]) } catch { barcodeStatus = "failed" }
    func box(_ b: CGRect) -> [String: Int] {
        let x = max(0, Int(floor(b.minX * Double(clean.width))))
        let y = max(0, Int(floor((1 - b.maxY) * Double(clean.height))))
        return ["x": x, "y": y,
          "width": min(clean.width, Int(ceil(b.maxX * Double(clean.width)))) - x,
          "height": min(clean.height, Int(ceil((1 - b.minY) * Double(clean.height)))) - y]
    }
    let receipt: [String: Any] = ["version": 1, "engine": "apple_imageio_vision",
      "osVersion": ProcessInfo.processInfo.operatingSystemVersionString,
      "encodedWidth": width, "encodedHeight": height, "orientation": orientation,
      "width": clean.width, "height": clean.height, "type": type,
      "rectangleRevision": rectangles.revision, "rectangleStatus": rectangleStatus,
      "barcodeRevision": barcodes.revision, "barcodeStatus": barcodeStatus,
      "regions": (rectangles.results ?? []).map { ["bbox": box($0.boundingBox), "confidence": Double($0.confidence)] as [String: Any] },
      "barcodes": (barcodes.results ?? []).compactMap { o -> [String: Any]? in
          guard let value = o.payloadStringValue else { return nil }
          return ["value": value, "bbox": box(o.boundingBox)]
      }]
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]))
} catch {
    FileHandle.standardError.write(Data("Bounded local photo normalization failed\n".utf8))
    exit(1)
}
