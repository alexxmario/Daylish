# Daylish — illustration prompt pack

22 illustrations, plus an app icon and splash mark.

Every prompt below is **complete and self-contained** — copy one block, paste it
into the generator, done. The style paragraph is repeated inside each one on
purpose, so you never have to assemble anything or remember what the last image
used.

Every slot already exists in the app and draws a procedural placeholder, so you
can generate these in any order and watch each one land as it arrives.

---

## Installing a finished image

1. Save it to `apps/mobile/assets/illustrations/` with the exact filename given.
2. Add one line to `ILLUSTRATION_SOURCES` in
   `apps/mobile/src/illustrations/registry.ts`:

```ts
export const ILLUSTRATION_SOURCES = {
  welcome: require('../../assets/illustrations/welcome.png'),
  goal: require('../../assets/illustrations/goal.png'),
};
```

No other code changes. A slot with no entry keeps its placeholder.

---

## What makes these cohere

Read this once before generating — it explains *why* the prompts are worded the
way they are, so you can judge a result rather than just accepting it.

**One palette, four colours, always the same four.**

| Role | Hex | Where it goes |
|---|---|---|
| Primary | `#74ACDF` light sky blue | The main shapes — plates, containers, large forms |
| Secondary | `#FBEFC0` pale butter | Fills, food, softer supporting shapes |
| Accent | `#F6B40E` golden yellow | **Exactly one element per image.** Never two. |
| Line | `#16232E` deep navy | Thin outlines and small details only |

The single-gold-accent rule is the strongest cohesion device in the set. Each
prompt below names which element gets it. If a generated image has gold in three
places, regenerate — it will read as louder than its neighbours.

**One viewpoint.** Everything is either directly overhead or straight-on at eye
level. No three-quarter angles, no perspective vanishing points. Mixed
viewpoints are the fastest way to make a set look assembled from stock.

**One scale.** The subject fills roughly 70% of the frame width in every image,
centred, with even margins. A tight close-up next to a wide scene reads as
inconsistent even when the style matches perfectly.

**Flat means flat.** No gradients, no shadows, no highlights, no paper texture.
The moment one image has a soft shadow, it separates from the other 21.

**Hard requirements**

- **Transparent PNG.** These sit on white cards *and* pale blue backgrounds. A
  baked-in background shows as a visible rectangle.
- **No text, letters or numbers.** The app supplies all copy. Text inside
  artwork cannot be translated and will eventually be wrong.
- **No human faces or bodies.** This is a food app for people of every size; a
  depicted body implies a target one. Hands alone are fine.
- **No scales-under-feet, tape measures round waists, or before/after framing.**
  That vocabulary undoes the product's whole non-judgmental stance.
- Export at **3×** the listed pixel size for modern iPhone screens.

**A trick worth using:** generate `welcome.png` first and get it right. Then feed
it back as a style reference image for the remaining 21. Most generators hold
style far more reliably from an image reference than from repeated wording.

---

## Negative prompt

Paste into the negative field for every image:

```
text, letters, numbers, words, captions, watermark, signature, logo, human figure, person, face, body, torso, silhouette, bathroom scales, tape measure around waist, before and after comparison, weight loss imagery, gradient, drop shadow, cast shadow, glossy highlight, 3D render, photorealistic, realistic photo, clipart, sticker, heavy black outline, thick borders, busy background, background rectangle, opaque background, filled backdrop, cluttered, noisy texture, grain, muted grey, red, purple, dark colours, neon
```

---

# Onboarding — 10 images

The first thing anyone sees, one per question. These carry the most weight in
the whole set.

**Export 1200 × 800 px (3:2), transparent PNG.**

---

### 1 · `welcome.png` — the hero

Generate this one first and use it as your style reference for the rest.

