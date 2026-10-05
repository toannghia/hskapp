// OCR các trang PDF scan bằng Vision (có sẵn trên macOS), xuất mỗi trang một tệp JSON
// gồm từng dòng chữ kèm toạ độ, để các bước sau dựng lại bảng từ vựng theo cột.
// Dùng: ocr <pdf> <thư mục ra> <trang đầu> <trang cuối> <ngôn ngữ, vd zh-Hans,en-US> [--jpg]
import AppKit
import PDFKit
import Vision

let a = CommandLine.arguments
guard a.count >= 6, let doc = PDFDocument(url: URL(fileURLWithPath: a[1])) else {
  print("usage: ocr <pdf> <outdir> <from> <to> <langs> [--jpg]"); exit(1)
}
let out = a[2], from = Int(a[3])!, to = min(Int(a[4])!, doc.pageCount)
let langs = a[5].split(separator: ",").map(String.init)
let saveJpg = a.contains("--jpg")
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)

func render(_ page: PDFPage, width: CGFloat) -> CGImage {
  let box = page.bounds(for: .mediaBox)
  let s = width / box.width
  let w = Int(box.width * s), h = Int(box.height * s)
  let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpaceCreateDeviceRGB(),
                      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.scaleBy(x: s, y: s)
  page.draw(with: .mediaBox, to: ctx)
  return ctx.makeImage()!
}

for n in from...to {
  autoreleasepool {
    guard let page = doc.page(at: n - 1) else { return }
    let img = render(page, width: 2200)
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.recognitionLanguages = langs
    req.usesLanguageCorrection = true
    try? VNImageRequestHandler(cgImage: img).perform([req])
    var lines: [[String: Any]] = []
    for o in req.results ?? [] {
      guard let c = o.topCandidates(1).first else { continue }
      let b = o.boundingBox  // gốc toạ độ ở góc dưới trái, đổi sang góc trên trái
      lines.append(["t": c.string, "x": (b.minX * 1000).rounded() / 1000,
                    "y": ((1 - b.maxY) * 1000).rounded() / 1000,
                    "w": (b.width * 1000).rounded() / 1000,
                    "h": (b.height * 1000).rounded() / 1000,
                    "c": (Double(c.confidence) * 100).rounded() / 100])
    }
    let name = String(format: "p%03d", n)
    let data = try! JSONSerialization.data(withJSONObject: ["page": n, "lines": lines], options: [.sortedKeys])
    try! data.write(to: URL(fileURLWithPath: "\(out)/\(name).json"))
    if saveJpg {
      let rep = NSBitmapImageRep(cgImage: img)
      try? rep.representation(using: .jpeg, properties: [.compressionFactor: 0.6])!
        .write(to: URL(fileURLWithPath: "\(out)/\(name).jpg"))
    }
    print(name, lines.count)
  }
}
