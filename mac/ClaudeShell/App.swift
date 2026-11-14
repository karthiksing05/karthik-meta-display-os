import AppKit
import SwiftUI

// Monokai, to match the lens.
extension Color {
    static let mPink = Color(red: 1.00, green: 0.38, blue: 0.53)
    static let mOrange = Color(red: 0.99, green: 0.59, blue: 0.12)
    static let mYellow = Color(red: 0.90, green: 0.86, blue: 0.45)
    static let mGreen = Color(red: 0.65, green: 0.89, blue: 0.18)
    static let mCyan = Color(red: 0.40, green: 0.85, blue: 0.94)
    static let mPurple = Color(red: 0.68, green: 0.51, blue: 1.00)
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var relay: Relay?
    func applicationWillTerminate(_ notification: Notification) {
        MainActor.assumeIsolated { relay?.shutdown() }
    }
}

@main
struct ClaudeShellApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var relay = Relay()

    init() {
        // `ClaudeShell --make-icon <dir>`: used by the build to render the app icon, then exit.
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--make-icon"), i + 1 < args.count {
            do { try Icon.writeIconset(to: args[i + 1]); exit(0) } catch { print(error); exit(1) }
        }
    }

    var body: some Scene {
        MenuBarExtra {
            Panel()
                .environmentObject(relay)
                .onAppear { delegate.relay = relay }
        } label: {
            Image(nsImage: Icon.menuBar(active: relay.status != nil))
        }
        .menuBarExtraStyle(.window)

        Window("Install on your glasses", id: "qr") {
            QRWindow().environmentObject(relay)
        }
        .windowResizability(.contentSize)

        Window("ClaudeProd checkup", id: "doctor") {
            DoctorWindow().environmentObject(relay)
        }
    }
}

// MARK: - Menu bar panel

struct Panel: View {
    @EnvironmentObject var relay: Relay
    @Environment(\.openWindow) private var openWindow
    @State private var showLog = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            if let s = relay.status { statusGrid(s) }
            phaseLine
            controls
            Divider()
            settings
            if showLog { logView }
            Divider()
            footer
        }
        .padding(14)
        .frame(width: 330)
        .onAppear { delegateHook() }
    }

    private func delegateHook() {
        (NSApp.delegate as? AppDelegate)?.relay = relay
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(nsImage: Icon.appIcon(size: 40)).resizable().frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text("ClaudeProd").font(.system(.headline, design: .monospaced))
                Text(phaseLabel).font(.caption).foregroundStyle(phaseColor)
            }
            Spacer()
            Circle().fill(phaseColor).frame(width: 9, height: 9)
        }
    }

    private var phaseLabel: String {
        switch relay.phase {
        case .stopped: return "stopped"
        case .starting(let step): return step.lowercased()
        case .running: return relay.status?.demo == true ? "running · demo data" : "running"
        case .elsewhere: return "running (started outside the app)"
        case .failed: return "couldn't start"
        }
    }

    private var phaseColor: Color {
        switch relay.phase {
        case .running, .elsewhere: return .mGreen
        case .starting: return .mYellow
        case .failed: return .mPink
        case .stopped: return .secondary
        }
    }

    private func statusGrid(_ s: RelayStatus) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 14) {
                stat("glasses", s.lens > 0 ? "connected" : "not open", s.lens > 0 ? .mGreen : .secondary)
                stat("sessions", "\(s.sessions)", .mPurple)
                stat("working", "\(s.working)", .mGreen)
                stat("needs you", "\(s.needsYou)", s.needsYou > 0 ? .mOrange : .secondary)
            }
            if !s.publicUrl.isEmpty {
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(s.publicUrl, forType: .string)
                } label: {
                    Label(s.publicUrl.replacingOccurrences(of: "https://", with: ""), systemImage: "link")
                        .font(.system(.caption, design: .monospaced)).lineLimit(1).truncationMode(.middle)
                }
                .buttonStyle(.plain).foregroundStyle(Color.mCyan)
                .help("Public address of the relay (click to copy)")
            }
        }
    }

    private func stat(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption2).foregroundStyle(Color.mCyan)
            Text(value).font(.system(.callout, design: .monospaced)).foregroundStyle(color)
        }
    }

    @ViewBuilder private var phaseLine: some View {
        if case .failed(let why) = relay.phase {
            Text(why).font(.caption).foregroundStyle(Color.mPink).fixedSize(horizontal: false, vertical: true)
        } else if case .starting = relay.phase {
            ProgressView().controlSize(.small).progressViewStyle(.linear)
        }
    }

    private var controls: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                switch relay.phase {
                case .running where relay.ownsRelay, .starting:
                    big("Stop", "stop.fill", .mPink) { relay.stop() }
                    big("Restart", "arrow.clockwise", .mYellow) { relay.restart() }
                case .elsewhere:
                    Text("Started from a terminal (npm run up). Stop it there to run it from here.")
                        .font(.caption).foregroundStyle(.secondary)
                default:
                    big("Start", "play.fill", .mGreen) { relay.start() }
                }
            }
            HStack(spacing: 8) {
                small("Install QR", "qrcode") {
                    openWindow(id: "qr")
                    NSApp.activate(ignoringOtherApps: true)
                    Task { await relay.refreshInstall() }
                }
                small("Preview", "eyeglasses") { if let u = relay.lensPreviewURL { NSWorkspace.shared.open(u) } }
                small("Checkup", "stethoscope") { relay.runDoctor(); openWindow(id: "doctor"); NSApp.activate(ignoringOtherApps: true) }
            }
        }
    }

    private func big(_ title: String, _ icon: String, _ color: Color, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon).frame(maxWidth: .infinity).padding(.vertical, 4)
        }
        .buttonStyle(.borderedProminent).tint(color).foregroundStyle(.black)
    }

    private func small(_ title: String, _ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon).font(.caption).frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
    }

    private var settings: some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle("Start the relay when the app opens", isOn: $relay.autoStart)
            Toggle("Open ClaudeProd at login", isOn: Binding(get: { relay.launchAtLogin }, set: { relay.setLaunchAtLogin($0) }))
            Toggle("Demo data (no real sessions)", isOn: $relay.demo)
            HStack {
                Text("Tunnel")
                Picker("", selection: $relay.tunnel) {
                    Text("Auto").tag("auto")
                    Text("Tailscale").tag("tailscale")
                    Text("Cloudflare").tag("cloudflare")
                }
                .labelsHidden().pickerStyle(.segmented)
            }
            if relay.ownsRelay, let s = relay.status, s.demo != relay.demo {
                Text("Restart to apply.").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .toggleStyle(.switch).controlSize(.small).font(.callout)
    }

    private var logView: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(Array(relay.log.suffix(120).enumerated()), id: \.offset) { i, line in
                        Text(line).font(.system(size: 10, design: .monospaced)).frame(maxWidth: .infinity, alignment: .leading).id(i)
                    }
                }
                .textSelection(.enabled)
            }
            .frame(height: 160)
            .padding(6)
            .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 6))
            .onAppear { proxy.scrollTo(min(119, max(0, relay.log.count - 1)), anchor: .bottom) }
        }
    }

    private var footer: some View {
        HStack {
            Button(showLog ? "Hide log" : "Log") { showLog.toggle() }
            Button("Logs folder") { relay.openLogs() }
            Button(".env") { relay.openEnv() }
            Spacer()
            Button("Quit") { NSApp.terminate(nil) }
        }
        .buttonStyle(.link).font(.caption)
    }
}