```
Flat vector editorial illustration on a fully transparent background. A generously laid table seen from directly overhead, showing a whole day of food at once: a breakfast bowl, a lunch plate, a small snack dish and a dinner plate, arranged in a gentle arc across the frame, with a few loose pieces of fruit and a steaming mug filling the gaps.

Strict four-colour palette: light sky blue #74ACDF for the plates and large shapes, pale butter yellow #FBEFC0 for the food and softer fills, deep navy #16232E for thin linework only. Exactly one element in warm golden yellow #F6B40E — the steaming mug — and nothing else in gold.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all; many shapes have none. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Directly overhead viewpoint with no perspective distortion. Composition centred, subject filling about 70% of the frame width, generous even margins on all sides. Warm, abundant, inviting, calm. No text, letters or numbers anywhere.
```

---

### 2 · `goal.png` — what are you here to do

```
Flat vector editorial illustration on a fully transparent background. Three empty plates in a single row seen from directly overhead, evenly spaced, the middle plate slightly larger than the two beside it. Each holds a simple loose arrangement of a few food shapes. No arrows, no comparison marks, no ranking.

Strict four-colour palette: light sky blue #74ACDF for the plates, pale butter yellow #FBEFC0 for the food on them, deep navy #16232E for thin linework only. Exactly one element in warm golden yellow #F6B40E — a single small round food item on the centre plate — and nothing else in gold.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Directly overhead viewpoint with no perspective distortion. Composition centred and horizontally balanced, subject filling about 70% of frame width, generous even margins. Balanced, calm, neutral — no plate should look like the "right" answer. No text, letters or numbers anywhere.
```

---

### 3 · `pace.png` — how fast

```
Flat vector editorial illustration on a fully transparent background. A single very gentle slope descending from upper left to lower right, drawn as a smooth wide ribbon or soft path with rounded ends. Four or five small round dots rest along its length at even intervals. The gradient of the slope is shallow and unhurried — never a steep drop or a cliff.

Strict four-colour palette: light sky blue #74ACDF for the ribbon, pale butter yellow #FBEFC0 for the resting dots, deep navy #16232E for thin linework only. Exactly one element in warm golden yellow #F6B40E — the final dot at the lower right end — and nothing else in gold.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Straight-on viewpoint with no perspective. Composition centred, subject filling about 70% of frame width, generous even margins. Unhurried, gentle, reassuring. No text, letters, numbers or axis marks anywhere.
```

---

### 4 · `body.png` — height and weight

```
Flat vector editorial illustration on a fully transparent background. A pair of simple flat kitchen scales with a shallow bowl resting on the platform, seen straight on from the side, beside a soft cloth measuring tape lying loosely curled and flat on the surface. Kitchen objects only — absolutely no person, no bathroom scales, no tape measured around anything.

Strict four-colour palette: light sky blue #74ACDF for the scales and bowl, pale butter yellow #FBEFC0 for the measuring tape, deep navy #16232E for thin linework only. Exactly one element in warm golden yellow #F6B40E — a small piece of fruit in the bowl — and nothing else in gold.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Straight-on eye-level viewpoint with no perspective distortion. Composition centred, subject filling about 70% of frame width, generous even margins. Practical, everyday, matter-of-fact. No text, letters, numbers or dial markings anywhere.
```

---

### 5 · `age.png` — year of birth

```
Flat vector editorial illustration on a fully transparent background. A single slice of layer cake on a small round plate, seen straight on from the side so the layers are visible as clean horizontal bands, with one slim unlit candle standing upright in the top. Understated and cheerful — one slice, not a whole cake, not a party scene.

Strict four-colour palette: light sky blue #74ACDF for the plate and cake layers, pale butter yellow #FBEFC0 for the filling bands and frosting, deep navy #16232E for thin linework only. Exactly one element in warm golden yellow #F6B40E — the candle — and nothing else in gold.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Straight-on eye-level viewpoint with no perspective distortion. Composition centred, subject filling about 70% of frame width, generous even margins. Quietly celebratory, warm, simple. No text, letters or numbers anywhere.
```

---

### 6 · `activity.png` — how much you move

