// Prints the payload of the first QR code in an image, using macOS's Vision framework
// (reads dense codes, like Google Authenticator exports, that pure-JS decoders miss).
//   swift relay/scripts/qr-decode.swift <image>
import Foundation
import Vision
import CoreImage

guard CommandLine.arguments.count > 1, let image = CIImage(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])) else {
    FileHandle.standardError.write("usage: qr-decode <image>\n".data(using: .utf8)!)
    exit(2)
}
let request = VNDetectBarcodesRequest()
request.symbologies = [.qr]
try VNImageRequestHandler(ciImage: image).perform([request])
guard let payload = request.results?.compactMap({ $0.payloadStringValue }).first else { exit(1) }
print(payload, terminator: "")
