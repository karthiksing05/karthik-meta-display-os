import AppKit

/// The ClaudeProd mark, the same as the glasses web app's icon (glasses/public/icon-512.png):
/// a Monokai asterisk (pink, orange, green and cyan bars) with a white centre.
/// One drawing routine makes both the app icon and the menu bar icon.
enum Icon {
    static func rgb(_ hex: UInt32) -> NSColor {
        NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
    static let bg = rgb(0x272822)
    static let ink = rgb(0xF8F8F2)
    /// Bars in drawing order: (angle in degrees, colour).
    static let bars: [(CGFloat, NSColor)] = [(90, rgb(0xFF6188)), (0, rgb(0xFD971F)), (-45, rgb(0xA6E22E)), (45, rgb(0x66D9EF))]

    /// Draws the asterisk centred in square `r`. `length`/`thickness` are fractions of the square.
    /// `lit` = colours; otherwise every bar uses `dim` (menu bar, relay stopped).
    static func drawLogo(in r: NSRect, length: CGFloat, thickness: CGFloat, dot: CGFloat, center: NSColor, lit: Bool, dim: NSColor) {
        let c = NSPoint(x: r.midX, y: r.midY)
        let len = length * r.width, th = thickness * r.width
        for (angle, color) in bars {
            (lit ? color : dim).setFill()
            let bar = NSBezierPath(rect: NSRect(x: -len / 2, y: -th / 2, width: len, height: th))
            var t = AffineTransform(translationByX: c.x, byY: c.y)
            t.rotate(byDegrees: angle)
            bar.transform(using: t)
            bar.fill()
        }
        center.setFill()
        let d = dot * r.width
        NSBezierPath(ovalIn: NSRect(x: c.x - d / 2, y: c.y - d / 2, width: d, height: d)).fill()
    }

    /// The app icon (Dock / Finder / Launchpad): the logo on a dark rounded square (macOS icon grid).
    static func appIcon(size: CGFloat) -> NSImage {
        NSImage(size: NSSize(width: size, height: size), flipped: false) { full in
            let inset = full.width * 100 / 1024
            let box = full.insetBy(dx: inset, dy: inset)
            let radius = box.width * 0.2237
            let shape = NSBezierPath(roundedRect: box, xRadius: radius, yRadius: radius)

            NSGraphicsContext.saveGraphicsState()
            let shadow = NSShadow()
            shadow.shadowColor = NSColor.black.withAlphaComponent(0.35)
            shadow.shadowBlurRadius = full.width * 0.02
            shadow.shadowOffset = NSSize(width: 0, height: -full.width * 0.01)
            shadow.set()
            bg.setFill()
            shape.fill()
            NSGraphicsContext.restoreGraphicsState()

            // Same proportions as the web icon: bars 68% long, 7.4% thick, a 13.7% white dot.
            drawLogo(in: box, length: 0.68, thickness: 0.074, dot: 0.137, center: ink, lit: true, dim: .gray)
            return true
        }
    }

    /// Menu bar icon (18 pt): the logo with chunkier bars so it reads at that size.
    /// Coloured while the relay runs, grey (menu bar text colour) while it's stopped.
    static func menuBar(active: Bool) -> NSImage {
        let img = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { r in
            drawLogo(in: r, length: 0.92, thickness: 0.16, dot: 0.30, center: NSColor.labelColor, lit: active,
                     dim: NSColor.labelColor.withAlphaComponent(0.55))
            return true
        }
        img.isTemplate = false
        return img
    }

    /// `ClaudeShell --make-icon <dir>`: writes the .iconset PNGs (the build script turns them into AppIcon.icns).
    static func writeIconset(to dir: String) throws {
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        for base in [16, 32, 128, 256, 512] {
            for scale in [1, 2] {
                let px = base * scale
                let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
                rep.size = NSSize(width: px, height: px)
                NSGraphicsContext.saveGraphicsState()
                NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
                appIcon(size: CGFloat(px)).draw(in: NSRect(x: 0, y: 0, width: px, height: px))
                NSGraphicsContext.restoreGraphicsState()
                let name = scale == 1 ? "icon_\(base)x\(base).png" : "icon_\(base)x\(base)@2x.png"
                try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(dir)/\(name)"))
            }
        }
    }
}