```
Flat vector editorial illustration on a fully transparent background. A pair of trainers seen from the side, next to a single bicycle wheel and a rolled-up yoga mat standing on its end, arranged loosely in a row with clear space between them. Objects only — absolutely no person, no motion lines, no sweat, no gym equipment.

Strict four-colour palette: light sky blue #74ACDF for the trainers and wheel, pale butter yellow #FBEFC0 for the rolled mat, deep navy #16232E for thin linework only including the wheel spokes. Exactly one element in warm golden yellow #F6B40E — the laces of the trainers — and nothing else in gold.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Straight-on eye-level viewpoint with no perspective distortion. Composition centred, objects filling about 70% of frame width, generous even margins. Everyday, unintimidating, calm — not sporty or aspirational. No text, letters or numbers anywhere.
```

---

### 7 · `diet.png` — how you eat

```
Flat vector editorial illustration on a fully transparent background. An overhead spread of varied ingredients laid out loosely with clear space between each: a few whole vegetables, a shallow bowl of grains, a fillet of fish, a small dish of olives and a sprig of leafy herb. Arranged as a relaxed scatter rather than a tidy grid.

Strict four-colour palette: light sky blue #74ACDF for the bowls, dishes and larger vegetable forms, pale butter yellow #FBEFC0 for the grains, fish and softer shapes, deep navy #16232E for thin linework only. Exactly one element in warm golden yellow #F6B40E — the small dish of olives — and nothing else in gold.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Directly overhead viewpoint with no perspective distortion. Composition centred and evenly weighted, subject filling about 70% of frame width, generous even margins. Abundant, varied, fresh, appetising. No text, letters or numbers anywhere.
```

---

### 8 · `allergens.png` — anything to keep out

Tone matters more here than anywhere else in the set. This must read as *careful*,
never as *warning*.

```
Flat vector editorial illustration on a fully transparent background. Five small bowls seen from directly overhead, four of them clustered loosely together and one set gently apart to the right, with a soft thin circle drawn around the separated bowl. Calm and careful — absolutely no warning triangle, no exclamation mark, no cross, no prohibition sign, no red of any kind.

Strict four-colour palette: light sky blue #74ACDF for the bowls and the soft circle, pale butter yellow #FBEFC0 for the contents of the bowls, deep navy #16232E for thin linework only. Exactly one element in warm golden yellow #F6B40E — the contents of the separated bowl — and nothing else in gold.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Directly overhead viewpoint with no perspective distortion. Composition centred, subject filling about 70% of frame width, generous even margins. Careful, gentle, considerate — never alarming. No text, letters or numbers anywhere.
```

---

### 9 · `kitchen.png` — what your kitchen is like

```
Flat vector editorial illustration on a fully transparent background. A simple kitchen counter seen straight on from the front, with four appliances in a clean row along it: a hob with two round rings, an oven door with a handle, a blender with a tapered jug, and a kettle. Drawn as clean flat geometric shapes, evenly spaced, sitting on a single horizontal counter line.

Strict four-colour palette: light sky blue #74ACDF for the appliance bodies, pale butter yellow #FBEFC0 for the counter surface and secondary panels, deep navy #16232E for thin linework, handles and dials. Exactly one element in warm golden yellow #F6B40E — one lit hob ring — and nothing else in gold.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Straight-on front viewpoint with no perspective distortion. Composition centred and horizontally balanced, subject filling about 70% of frame width, generous even margins. Tidy, practical, welcoming. No text, letters, numbers or control markings anywhere.
```

---

### 10 · `targets.png` — here is where you land

The payoff screen. This should feel like the most optimistic image in onboarding.

```
Flat vector editorial illustration on a fully transparent background. A full day of food laid out left to right in a gentle row seen from directly overhead — a breakfast bowl, a lunch plate, a small snack dish and a dinner plate — with a simple round sun shape rising above the row, its lower edge just behind the plates.

Strict four-colour palette: light sky blue #74ACDF for the plates and bowls, pale butter yellow #FBEFC0 for the food on them, deep navy #16232E for thin linework only. Exactly one element in warm golden yellow #F6B40E — the rising sun — and nothing else in gold.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no rays radiating from the sun, no texture. Directly overhead viewpoint for the food, with the sun as a flat graphic shape behind it. Composition centred and horizontally balanced, subject filling about 70% of frame width, generous even margins. Optimistic, complete, satisfying. No text, letters or numbers anywhere.
```

---

# Empty states — 6 images

