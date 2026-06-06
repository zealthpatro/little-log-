# Little Log

A warm, private, single-file baby activity tracker. Feeds, sleep, nappies, pumping, growth, milestones, medicine, vaccines, illness, photos and keepsakes, with multi-baby (twin) support and a "dusk nursery" design.

This document covers what the app is, how it is built, how to run it locally, how to put it live on the web, and the plan for real multi-caregiver sharing.

---

## 1. What it is

Little Log is one self-contained HTML file (vanilla JavaScript, custom CSS, canvas for image generation). No build step, no framework, no external runtime dependencies. It opens on a phone or desktop browser and works offline.

Core ideas:

- One-thumb logging, designed for a tired parent at 3am.
- Privacy by default. Nothing leaves the device in the standalone version.
- A genuinely differentiated feature: the data-fused **memory card**, which composes a monthly keepsake image from the baby's real logged numbers.

---

## 2. Features

**Logging**
- Feed: nursing timer, bottle (breast milk or formula), solids (with suggested foods, allergen flags, optional amount and photo), water. Adapts to each baby's feeding profile.
- Sleep: live nap timer plus "log a past nap" with date and time.
- Diaper: wet, dirty, both, dry (each with a distinct icon and colour).
- Pump, growth (weight and height with charts), activity tags (tummy time, bath, play and more) and free notes.
- Past-feed and past-nap entries support a date, not only a time.

**Health**
- Medicine schedules with in-app reminders (fire only while the app is open).
- Editable vaccine schedule (CDC/ACIP template, with a disclaimer to follow your own pediatrician and country schedule).
- Illness episodes with temperature logging (fever flag), symptoms, and medicines given during the window.
- Doctors and Allergies are also surfaced here as entry points.

**Profile (per baby)**
- Identity header with a chosen profile photo (or colour initial), name and age.
- Birth details (for the keepsake poster).
- Food and allergies (milk type, solids, diet, allergens).
- Care team: multiple doctors (pediatrician as primary, plus specialists) and a visit log.

**Album and keepsakes**
- Photo studio (canvas filters, frames, stamps).
- Monthly memory card fused with real logged data.
- Birth announcement poster.
- Then vs Now comparison.
- Milestones catalogue with progress and custom milestones.

**Multi-baby / twins**
- The single-child flow is unchanged for one baby.
- With two or more babies, per-baby timers and a "Log for" selector let you log to one or all at once.

**Design and care**
- Light and night themes.
- Pleasant rotating loading messages during image generation.
- Wellbeing-aware copy: no guilt nudges, no feeding-gap pressure, neutral allergy reminders, medical disclaimers.

---

## 3. Architecture

- **One file**: `baby-tracker.html`. All HTML, CSS and JS inline.
- **Rendering**: a single global `state` object, full re-render via `render()` on every interaction, and a 1s tick that updates live timers.
- **Fonts**: Fraunces (display) and Nunito Sans (body).
- **Persistence**: a small `Store` (app state) and `PhotoStore` (base64 photo thumbnails), each keyed in storage.
  - Inside the Claude artifact it uses `window.storage`.
  - On any normal web host it automatically falls back to `localStorage`.
  - If neither exists, it keeps state in memory for the session.

### Storage keys

- `little-log-v1`: the full app state (babies, events, settings, timers, milestones, meds, vaccines, illnesses).
- `little-log-photos-v1`: a map of photo id to base64 JPEG thumbnail.

### Data model (state)

```
state = {
  babies: [{
    id, name, fullName, color, birth, place, blood, birthWeight, birthLength, sign, parents,
    feedType,            // 'breast' | 'formula' | 'combo'
    solidsStarted, diet, // diet: 'all' | 'veg' | 'vegan'
    allergies: [..],
    avatarPhotoId,       // chosen profile photo (photoId)
    doctors: [{ id, role, name, clinic, phone, nextVisit }]
  }],
  activeBabyId,
  events: [{ id, babyId, type, time, ... }],  // type: feed | sleep | diaper | pump | note | activity | medicine | milestone | growth | vaccine | temperature | symptom | visit
  settings: { unit, wUnit, hUnit, tempUnit, theme, seen },
  timers: { [babyId]: { feed:{start,side}, sleep:{start} } },
  milestones: [..], meds: [..], photos: [..], vaccines: { [babyId]: [..] }, illnesses: [..]
}
```

Visits are stored as `events` of type `visit` (so they appear in the timeline) and can be tagged with `doctorId` and `doctorName`.

---

## 4. Run it locally

It is a static file. Any of these work:

```bash
# Option A: just open it
open baby-tracker.html         # macOS
# or double-click the file

# Option B: a tiny local server (better for testing storage)
cd <folder-with-baby-tracker.html>
python3 -m http.server 8080
# then visit http://localhost:8080/baby-tracker.html
```

