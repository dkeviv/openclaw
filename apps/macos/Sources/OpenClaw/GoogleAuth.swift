import AuthenticationServices
import Foundation
import AppKit

enum GoogleAuthError: Error {
    case missingCallbackURL
}

final class GoogleAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func start(
        authURL: URL,
        callbackURLScheme: String?,
        prefersEphemeralSession: Bool = false,
        completion: @escaping (Result<URL, Error>) -> Void
    ) {
        self.session?.cancel()

        let next = ASWebAuthenticationSession(url: authURL, callbackURLScheme: callbackURLScheme) { callbackURL, error in
            if let url = callbackURL {
                completion(.success(url))
                return
            }
            completion(.failure(error ?? GoogleAuthError.missingCallbackURL))
        }

        next.presentationContextProvider = self
        next.prefersEphemeralWebBrowserSession = prefersEphemeralSession
        self.session = next
        _ = next.start()
    }

    func presentationAnchor(for _: ASWebAuthenticationSession) -> ASPresentationAnchor {
        NSApplication.shared.keyWindow ?? NSApplication.shared.windows.first ?? NSWindow()
    }
}