Shown when a screen has nothing in it yet. These must read as an **invitation**,
not an apology — something about to begin, not something missing.

**Export 1200 × 700 px, transparent PNG.**

---

### 11 · `empty-day.png` — nothing logged yet

The most-seen empty state in the app.

```
Flat vector editorial illustration on a fully transparent background. A single clean empty plate seen from directly overhead, with a fork and a knife resting neatly beside it and one small sprig of fresh herb placed to one side of the plate. Calm and ready — waiting, not sad or abandoned.

Strict four-colour palette: light sky blue #74ACDF for the plate, pale butter yellow #FBEFC0 for the cutlery, deep navy #16232E for thin linework only. Exactly one element in warm golden yellow #F6B40E — the sprig of herb — and nothing else in gold.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Directly overhead viewpoint with no perspective distortion. Composition centred, subject filling about 70% of frame width, generous even margins. Quiet, ready, inviting. No text, letters or numbers anywhere.
```

---

### 12 · `empty-recipes.png` — no recipes yet

```
Flat vector editorial illustration on a fully transparent background. A closed recipe book lying flat, seen from directly overhead, with a slim ribbon bookmark trailing out from the pages and a small sprig of rosemary resting diagonally across the cover.

Strict four-colour palette: light sky blue #74ACDF for the book cover, pale butter yellow #FBEFC0 for the visible page edges, deep navy #16232E for thin linework only. Exactly one element in warm golden yellow #F6B40E — the ribbon bookmark — and nothing else in gold.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Directly overhead viewpoint with no perspective distortion. Composition centred, subject filling about 70% of frame width, generous even margins. Closed but full of promise. No text, letters, numbers or title on the cover.
```

---

### 13 · `empty-pantry.png` — nothing in your pantry

```
Flat vector editorial illustration on a fully transparent background. Two open kitchen shelves seen straight on from the front, holding a handful of jars and tins of varying heights grouped toward one side, leaving clear open space along the rest of both shelves. Sparse but not bare.

Strict four-colour palette: light sky blue #74ACDF for the shelf structure, pale butter yellow #FBEFC0 for the jars and tins, deep navy #16232E for thin linework, lids and jar rims. Exactly one element in warm golden yellow #F6B40E — the contents of one tall jar — and nothing else in gold.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Straight-on front viewpoint with no perspective distortion. Composition centred, subject filling about 70% of frame width, generous even margins. Room to fill, calm, orderly. No text, letters, numbers or jar labels anywhere.
```

---

### 14 · `empty-plan.png` — nothing planned this week

```
Flat vector editorial illustration on a fully transparent background. Seven blank rounded cards arranged in a row like the days of a week, slightly overlapping each other in sequence, with one card near the middle tilted a few degrees out of alignment. The cards are empty — no content drawn on them.

Strict four-colour palette: light sky blue #74ACDF for most of the cards, pale butter yellow #FBEFC0 for two or three cards to break the rhythm, deep navy #16232E for thin linework only. Exactly one element in warm golden yellow #F6B40E — the single tilted card — and nothing else in gold.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Straight-on viewpoint with no perspective distortion. Composition centred and horizontally balanced, subject filling about 70% of frame width, generous even margins. Empty but ready, orderly with one relaxed note. No text, letters, numbers or marks on the cards.
```

---

### 15 · `empty-progress.png` — not enough data yet

```
Flat vector editorial illustration on a fully transparent background. A soft smooth line beginning at the lower left and rising gently toward the middle of the frame, then stopping — leaving the entire right half of the frame open and empty. Three small round dots sit along the drawn portion of the line. No axes, no grid, no chart frame.

Strict four-colour palette: light sky blue #74ACDF for the line, pale butter yellow #FBEFC0 for the dots, deep navy #16232E for thin linework only. Exactly one element in warm golden yellow #F6B40E — the final dot where the line stops — and nothing else in gold.

Simple rounded organic shapes with soft corners and rounded line caps. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Straight-on viewpoint with no perspective. Composition weighted to the left with deliberate open space on the right, subject filling about 70% of frame width, generous even margins. A beginning, full of room ahead. No text, letters, numbers or axis labels anywhere.
```

