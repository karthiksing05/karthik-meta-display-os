import AppKit
import Foundation
import ServiceManagement

/// What /status.json on the relay reports.
struct RelayStatus: Decodable {
    var ok: Bool
    var demo: Bool
    var publicUrl: String
    var lens: Int
    var sessions: Int
    var working: Int
    var needsYou: Int
    var approvals: String
    var totp: Bool
    var groq: Bool
}

enum Phase: Equatable {
    case stopped
    case starting(String)   // the latest "==>" step from up.sh
    case running            // started by this app
    case elsewhere          // a relay is answering, but something else started it (e.g. npm run up)
    case failed(String)
}

/// Runs the whole stack (deploy/up.sh: deps, .env, hooks, build, tunnel, relay, QR) as a child
/// process, and polls the relay's /status.json. Stopping sends SIGTERM; up.sh's own cleanup
/// then stops the relay, the watchers and the tunnel.
@MainActor
final class Relay: ObservableObject {
    @Published var phase: Phase = .stopped
    @Published var status: RelayStatus?
    @Published var log: [String] = []
    @Published var doctorOutput = ""
    @Published var doctorRunning = false
    /// Install QR window: the address in the QR and how the last refresh went.
    @Published var installURL = ""
    @Published var installState = ""
    @Published var installBusy = false

    @Published var autoStart: Bool { didSet { UserDefaults.standard.set(autoStart, forKey: "autoStart") } }
    @Published var demo: Bool { didSet { UserDefaults.standard.set(demo, forKey: "demo") } }
    @Published var tunnel: String { didSet { UserDefaults.standard.set(tunnel, forKey: "tunnel") } }
    @Published var launchAtLogin: Bool = SMAppService.mainApp.status == .enabled

    let repo: String
    private var proc: Process?
    private var timer: Timer?
    private var logHandle: FileHandle?