// MARK: - Install QR

struct QRWindow: View {
    @EnvironmentObject var relay: Relay
    @State private var image: NSImage?
    let refresh = Timer.publish(every: 3, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(spacing: 14) {
            if let image {
                Image(nsImage: image).interpolation(.none).resizable().frame(width: 300, height: 300)
                    .background(Color.white).clipShape(RoundedRectangle(cornerRadius: 10))
            } else {
                RoundedRectangle(cornerRadius: 10).fill(.quaternary).frame(width: 300, height: 300)
                    .overlay(Text("The QR appears once the relay is running.").font(.caption).multilineTextAlignment(.center).padding())
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("1. Point your iPhone camera at the QR.")
                Text("2. The Meta AI app asks to add \"Claude Productivity For Meta Display\" (\"unverified\" is expected).")
                Text("3. Open ClaudeProd on the glasses. A green dot means connected.")
            }
            .font(.callout)
            Text("Developer Mode must be on: Meta AI app → Settings → App info → tap the version 5×.")
                .font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 8) {
                if relay.installBusy { ProgressView().controlSize(.small) }
                VStack(alignment: .leading, spacing: 2) {
                    if !relay.installURL.isEmpty {
                        Text(relay.installURL.replacingOccurrences(of: "https://", with: ""))
                            .font(.system(.caption, design: .monospaced)).foregroundStyle(Color.mCyan).lineLimit(1).truncationMode(.middle)
                    }
                    Text(relay.installState).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Refresh") { Task { await relay.refreshInstall() } }.disabled(relay.installBusy)
            }
        }
        .padding(20)
        .frame(width: 380)
        .onAppear(perform: load)
        .onReceive(refresh) { _ in load() }
    }

    private func load() { image = NSImage(contentsOfFile: relay.qrPath) }
}

// MARK: - Checkup (npm run doctor)

struct DoctorWindow: View {
    @EnvironmentObject var relay: Relay

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Checkup").font(.headline)
                Spacer()
                if relay.doctorRunning { ProgressView().controlSize(.small) }
                Button("Run again") { relay.runDoctor() }.disabled(relay.doctorRunning)
            }
            ScrollView {
                Text(relay.doctorOutput.isEmpty ? (relay.doctorRunning ? "Checking…" : "") : relay.doctorOutput)
                    .font(.system(size: 12, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
        }
        .padding(16)
        .frame(minWidth: 560, minHeight: 360)
    }
}