---

### 16 · `empty-search.png` — nothing found

```
Flat vector editorial illustration on a fully transparent background. A magnifying glass with a simple round lens and a straight handle, resting at a slight angle over an open larder cupboard filled with simple rounded food shapes — jars, a loaf, a few pieces of fruit. The lens overlaps the cupboard contents without distorting them.

Strict four-colour palette: light sky blue #74ACDF for the magnifying glass and cupboard frame, pale butter yellow #FBEFC0 for the food shapes inside, deep navy #16232E for thin linework only. Exactly one element in warm golden yellow #F6B40E — the rim of the magnifying lens — and nothing else in gold.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no glass reflections, no highlights, no texture. Straight-on front viewpoint with no perspective distortion. Composition centred, subject filling about 70% of frame width, generous even margins. Curious and helpful, not frustrated. No text, letters or numbers anywhere.
```

---

# Feature moments — 6 images

Shown inside cards to explain a feature, rendered at roughly 110pt tall — so keep
these **simpler and bolder** than the onboarding set. Fewer objects, larger.

**Export 1200 × 700 px, transparent PNG.**

---

### 17 · `scan-miss.png` — barcode not found

Must read as light and playful, never as an error.

```
Flat vector editorial illustration on a fully transparent background. A barcode drawn as a row of simple vertical bars of varying widths, with one single bar lifted gently away from the row and floating just above its gap, tilted slightly. A small curved swoosh sits nearby suggesting a question, without drawing an actual question mark character.

Strict four-colour palette: light sky blue #74ACDF for the bars, pale butter yellow #FBEFC0 for the surface the barcode sits on, deep navy #16232E for thin linework only. Exactly one element in warm golden yellow #F6B40E — the single lifted floating bar — and nothing else in gold.

Simple rounded shapes with soft rounded bar ends. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Straight-on viewpoint with no perspective distortion. Composition centred, subject large and filling about 70% of frame width, generous even margins. Light, playful, unbothered — not an error state. No text, letters, numbers or readable barcode digits anywhere.
```

---

### 18 · `prep-day.png` — cook once, eat all week

```
Flat vector editorial illustration on a fully transparent background. Five identical food containers with lids, filled and lined up in a neat evenly spaced row seen straight on from the front, with gentle curling steam rising from the one at the centre whose lid is slightly ajar.

Strict four-colour palette: light sky blue #74ACDF for the container bodies, pale butter yellow #FBEFC0 for the visible food inside them, deep navy #16232E for thin linework, lid edges and the steam curls. Exactly one element in warm golden yellow #F6B40E — the ajar lid of the centre container — and nothing else in gold.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Straight-on front viewpoint with no perspective distortion. Composition centred and horizontally balanced, subject filling about 70% of frame width, generous even margins. Organised, satisfying, warm. No text, letters, numbers or container labels anywhere.
```

---

### 19 · `reverse-logging.png` — tell it what you want

The point of this image is *permission*. It should feel relaxed and generous.

```
Flat vector editorial illustration on a fully transparent background. A single wedge slice of pizza sitting on a large round plate seen from directly overhead, with generous empty space on the plate all around the slice. The slice is appealing and well-drawn — this is a treat being welcomed, not restricted.

Strict four-colour palette: light sky blue #74ACDF for the plate, pale butter yellow #FBEFC0 for the pizza base and cheese, deep navy #16232E for thin linework only. Exactly one element in warm golden yellow #F6B40E — the toppings on the slice — and nothing else in gold.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Directly overhead viewpoint with no perspective distortion. Composition centred with the slice offset slightly so the empty plate space reads as deliberate, subject filling about 70% of frame width, generous even margins. Relaxed, permissive, generous — never guilty. No text, letters or numbers anywhere.
```

---

### 20 · `cook-from-pantry.png` — cook with what you have

