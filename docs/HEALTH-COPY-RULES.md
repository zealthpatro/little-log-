# Health copy rules

Founder, 27 Nov 2026: say only what the sources say, keep their limits, and always tell the parent to
check with their own doctor. These rules apply to every MEDICAL article (the list is in
docs/health-caution-scope.md) and to health lines anywhere on the site.

1. **Only what the source says.** Every health sentence comes from an official source the page lists
   (a national health service or health authority, the WHO, or the clinical college whose guidance that
   service follows, such as the AAP or RCOG). If no listed source says it, it does not go on the page.
   No filling gaps from memory, from other apps, or from a model.
2. **Keep the limits.** Carry every limit the source gives: age, weight, dose, time, temperature, country.
   If the source gives an age and a weight, the page gives both. Never round a limit into a softer one, never widen it,
   and never move advice from one country's service to a page about another country.
3. **List the sources.** Every MEDICAL article links its official sources in a sources list at the end
   (footer.src or a "Sources" section). Charities, research papers and news are welcome as extra reading,
   but they do not count as the source.
4. **No new review claims without a recorded sign-off.** Never add a line that says or implies a doctor,
   nurse or expert reviewed a page unless one did and the sign-off is recorded. The existing "Reviewed
   <date> by the Cubby editorial team" bylines stay exactly as they are: the team exists (founder, 27 Nov
   2026). Our pages are summaries of official guidance.
5. **The caution, word for word, under the title:**
   "In an emergency, call your local emergency number straight away. For anything else, please check
   with your own doctor before acting on health information, including what you read here. Information
   online can never replace a doctor who knows you."
   The emergency line comes first because it is the one that matters: nothing on a page may make a parent
   wait before calling for help or starting first aid. The words name no baby, so they fit loss, fertility
   and pregnancy pages too. The same words close the page if it has a bottom
   disclaimer. NON-MEDICAL articles carry "This is general information. Rules change, so check with the
   official body for your country." PRODUCT pages (a pure Cubby product page with no health guidance,
   listed in `product` in tools/health_caution_scope.json) carry neither line. A product page that shows
   a dose, a temperature or when to call a doctor is MEDICAL.
6. **Voice.** DESIGN.md §A1 and §A7: warm, brief, second person, sentence case, no em-dashes.

The gate: `node tools/health_caution_check.js --self-test` (wired in tools/gates.js). It checks the words,
the place, and that a sources list links an official host. It cannot check that a page says only what its
source says; that is a reading job for whoever edits the page. `--apply` puts the caution on every page
in scope; `--write-doc` refreshes the scope list after you change tools/health_caution_scope.json.
`sourcesGap` is frozen: `sourcesGapPin` pins its count and hash and the gate caps it, so a page can only
leave the list (once it links an official source), never join it.
