import Foundation
import HTTPTypes
import HTTPTypesFoundation
import OpenAPIRuntime

/// Carries the generated client's requests with the user's access token. When the server refuses the token, it
/// refreshes once and tries again; when it refuses that one too, or says the token names no user, the sign-in ends.
struct AuthorizedTransport: ClientTransport {
    // The largest request body the app sends: an image put up for a post, which the server takes up to 5 MB.
    private static let maxRequestBodyBytes = 5 * 1024 * 1024

    let vault: SignInVault
    let send: Send

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        let bodyData: Data? = if let body { try await Data(collecting: body, upTo: Self.maxRequestBodyBytes) } else { nil }
        var token = try await vault.accessToken()
        var (response, data) = try await perform(request, body: bodyData, baseURL: baseURL, token: token)
        if response.status == .unauthorized {
            token = try await vault.refreshedAccessToken(replacing: token)
            (response, data) = try await perform(request, body: bodyData, baseURL: baseURL, token: token)
        }
        // Every /api route answers 403 for a token that names no user, which only a new sign-in mends.
        if response.status == .unauthorized || response.status == .forbidden { await vault.endSignIn(refusing: token) }
        return (response, HTTPBody(data))
    }

    private func perform(_ request: HTTPRequest, body: Data?, baseURL: URL, token: String) async throws -> (HTTPResponse, Data) {
        guard let path = request.path, let url = URL(string: baseURL.absoluteString.trimmingSuffix("/") + path) else {
            throw AppError.unexpected
        }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = request.method.rawValue
        for field in request.headerFields {
            urlRequest.addValue(field.value, forHTTPHeaderField: field.name.canonicalName)
        }
        urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        urlRequest.httpBody = body
        let (data, response) = try await send(urlRequest)
        guard let http = (response as? HTTPURLResponse)?.httpResponse else { throw AppError.unexpected }
        return (http, data)
    }
}

extension String {
    fileprivate func trimmingSuffix(_ suffix: String) -> String {
        hasSuffix(suffix) ? String(dropLast(suffix.count)) : self
    }
}
