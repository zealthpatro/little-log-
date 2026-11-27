// The app's root view controller (Main.storyboard names it; tools/cap_ios_configure.rb copies this file in
// and points the storyboard here). It is Capacitor's bridge with one change: a failed page load shows the
// bundled error page only when CubbyLoadFailure says the failure is real (no connection, or the site
// cannot answer), never for a cancelled load or a link handed to Safari.
import UIKit
import WebKit
import Capacitor

class CubbyBridgeViewController: CAPBridgeViewController {
    // WKWebView holds its navigation delegate weakly, so the guard is kept here.
    private var navigationGuard: CubbyNavigationGuard?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let webView = webView, let inner = webView.navigationDelegate, let bridge = bridge else { return }
        let errorPage = bridge.config.localURL.appendingPathComponent("error.html")
        let guardian = CubbyNavigationGuard(inner: inner, errorPage: errorPage)
        navigationGuard = guardian
        webView.navigationDelegate = guardian
    }
}

// Sits in front of Capacitor's WebViewDelegationHandler: every navigation callback goes straight through to
// it (policy decisions, auth challenges, loading state), and the two failure callbacks also get a look.
final class CubbyNavigationGuard: NSObject, WKNavigationDelegate {
    private weak var inner: WKNavigationDelegate?
    private let errorPage: URL

    init(inner: WKNavigationDelegate, errorPage: URL) {
        self.inner = inner
        self.errorPage = errorPage
    }

    override func responds(to aSelector: Selector!) -> Bool {
        return super.responds(to: aSelector) || (inner?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let inner = inner, inner.responds(to: aSelector) { return inner }
        return super.forwardingTarget(for: aSelector)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        inner?.webView?(webView, didFail: navigation, withError: error)
        showErrorPageIfReal(webView, error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        inner?.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
        showErrorPageIfReal(webView, error)
    }

    private func showErrorPageIfReal(_ webView: WKWebView, _ error: Error) {
        guard CubbyLoadFailure.showsErrorPage(error) else { return }
        let failed = (error as NSError).userInfo[NSURLErrorFailingURLErrorKey] as? URL
        if failed?.scheme == errorPage.scheme { return }  // the bundled page itself: never loop
        // The link that failed rides along in the fragment (never sent anywhere), so "Try again" reopens
        // the same sign-in or invite link instead of the home screen.
        var page = URLComponents(url: errorPage, resolvingAgainstBaseURL: false)
        if let failed = failed, failed.scheme == "https", failed.host == "little-cubby.com" {
            page?.fragment = failed.absoluteString
        }
        webView.load(URLRequest(url: page?.url ?? errorPage))
    }
}