    init() {
        let d = UserDefaults.standard
        d.register(defaults: ["autoStart": true, "demo": false, "tunnel": "auto"])
        autoStart = d.bool(forKey: "autoStart")
        demo = d.bool(forKey: "demo")
        tunnel = d.string(forKey: "tunnel") ?? "auto"
        repo = d.string(forKey: "repo") ?? (Bundle.main.object(forInfoDictionaryKey: "ClaudeShellRepo") as? String ?? "")
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in Task { @MainActor in await self?.poll() } }
        Task {
            await poll()
            if autoStart, status == nil, proc == nil { start() }
        }
    }

    // MARK: relay/.env

    var envFile: String { "\(repo)/relay/.env" }
    func env(_ key: String) -> String? {
        guard let text = try? String(contentsOfFile: envFile, encoding: .utf8) else { return nil }
        for line in text.split(separator: "\n") where line.hasPrefix("\(key)=") {
            let v = line.dropFirst(key.count + 1).trimmingCharacters(in: .whitespaces)
            return v.isEmpty ? nil : v
        }
        return nil
    }
    var port: String { env("PORT") ?? "8787" }
    var token: String { env("SHELL_TOKEN") ?? "" }
    var lensPreviewURL: URL? { URL(string: "http://localhost:\(port)/?k=\(token)") }
    var qrPath: String { "\(repo)/relay/install-qr.png" }
    var repoOK: Bool { FileManager.default.fileExists(atPath: "\(repo)/deploy/up.sh") }

    // MARK: status

    func poll() async {
        guard let url = URL(string: "http://127.0.0.1:\(port)/status.json?k=\(token)") else { return }
        var req = URLRequest(url: url)
        req.timeoutInterval = 2
        let s: RelayStatus? = await {
            guard let (data, resp) = try? await URLSession.shared.data(for: req),
                  (resp as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            return try? JSONDecoder().decode(RelayStatus.self, from: data)
        }()
        status = s
        switch phase {
        case .starting where s != nil:
            // The relay answers once it's listening; up.sh still finishes the public URL + QR.
            if log.contains(where: { $0.contains("Ready") }) { phase = .running }
        case .stopped, .failed, .elsewhere:
            phase = s != nil ? (proc == nil ? .elsewhere : .running) : (phase == .elsewhere ? .stopped : phase)
        case .running where s == nil && proc == nil:
            phase = .stopped
        default: break
        }
    }

    // MARK: start / stop

    /// The PATH the build captured from your shell (so node from nvm, Homebrew, claude… are found),
    /// plus the usual places.
    private var childPath: String {
        let built = Bundle.main.object(forInfoDictionaryKey: "ClaudeShellPath") as? String ?? ""
        let home = NSHomeDirectory()
        return [built, "/opt/homebrew/bin", "/usr/local/bin", "\(home)/.local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
            .filter { !$0.isEmpty }.joined(separator: ":")
    }

    func start() {
        guard proc == nil else { return }
        guard repoOK else { phase = .failed("Can't find the project at \(repo). Rebuild the app from the repo (npm run app)."); return }
        if status != nil { phase = .elsewhere; return }
        log = []
        phase = .starting("starting…")

        var args = ["deploy/up.sh", "--no-prompt", "--no-open"]
        if demo { args.append("--demo") }
        if tunnel != "auto" { args += ["--tunnel", tunnel] }

        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = args
        p.currentDirectoryURL = URL(fileURLWithPath: repo)
        var e = ProcessInfo.processInfo.environment
        e["PATH"] = childPath
        e["CLAUDE_SHELL_APP"] = "1"
        p.environment = e

        let logsDir = "\(repo)/relay/.logs"
        try? FileManager.default.createDirectory(atPath: logsDir, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: "\(logsDir)/app.log", contents: nil)
        logHandle = FileHandle(forWritingAtPath: "\(logsDir)/app.log")

        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] h in
            let data = h.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            Task { @MainActor in self?.ingest(text, raw: data) }
        }
        p.terminationHandler = { [weak self] proc in
            Task { @MainActor in self?.ended(code: proc.terminationStatus) }
        }
        do {
            try p.run()
            proc = p
        } catch {
            phase = .failed("Couldn't start: \(error.localizedDescription)")
        }
    }

    private func ingest(_ text: String, raw: Data) {
        logHandle?.write(raw)
        // Strip colour codes; keep the last 300 lines.
        let clean = text.replacingOccurrences(of: "\u{1B}\\[[0-9;]*m", with: "", options: .regularExpression)
        for line in clean.split(separator: "\n", omittingEmptySubsequences: true) {
            let l = String(line)
            log.append(l)
            if l.hasPrefix("==>") {
                let step = l.dropFirst(3).trimmingCharacters(in: .whitespaces)
                if step == "Ready" { phase = .running } else if case .starting = phase { phase = .starting(step) }
            }
        }
        if log.count > 300 { log.removeFirst(log.count - 300) }
    }

    private func ended(code: Int32) {
        proc = nil
        try? logHandle?.close()
        logHandle = nil
        if case .stopped = phase { return } // we asked it to stop
        let reason = log.last(where: { $0.trimmingCharacters(in: .whitespaces).hasPrefix("x ") || $0.contains("  x ") })
            .map { $0.replacingOccurrences(of: "  x ", with: "").trimmingCharacters(in: .whitespaces) }
        phase = code == 0 ? .stopped : .failed(reason ?? "Stopped unexpectedly (exit \(code)). See Logs.")
    }

    func stop() {
        guard let p = proc else { return }
        phase = .stopped
        p.terminate() // SIGTERM → up.sh cleanup (relay, watchers, tunnel)
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { if p.isRunning { kill(p.processIdentifier, SIGKILL) } }
    }

    func restart() {
        stop()
        Task {
            for _ in 0..<40 where proc != nil || status != nil {
                try? await Task.sleep(nanoseconds: 250_000_000)
                await poll()
            }
            start()
        }
    }

    var ownsRelay: Bool { proc != nil }

    // MARK: install QR

    /// Runs a command with the app's PATH; returns (exit code, output).
    private func run(_ args: [String]) async -> (Int32, String) {
        await withCheckedContinuation { cont in
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            p.arguments = args
            p.currentDirectoryURL = URL(fileURLWithPath: repo)
            var e = ProcessInfo.processInfo.environment
            e["PATH"] = childPath
            e["NO_COLOR"] = "1"
            p.environment = e
            let pipe = Pipe()
            p.standardOutput = pipe
            p.standardError = pipe
            p.terminationHandler = { proc in
                let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                cont.resume(returning: (proc.terminationStatus, out))
            }
            do { try p.run() } catch { cont.resume(returning: (-1, error.localizedDescription)) }
        }
    }

    /// The tunnel's address right now: Tailscale's hostname, or the newest Cloudflare quick-tunnel URL.
    private func liveTunnelURL(current: String) async -> String {
        if current.contains(".ts.net") || current.isEmpty {
            let (code, out) = await run(["tailscale", "status", "--json"])
            if code == 0, let data = out.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let me = json["Self"] as? [String: Any], let dns = me["DNSName"] as? String, !dns.isEmpty {
                return "https://" + dns.trimmingCharacters(in: CharacterSet(charactersIn: "."))
            }
        }
        if let log = try? String(contentsOfFile: "\(repo)/relay/.logs/tunnel.log", encoding: .utf8),
           let re = try? NSRegularExpression(pattern: "https://[a-z0-9-]+\\.trycloudflare\\.com"),
           let last = re.matches(in: log, range: NSRange(log.startIndex..., in: log)).last,
           let r = Range(last.range, in: log) {
            return String(log[r])
        }
        return current
    }

    private func setEnv(_ key: String, _ value: String) {
        guard var text = try? String(contentsOfFile: envFile, encoding: .utf8) else { return }
        let lines = text.components(separatedBy: "\n")
        if let i = lines.firstIndex(where: { $0.hasPrefix("\(key)=") }) {
            var l = lines
            l[i] = "\(key)=\(value)"
            text = l.joined(separator: "\n")
        } else {
            text += (text.hasSuffix("\n") ? "" : "\n") + "\(key)=\(value)\n"
        }
        try? text.write(toFile: envFile, atomically: true, encoding: .utf8)
    }

    /// "Install QR": refresh the public address, regenerate the QR, and check the address answers.
    func refreshInstall() async {
        guard !installBusy else { return }
        installBusy = true
        defer { installBusy = false }
        await poll()
        guard let s = status else { installState = "Start the relay first."; return }
        installState = "refreshing the address…"
        let url = await liveTunnelURL(current: s.publicUrl)
        guard url.hasPrefix("https://") else { installState = "No public address yet (is the tunnel up?)."; return }
        if env("PUBLIC_URL") != url {
            setEnv("PUBLIC_URL", url) // the relay restarts with it (it watches relay/.env)
        }
        installURL = url
        installState = "making the QR…"
        let (code, out) = await run(["npm", "run", "-s", "qr", "-w", "relay", "--", url])
        if code != 0 {
            installState = "QR failed: " + (out.split(separator: "\n").last.map(String.init) ?? "exit \(code)")
            return
        }
        installState = "checking \(url.replacingOccurrences(of: "https://", with: "")) answers…"
        var ok = false
        if let health = URL(string: url + "/healthz") {
            for _ in 0..<6 where !ok {
                var req = URLRequest(url: health)
                req.timeoutInterval = 5
                if let (_, resp) = try? await URLSession.shared.data(for: req), (resp as? HTTPURLResponse)?.statusCode == 200 { ok = true }
                else { try? await Task.sleep(nanoseconds: 1_500_000_000) }
            }
        }
        installState = ok ? "up to date · reachable from your phone" : "QR updated, but the address isn't answering yet (DNS can lag a minute)"
    }

    // MARK: tools

    func runDoctor() {
        doctorRunning = true
        doctorOutput = ""
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = ["-c", "npm run -s doctor 2>&1"]
        p.currentDirectoryURL = URL(fileURLWithPath: repo)
        var e = ProcessInfo.processInfo.environment
        e["PATH"] = childPath
        e["NO_COLOR"] = "1"
        p.environment = e
        let pipe = Pipe()
        p.standardOutput = pipe
        p.terminationHandler = { [weak self] _ in
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let text = (String(data: data, encoding: .utf8) ?? "")
                .replacingOccurrences(of: "\u{1B}\\[[0-9;]*m", with: "", options: .regularExpression)
            Task { @MainActor in
                self?.doctorOutput = text.trimmingCharacters(in: .whitespacesAndNewlines)
                self?.doctorRunning = false
            }
        }
        try? p.run()
    }

    func openLogs() { NSWorkspace.shared.open(URL(fileURLWithPath: "\(repo)/relay/.logs")) }
    func openRepo() { NSWorkspace.shared.open(URL(fileURLWithPath: repo)) }
    func openEnv() { NSWorkspace.shared.open(URL(fileURLWithPath: envFile)) }

    func setLaunchAtLogin(_ on: Bool) {
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
        } catch {
            NSLog("launch at login: \(error)")
        }
        launchAtLogin = SMAppService.mainApp.status == .enabled
    }

    /// Called when the app quits: stop the stack we started (a relay started elsewhere keeps running).
    func shutdown() {
        guard let p = proc else { return }
        p.terminate()
        let deadline = Date().addingTimeInterval(5)
        while p.isRunning && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
    }
}
