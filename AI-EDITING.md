# AI image editing: post-beta evaluation

Decision: **defer. Re-evaluate after the beta closes**, once we know whether users actually want generative/AI photo editing (Precious-style: background swap, dreamy scenes, milestone art, dress-up).

## What's already done without any AI infra (free + private, on-device)
- **Auto-enhance** (histogram-based brightness/contrast/warmth) — shipped.
- **Planned, still on-device**: background cutout / "sticker-me" via an in-browser model (WASM/ONNX). Nothing leaves the phone.

These cover most of the *perceived* "AI enhance" gap with zero infra and no privacy tradeoff. Do these first.

## When we'd need a server-side model
Only for **generative** edits that on-device can't realistically do: replace/redraw backgrounds into new scenes, outfits, stylised milestone art, relighting. That needs a GPU.

### Model options (open-weight, self-hostable)
- **Qwen-Image-Edit** (Alibaba) — instruction-based image editing; good fit for "change the background to a meadow", relight, tidy. Open weights, runs on a single modern GPU.
- **Seedream / Seedance** (ByteDance) — note: Seedance is video-gen, Seedream is image-gen; image is what we'd want. Seedream weights are less openly self-hostable than Qwen; check licensing.
- Others to compare at eval time: FLUX.1 Kontext (edit), SDXL + IP-Adapter/inpaint.
- Pick by: edit quality on baby photos, license (commercial OK), VRAM needed, and identity preservation (the baby must still look like the baby).

### Hosting: don't start with an always-on VM
- **Serverless GPU first** (Replicate / RunPod / Modal / Fal): pay-per-second, ~cents per image, zero idle cost. Right for beta-scale and validating demand.
- **Dedicated GPU VM** (L4/A10, ~$300–800/mo) only once volume makes per-call cheaper than always-on. Premature for a 20-user beta.
- Either way it's **new paid infra** → must be a **Pro** feature so it pays for itself (see PAYWALL.md).

### Privacy: the important nuance
- Our current promise is "no third-party trackers, we never sell your data," and on-device AI keeps photos on the phone.
- Server-side AI means **baby photos leave the device to a backend** (ours or a GPU provider). That's a real change:
  - Make it **opt-in per photo**, clearly labelled, Pro-only.
  - Update the privacy copy honestly for that feature ("photos you choose to AI-edit are processed on our secure servers and not stored/used to train"). Do NOT keep claiming "never leaves your device" for it.
  - **Self-hosting (our VM)** keeps it out of third parties and is better for the privacy story than a third-party API, but costs more ops. A provider that contractually doesn't train on inputs is the middle ground.

## Evaluation checklist (run post-beta)
1. Did beta users ask for generative edits, or were Auto-enhance + cutout enough?
2. Would they pay for it (Pro)? At what price?
3. Test 2–3 models on real baby photos for quality + identity preservation.
4. Cost per image on serverless GPU × expected volume vs a VM.
5. Privacy/consent copy + storage policy signed off before launch.
6. Ship as opt-in Pro, serverless first, watermark/limit on free if offered at all.
