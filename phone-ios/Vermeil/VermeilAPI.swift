import Foundation

/// Talks to Vermeil on the computer (brain/phone.py): POST /api/<name> with the X-Vermeil-Key header.
struct VermeilAPI {
    let base: URL
    let key: String

    enum Failure: LocalizedError {
        case badKey, locked, offline, server(String)

        var errorDescription: String? {
            switch self {
            case .badKey: return "This iPhone isn't connected any more. Scan the QR code on your computer again."
            case .locked: return "Too many wrong keys. Wait a minute."
            case .offline: return "I can't reach your computer. Is Vermeil open there with Phone turned on? "
                + "(The free Cloudflare link changes every time Vermeil starts - scan the QR code again, or use Tailscale.)"
            case .server(let text): return text
            }
        }
    }

    private func request(_ name: String) -> URLRequest {
        var r = URLRequest(url: base.appendingPathComponent("api").appendingPathComponent(name))
        r.httpMethod = "POST"
        r.timeoutInterval = 120
        r.setValue(key, forHTTPHeaderField: "X-Vermeil-Key")
        return r
    }

    /// JSON in, JSON out ({"error": ...} becomes a thrown Failure.server)
    func call(_ name: String, _ body: [String: Any] = [:]) async throws -> [String: Any] {
        var r = request(name)
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await send(r)
        let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if let error = object["error"] as? String { throw Failure.server(error) }
        return object
    }

    /// her voice as a .wav (api "speak": the character's own PC voice)
    func audio(_ name: String, _ body: [String: Any]) async throws -> Data {
        var r = request(name)
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await send(r)
        guard (response.value(forHTTPHeaderField: "Content-Type") ?? "").hasPrefix("audio/") else {
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw Failure.server(object?["error"] as? String ?? "No voice came back.")
        }
        return data
    }

    private func send(_ r: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let data: Data, response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: r)
        } catch {
            throw Failure.offline
        }
        guard let http = response as? HTTPURLResponse else { throw Failure.offline }
        switch http.statusCode {
        case 200: return (data, http)
        case 401, 403: throw Failure.badKey
        case 429: throw Failure.locked
        case 502, 503, 504, 530: throw Failure.offline     // the tunnel is up but the computer isn't answering
        default:
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw Failure.server(object?["error"] as? String ?? "Your computer answered with error \(http.statusCode).")
        }
    }

    /// markdown -> plain words for speaking
    static func plain(_ text: String) -> String {
        var t = text.replacingOccurrences(of: "```[\\s\\S]*?```", with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: "\\[([^\\]]*)\\]\\([^)]*\\)", with: "$1", options: .regularExpression)
        t = t.replacingOccurrences(of: "[*_`#>|]+", with: "", options: .regularExpression)
        return t.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
    }
}