On a real served page (not file://), it persists to `localStorage` on that device and browser.

---

## 5. Make it live (single-device, no accounts)

This is the fastest path to a real URL. The app runs as a static site and persists per device and browser via `localStorage`. No backend, no accounts, no sharing yet.

The repo includes a Firebase Hosting package, but any static host works (Netlify, Render static site, GitHub Pages, an S3 bucket, your own nginx).

### Firebase Hosting

Prerequisites: a Google account, Node.js installed.

```bash
# 1. Install the CLI (once)
npm install -g firebase-tools

# 2. Sign in
firebase login

# 3. From the project folder (the one containing firebase.json and public/)
#    public/index.html is the app.
firebase deploy --only hosting
```

You will be asked to pick or create a Firebase project the first time (`firebase use --add` or follow the prompt). After deploy, the CLI prints your live URL, for example `https://your-project.web.app`.

To update later, change `public/index.html` and run `firebase deploy --only hosting` again.

### Any other static host

Upload `baby-tracker.html` (rename to `index.html`) to the host's web root. That is the whole app.

### Caveat for this path

`localStorage` is per device and per browser, and is capped (roughly 5MB). With downscaled photo thumbnails that is enough for typical use, but it is not shared across phones and is not a backup. For real cross-device use, and for sharing, see the next section.

---

## 6. Make it shareable (two parents and a nanny, with an admin)

Sharing is a real backend project, not a flag. Several caregivers logging to the same baby from different phones requires a server, accounts, and access rules. Here is the design and the build order so it can be reviewed before any code goes live.

### What it needs

1. **Authentication** so each caregiver signs in (Firebase Auth: email link or Google sign-in).
2. **A shared baby document with members and roles**, enforced by Firestore security rules.
3. **An invite flow** so the owner can add the other parent and the nanny.

### Roles

- **Owner**: full control. Can edit and remove any entry, including ones created by others. Can invite and remove members. One owner per baby (transferable).
- **Caregiver**: can add entries and edit or remove their own. Cannot remove other people's entries or manage members.

### Proposed data model (Firestore)

```
/babies/{babyId}
  ownerId: <uid>
  members: { <uid>: 'owner' | 'caregiver' }   // map for fast rule checks
  profile: { name, birth, ... }

/babies/{babyId}/events/{eventId}
  authorId: <uid>
  type, time, ...

/invites/{inviteId}
  babyId, role, email (or token), createdBy, status
```

### Security rules (the contract)

```
match /babies/{babyId} {
  allow read: if request.auth != null && request.auth.uid in resource.data.members;
  allow update, delete: if request.auth != null
    && resource.data.members[request.auth.uid] == 'owner';

  match /events/{eventId} {
    allow read: if request.auth != null
      && request.auth.uid in get(/databases/$(database)/documents/babies/$(babyId)).data.members;
    allow create: if request.auth != null
      && request.auth.uid in get(/databases/$(database)/documents/babies/$(babyId)).data.members;
    // owner can edit/remove anyone's entry; caregivers only their own
    allow update, delete: if request.auth != null && (
      get(/databases/$(database)/documents/babies/$(babyId)).data.members[request.auth.uid] == 'owner'
      || resource.data.authorId == request.auth.uid
    );
  }
}
```

### Build order

1. Lock the data model and the rules above (this document is step 1).
2. Wire the app's data layer to Firestore (`store-firebase.js`) so `Store` and `PhotoStore` read and write the shared baby document and its events. Photos move to Firebase Storage rather than base64 in a key.
3. Add a minimal sign-in screen.
4. Add the invite and accept flow, and a members screen on the owner's side.
5. Real-time listeners so all three phones update live.

### Trade-offs

| | Standalone (localStorage) | Cloud (Firestore) |
|---|---|---|
| Sharing | No | Yes, multi-caregiver |
| Cost | Free | Firebase usage (free tier covers small use) |
| Offline | Full | Needs sync handling |
| Privacy | On device only | Data lives on a server you control |
| Effort | Done | A real build (auth, rules, sync, invites) |

---

## 7. File layout (Firebase package)

```
firebase/
  firebase.json          # hosting config
  firestore.rules        # security rules (single-user today; sharing rules above are the next step)
  public/
    index.html           # the app (copy of baby-tracker.html)
    firebase-init.js     # Firebase config placeholders
    store-firebase.js    # Firestore data layer (for the cloud path)
  README.md              # this document
```

---

## 8. Honest status

- The standalone app is complete and, with the storage fallback, deploys and persists on any static host today.
- Multi-caregiver sharing is designed (section 6) but not built. It is the next project, and the largest remaining item.
- Reminders only fire while the app is open (no push). True push needs the cloud path plus a service worker.
- A few smaller known items: orphaned milestone and vaccine timeline entries when un-marked, and a date-jump filter on the Log tab.