```
Flat vector editorial illustration on a fully transparent background. An open cupboard door seen straight on from the front, with a wooden chopping board in front of it holding a few gathered ingredients — a couple of vegetables, a jar and a small bunch of herbs. One simple hand may reach in from the side placing an item down; no arm, no body, no face.

Strict four-colour palette: light sky blue #74ACDF for the cupboard and door, pale butter yellow #FBEFC0 for the chopping board and hand, deep navy #16232E for thin linework only. Exactly one element in warm golden yellow #F6B40E — one vegetable on the board — and nothing else in gold.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no wood grain texture. Straight-on front viewpoint with no perspective distortion. Composition centred, subject filling about 70% of frame width, generous even margins. Resourceful, homely, capable. No text, letters, numbers or jar labels anywhere.
```

---

### 21 · `weekly-report.png` — your week, explained

```
Flat vector editorial illustration on a fully transparent background. A single rounded card or sheet seen straight on, with a simple row of four bars of varying heights drawn on its lower half and a soft rising line curving across above them. A small round sun shape sits in the upper right corner of the card. The marks are purely graphic — no readable values.

Strict four-colour palette: light sky blue #74ACDF for the card, pale butter yellow #FBEFC0 for the bars, deep navy #16232E for the thin rising line and fine linework. Exactly one element in warm golden yellow #F6B40E — the small sun in the corner — and nothing else in gold.

Simple rounded shapes with soft corners and rounded bar tops. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Straight-on viewpoint with no perspective distortion. Composition centred, subject filling about 70% of frame width, generous even margins. Clear, summarising, calm. No text, letters, numbers, axis labels or tick marks anywhere.
```

---

### 22 · `premium.png` — Daylish Premium

The most abundant and colourful image in the set — it is selling generosity.

```
Flat vector editorial illustration on a fully transparent background. A table seen from directly overhead, generously covered with many small dishes and bowls of varied food arranged close together in a loose overlapping cluster that fills the frame — a shared feast rather than a single plated meal.

Strict four-colour palette: light sky blue #74ACDF for the dishes and bowls, pale butter yellow #FBEFC0 for the majority of the food, deep navy #16232E for thin linework only. Warm golden yellow #F6B40E may appear on up to three small food items here — this is the one image in the set permitted more than a single gold accent, to read as the most abundant.

Simple rounded organic shapes with soft corners. Thin uniform 2px navy outlines where outlines appear at all. Completely flat: no gradients, no shading, no drop shadows, no highlights, no sparkles, no crowns, no stars, no texture. Directly overhead viewpoint with no perspective distortion. Composition centred and densely filled, subject filling about 80% of frame width, even margins. Abundant, warm, generous, celebratory. No text, letters or numbers anywhere.
```

---

# App icon and splash

Different rules from the illustrations — read carefully.

### `apps/mobile/assets/icon.png` — 1024 × 1024, **opaque**

**Rules that differ from the illustrations:** fully opaque, no transparency, and
**no rounded corners** — iOS applies its own mask, and a pre-rounded icon gets
double-rounded and looks visibly wrong. Keep everything well inside the frame,
because that mask crops the corners.

**Two things the illustration style must bend for here**

1. **More detail, not less.** An icon at 60pt is 180 × 180 real pixels on a
   modern iPhone — plenty for a recognisable object. The minimalist reduction
   that works inside the app fails on a home screen, because a shape stripped to
   two circles could be a record, a lens, a target or a loading spinner. What
   makes something readable at small size is a **characteristic silhouette plus
   enough internal detail to confirm it**, not fewer shapes.

2. **Food gets food colours.** Everywhere else in the set, celeste and butter
   carry everything. That cannot work here: blue food reads as inedible, and an
   icon of a blue meal is an icon of something you would not eat. So the plate,
   bowl or frame stays brand celeste `#74ACDF`, and the food on it uses a small
   extended palette:

   | Extra colour | Hex | For |
   |---|---|---|
   | Fresh green | `#5CA76B` | Greens, herbs, vegetables |
   | Warm coral | `#E5734F` | Protein, tomato, roasted things |
   | Deep cream | `#F4E3B8` | Grains, rice, bread, egg white |

   Gold `#F6B40E` still appears exactly once, and navy `#16232E` is still
   linework only.

**What an icon has to do that an illustration doesn't**

