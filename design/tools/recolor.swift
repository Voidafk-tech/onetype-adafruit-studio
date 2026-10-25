// recolor <in> <out> <markDark> <markLight> <wordDark> <wordLight> [crop:mark|full]
// Pass "original" as markDark to keep the source colours (background removed, edges cleaned).
// Cuts the logo from its dark background and repaints it, keeping the mark's shading.
import Foundation
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers

func hex(_ s: String) -> (Double, Double, Double) {
  let v = Int(s.dropFirst(s.hasPrefix("#") ? 1 : 0), radix: 16)!
  return (Double((v >> 16) & 255) / 255, Double((v >> 8) & 255) / 255, Double(v & 255) / 255)
}
let a = CommandLine.arguments
let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: a[1]) as CFURL, nil)!
let img = CGImageSourceCreateImageAtIndex(src, 0, nil)!
let w = img.width, h = img.height
var px = [UInt8](repeating: 0, count: w * h * 4)
let cs = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
let keepOriginal = a[3] == "original"
let markDark = keepOriginal ? (0.0, 0.0, 0.0) : hex(a[3]), markLight = keepOriginal ? (0.0, 0.0, 0.0) : hex(a[4])
let wordDark = keepOriginal ? (0.0, 0.0, 0.0) : hex(a[5]), wordLight = keepOriginal ? (0.0, 0.0, 0.0) : hex(a[6])
// Background colour, sampled from the top-left corner, for edge clean-up.
let bg = (Double(px[0]) / 255, Double(px[1]) / 255, Double(px[2]) / 255)
let markEnd = 280   // x where the folded "1" ends and the wordmark starts
let lo = 0.47, hi = 0.68
func smooth(_ x: Double) -> Double { let t = min(1, max(0, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t) }
// Shading range of the mark, for normalising its light and shadow.
var lmin = 1.0, lmax = 0.0
for y in 0..<h { for x in 0..<markEnd { let i = (y * w + x) * 4
  let r = Double(px[i]) / 255, g = Double(px[i+1]) / 255, b = Double(px[i+2]) / 255
  if smooth(max(r, g, b)) > 0.95 { let l = 0.3 * r + 0.59 * g + 0.11 * b; lmin = min(lmin, l); lmax = max(lmax, l) } } }
var out = [UInt8](repeating: 0, count: w * h * 4)
for y in 0..<h { for x in 0..<w { let i = (y * w + x) * 4
  let r = Double(px[i]) / 255, g = Double(px[i+1]) / 255, b = Double(px[i+2]) / 255
  var alpha = smooth(max(r, g, b))
  if x > 860 && y < 95 { alpha = 0 }                       // sparkles above the "pe"
  if alpha <= 0 { continue }
  let c: (Double, Double, Double)
  if keepOriginal {
    // Remove the background's contribution from anti-aliased edge pixels so no navy fringe remains.
    let k = max(alpha, 0.05)
    c = (min(1, max(0, (r - (1 - k) * bg.0) / k)), min(1, max(0, (g - (1 - k) * bg.1) / k)), min(1, max(0, (b - (1 - k) * bg.2) / k)))
  } else if x < markEnd {
    let t = pow(min(1, max(0, (0.3 * r + 0.59 * g + 0.11 * b - lmin) / max(0.01, lmax - lmin))), 0.9)
    c = (markDark.0 + (markLight.0 - markDark.0) * t, markDark.1 + (markLight.1 - markDark.1) * t, markDark.2 + (markLight.2 - markDark.2) * t)
  } else {
    // Wordmark: solid colour, with the tail of the original gradient as a gentle shift.
    let t = Double(x - markEnd) / Double(w - markEnd)
    c = (wordDark.0 + (wordLight.0 - wordDark.0) * t, wordDark.1 + (wordLight.1 - wordDark.1) * t, wordDark.2 + (wordLight.2 - wordDark.2) * t)
  }
  out[i] = UInt8(c.0 * alpha * 255); out[i+1] = UInt8(c.1 * alpha * 255); out[i+2] = UInt8(c.2 * alpha * 255); out[i+3] = UInt8(alpha * 255)
} }
// Trim to content (optionally the mark only).
let maxX = a.count > 7 && a[7] == "mark" ? markEnd : w
var x0 = w, y0 = h, x1 = 0, y1 = 0
for y in 0..<h { for x in 0..<maxX where out[(y * w + x) * 4 + 3] > 8 { x0 = min(x0, x); x1 = max(x1, x); y0 = min(y0, y); y1 = max(y1, y) } }
let full = CGContext(data: &out, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!.makeImage()!
let pad = 4
let crop = full.cropping(to: CGRect(x: max(0, x0 - pad), y: max(0, y0 - pad), width: min(w, x1 + pad) - max(0, x0 - pad), height: min(h, y1 + pad) - max(0, y0 - pad)))!
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, crop, nil)
CGImageDestinationFinalize(dest)
print("wrote \(a[2]) \(crop.width)x\(crop.height) shading \(lmin)-\(lmax)")
