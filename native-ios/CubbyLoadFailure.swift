// Which failed page loads show the bundled error page (cap-web/error.html). Foundation only, so
// tools/native_error_page_check.js compiles and runs this exact file against real error codes.
//
// Capacitor's server.errorPath shows its error page for EVERY failed main-frame load. Most of those are
// not failures: NSURLErrorCancelled (-999) is a second navigation interrupting the first (a sign-in or
// invite link arriving while the app is still opening), and WebKit's 102 is a link the app hands to Safari.
// Loading an error page then cancels the link the parent just tapped. So errorPath is off
// (capacitor.config.json) and CubbyBridgeViewController asks this list instead: only a phone with no way
// to reach the site, or a site that cannot answer, gets the page. An HTTP error page from the site is a
// successful load and never reaches here.
import Foundation

enum CubbyLoadFailure {
    static let errorPageCodes: Set<Int> = [
        NSURLErrorNotConnectedToInternet,  // -1009
        NSURLErrorNetworkConnectionLost,   // -1005
        NSURLErrorTimedOut,                // -1001
        NSURLErrorCannotFindHost,          // -1003
        NSURLErrorCannotConnectToHost,     // -1004
        NSURLErrorDNSLookupFailed,         // -1006
        NSURLErrorInternationalRoamingOff, // -1018
        NSURLErrorCallIsActive,            // -1019
        NSURLErrorDataNotAllowed,          // -1020
        NSURLErrorBadServerResponse,       // -1011
        NSURLErrorSecureConnectionFailed,  // -1200
        NSURLErrorServerCertificateUntrusted, // -1202 (a captive Wi-Fi sign-in page)
    ]

    static func showsErrorPage(domain: String, code: Int) -> Bool {
        return domain == NSURLErrorDomain && errorPageCodes.contains(code)
    }

    static func showsErrorPage(_ error: Error) -> Bool {
        let e = error as NSError
        return showsErrorPage(domain: e.domain, code: e.code)
    }
}