- Read at **60 × 60 px** on a home screen, and at 29px in Settings.
- Say "food" to someone who has **never opened the app**.
- Hold its own beside Instagram and WhatsApp, on light *and* dark wallpapers.
- Not look like the category. Most food apps reach for a bare fork, an apple, a
  flame, a leaf, or a progress ring — the ring especially, which is
  MyFitnessPal, Lose It and half the App Store. Avoid all five.

Three concepts below. Generate all three and judge them at actual size — the one
that wins full-screen is often not the one that wins at 60px.

---

#### Concept A — "The plate" *(recommended)*

A proper plated meal seen from overhead: protein, greens and grain, arranged in
three clear portions on a celeste plate. Unmistakably food from the first glance,
and the three-colour split is what makes it legible small — the eye reads
*a meal* before it resolves any single item.

```
Flat vector app icon, 1024x1024, fully opaque square with no transparency and no rounded corners. A single dinner plate seen from directly overhead, centred and filling most of the frame, drawn as a bold light sky blue #74ACDF circle with a slightly darker blue rim. On the plate, three clearly separated portions of food arranged in a balanced triangle: a piece of grilled protein in warm coral #E5734F with two or three darker char lines across it, a small cluster of green leaves and broccoli in fresh green #5CA76B, and a rounded scoop of grains in deep cream #F4E3B8 with a few visible grain marks. A single small cherry tomato in warm golden yellow #F6B40E sits beside the greens as the one gold accent.

Solid pale butter yellow #FBEFC0 background filling the entire square edge to edge. Deep navy #16232E for thin outlines around the plate and food only, 3px weight, no heavier.

Detailed enough that each food item is individually recognisable at 60x60 pixels, while the whole still reads instantly as a plated meal. Completely flat: no gradients, no shading, no drop shadows, no highlights, no texture. Perfectly centred with generous margins so nothing is clipped by the iOS icon mask. No text, letters, numbers, logos or cutlery.
```

---

#### Concept B — "Sunny side up"

A fried egg where the yolk doubles as a rising sun. The fix from the earlier
version is the silhouette: a real fried egg has a **wobbly, irregular white**,
and that irregularity is the entire recognition cue. A perfect ring reads as a
target; a lopsided organic blob reads as an egg immediately.

```
Flat vector app icon, 1024x1024, fully opaque square with no transparency and no rounded corners. A single fried egg seen from directly overhead, centred and filling most of the frame. The egg white is an organic, irregular, deliberately lopsided blob shape in deep cream #F4E3B8 with soft rounded bulges of clearly uneven size around its edge — never a circle, never symmetrical. A large solid warm golden yellow #F6B40E yolk sits slightly off-centre within it, reading equally as a yolk and as a rising sun. Beneath the egg, a shallow light sky blue #74ACDF pan or plate edge is visible as a curved band across the lower part of the frame, with two small green herb leaves in fresh green #5CA76B resting beside the egg.

Solid pale butter yellow #FBEFC0 background filling the entire square edge to edge. Deep navy #16232E for thin outlines around the egg white, yolk and pan only, 3px weight, no heavier.

The irregular wobbly outline of the egg white is essential and must be pronounced enough to read at 60x60 pixels. Completely flat: no gradients, no shading, no drop shadows, no glossy highlights on the yolk, no steam, no texture. Centred with generous margins so nothing is clipped by the iOS icon mask. No text, letters, numbers, logos or cutlery.
```

---

#### Concept C — "The bowl"

A filled bowl seen three-quarters from the front, with contents visibly heaped
above the rim. The heaped silhouette is more distinctive in a grid of round
icons than a flat circle, and the visible layers make it obviously food.

