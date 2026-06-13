/* Cubby edge worker.
   Reverse-proxies the reserved Firebase namespace (/__/*) to the project's
   firebaseapp.com origin so Google sign-in can run on little-cubby.com itself
   (authDomain = little-cubby.com). Everything else is served from static assets. */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__/')) {
      const upstream = new URL(url.pathname + url.search, 'https://little-log-a9caa.firebaseapp.com');
      return fetch(new Request(upstream, request));
    }
    return env.ASSETS.fetch(request);
  }
};
