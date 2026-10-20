// Optional local OCR. No network, model API, catalog access or book-identity inference.
import Foundation
import Vision
import ImageIO

do {
    guard CommandLine.arguments.count == 2 else { throw NSError(domain: "Input", code: 1) }
    let url = URL(fileURLWithPath: CommandLine.arguments[1])
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw NSError(domain: "Image", code: 2)
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]
    try VNImageRequestHandler(cgImage: image).perform([request])
    let observations = (request.results ?? []).sorted {
        if $0.boundingBox.midY != $1.boundingBox.midY {
            return $0.boundingBox.midY > $1.boundingBox.midY
        }
        return $0.boundingBox.minX < $1.boundingBox.minX
    }
    let lines: [[String: Any]] = observations.enumerated().compactMap { index, observation in
        guard let text = observation.topCandidates(1).first else { return nil }
        let b = observation.boundingBox
        let x = max(0, Int(floor(b.minX * Double(image.width))))
        let y = max(0, Int(floor((1 - b.maxY) * Double(image.height))))
        let right = min(image.width, Int(ceil(b.maxX * Double(image.width))))
        let bottom = min(image.height, Int(ceil((1 - b.minY) * Double(image.height))))
        return ["id": "vision_\(index + 1)", "text": text.string,
                "bbox": ["x": x, "y": y, "width": right - x, "height": bottom - y],
                "confidence": Double(text.confidence) * 100]
    }
    let output: [String: Any] = ["engine": "apple_vision", "revision": request.revision,
                                "osVersion": ProcessInfo.processInfo.operatingSystemVersionString,
                                "language": "en-US", "languageCorrection": false, "lines": lines]
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]))
} catch {
    // The caller retains a failed-page observation. Avoid leaking source text or paths in errors.
    FileHandle.standardError.write(Data("Local Vision OCR failed\n".utf8))
    exit(1)
}