```
Flat vector app icon, 1024x1024, fully opaque square with no transparency and no rounded corners. A single deep bowl seen from a slight three-quarter front angle, centred and filling most of the frame, drawn as a bold light sky blue #74ACDF rounded form with a clear elliptical rim. Food is heaped generously above the rim so the silhouette is domed, not flat: a bed of grains in deep cream #F4E3B8, a folded piece of protein in warm coral #E5734F, several green leaves in fresh green #5CA76B rising above the rim, and one bright round garnish in warm golden yellow #F6B40E as the single gold accent. A small wedge of the bowl interior is visible behind the food.

Solid pale butter yellow #FBEFC0 background filling the entire square edge to edge. Deep navy #16232E for thin outlines around the bowl and each food element only, 3px weight, no heavier.

Detailed enough that the individual ingredients are distinguishable at 60x60 pixels, with a domed heaped silhouette that stays recognisable when small. Completely flat: no gradients, no shading, no drop shadows, no highlights, no steam, no texture. Centred with generous margins so nothing is clipped by the iOS icon mask. No text, letters, numbers, logos, cutlery or chopsticks.
```

---

#### If a result still reads as mush at small size

The usual causes, in the order they actually happen:

- **Too many items.** Three food elements is the ceiling. Four is where it turns
  to soup. Drop one and regenerate.
- **Colours too close in value.** Cream and butter next to each other vanish.
  Ask for "stronger value contrast between adjacent food items."
- **Outlines too thin.** Bump the linework from 3px to 5px — icons carry heavier
  outlines than in-app illustration, and this is the single most effective fix.
- **Subject too small in frame.** Add "the subject fills 85% of the frame" and
  regenerate.

#### Colour inversion to try

Each concept is written butter-on-blue. Also generate one with **celeste
`#74ACDF` as the background** and the plate or bowl in cream `#F4E3B8` — food
colours stay as they are. Blue-backed icons hold up better against busy
wallpapers; butter-backed ones feel warmer and more appetising. You cannot pick
between them without seeing both on a real home screen.

#### How to judge them

Do this before committing — two minutes, and it is the only test that matters:

1. Export each candidate at **60 × 60 px** and look at it at that size, not zoomed.
2. Put them on an actual home screen beside your real apps.
3. Squint. The winner is the one whose shape still reads.
4. Check a light and a dark wallpaper.
5. Show someone who has never seen Daylish. If they say "food" or "eating", it
   works. If they say "timeline", "settings" or "I can't tell", it does not.

### `apps/mobile/assets/splash-icon.png` — 1024 × 1024, transparent

The same mark as your chosen icon, with **no background** and much wider margins.
A splash mark can afford to be a touch simpler than the icon, because it appears
large and briefly. Adapt whichever concept you picked — this is Concept A:

```
Flat vector logo mark on a fully transparent background, centred with very generous margins. A dinner plate seen from directly overhead, drawn as a light sky blue #74ACDF circle with a slightly darker rim, holding three clearly separated portions of food: grilled protein in warm coral #E5734F, green leaves in fresh green #5CA76B, and a scoop of grains in deep cream #F4E3B8, with one small round garnish in warm golden yellow #F6B40E. Deep navy #16232E for thin 3px outlines only. Completely flat: no gradients, no shadows, no highlights, no background shape or square of any kind. No text, letters, numbers or cutlery.
```

### `apps/mobile/assets/favicon.png` — 48 × 48

Web build only, and small enough that the icon's detail will not survive. Do not
shrink the full mark — export a **simplified** version instead: the plate circle
with a single gold garnish, or the egg white and yolk alone. Check the shapes
still separate at 48px rather than merging into one blob.
---

# Generation order

Biggest visible improvement first:

1. **`welcome`** — get this right, then use it as a style reference for everything else.
2. **`goal`, `body`, `activity`, `diet`** — the onboarding steps everyone passes through.
3. **`empty-day`, `empty-recipes`** — the two most-hit empty states.
4. **`pace`, `age`, `allergens`, `kitchen`, `targets`** — the rest of onboarding.
5. The remaining empty states and feature moments.
6. Icon and splash last, once the visual language is settled.

# Checking a result before you keep it

- Is the background genuinely transparent, or is there a white rectangle?
- Is there gold in exactly one place? (Except `premium`, which allows three.)
- Any text, numbers or tick marks that crept in?
- Same viewpoint as its neighbours — overhead where specified, straight-on where specified?
- Does the subject fill about the same share of the frame as the last one?
- Any shadow, gradient or glossy highlight? Even a subtle one breaks the set.
- Placed next to the previous image, do they look like they were made by the same hand?
