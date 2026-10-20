// Self-authored synthetic pages only. Not a published-book OCR benchmark.
import AppKit
import Foundation

struct Page: Decodable { let id: String; let lines: [String] }
struct Frame: Decodable { let pages: [Page] }
do {
    guard CommandLine.arguments.count == 3 else { throw NSError(domain: "Input", code: 1) }
    let frame = try JSONDecoder().decode(Frame.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
    let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
    for page in frame.pages {
        let width = 1200, height = 800
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: width * 4, bitsPerPixel: 32),
              let context = NSGraphicsContext(bitmapImageRep: bitmap) else { throw NSError(domain: "Render", code: 2) }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        NSColor.white.setFill(); NSRect(x: 0, y: 0, width: width, height: height).fill()
        for (i, line) in page.lines.enumerated() {
            let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 38), .foregroundColor: NSColor.black]
            (line as NSString).draw(in: NSRect(x: 80, y: height - 160 - i * 120, width: 1040, height: 80), withAttributes: attributes)
        }
        NSGraphicsContext.restoreGraphicsState()
        guard let data = bitmap.representation(using: .png, properties: [:]) else { throw NSError(domain: "PNG", code: 3) }
        // AppKit adds eXIf even to freshly rendered pixels. Remove it before freezing the fixture;
        // the production adapter deliberately rejects orientation-bearing page files.
        let bytes = [UInt8](data)
        var normalized = data.prefix(8), offset = 8
        while offset + 12 <= bytes.count {
            let count = Int(bytes[offset]) << 24 | Int(bytes[offset + 1]) << 16 | Int(bytes[offset + 2]) << 8 | Int(bytes[offset + 3])
            let end = offset + count + 12
            guard end <= bytes.count else { throw NSError(domain: "PNG", code: 4) }
            let type = String(bytes: bytes[(offset + 4)..<(offset + 8)], encoding: .ascii)
            if type != "eXIf" { normalized.append(data[offset..<end]) }
            offset = end
        }
        try normalized.write(to: output.appendingPathComponent(page.id + ".png"), options: .withoutOverwriting)
    }
} catch {
    FileHandle.standardError.write(Data("Synthetic page rendering failed\n".utf8)); exit(1)
}
