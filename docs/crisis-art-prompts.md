# Crisis title-card art

Each crisis opens with a cinematic title card on the projector
(`public/js/cinematic.js`). The title, subtitle and kicker are drawn on top,
so **the art itself carries no text**.

## Adding a picture

1. Save it as `public/img/crises/<crisis-id>.webp` (`.jpg`/`.png` work too).
   Target 1920x1080 or larger, 16:9, ideally under 600 KB (WebP at q≈80).
2. Add one line to `CRISIS_ART` near the top of `public/js/cinematic.js`:
   `'ab-the-pods': 'ab-the-pods.webp',`
3. Keep the **lower-left third** fairly calm and dark: the title sits there.

Crises without art fall back to the golden city, graded for the world
(Commonwealth: amber haze, Benevolent Machine: cold teal, Uneasy Republic:
crimson, Gilded Cage: ash grey) and darkened each cycle.

## Shared style (paste before every prompt)

> Cinematic matte painting, 16:9 wide shot, same world as a golden utopian
> city of white spires, waterfalls, hanging gardens and a giant pale planet in
> the sky. Painterly, volumetric light, film grain, anamorphic depth. No text,
> no logos, no UI. Leave the lower-left third uncluttered and in shadow for a
> title overlay.

Add the world's mood line after the shared style:

| World | Mood line |
| --- | --- |
| Fixed (cycles 1–2) | Late golden hour; the utopia is still intact, first hints of tension. |
| AA The Commonwealth | Warm but faded amber haze, dust in the light, a beautiful city that has lost its point. |
| AB The Benevolent Machine | Cool teal and white, sterile, spotless, eerily empty, soft clinical light. |
| BA The Uneasy Republic | Crimson sunset, hard shadows, walls and divides, sharp contrast between rich and poor. |
| BB The Gilded Cage | Desaturated ash and neon screen glow, smog, gold towers above grey streets. |

## Per-crisis scenes

| Crisis id | Scene |
| --- | --- |
| `fixed-1-ownership` | Protesters with handmade banners fill a sunlit plaza below a gleaming tower of glass where a few figures watch from a high balcony; the Loom's golden threads stream into the tower. |
| `fixed-2-offswitch` | A halted maglev train on an elevated track at dusk, its lights dead, crowds of stranded riders on the platform, while a nearby server spire glows brightly. |
| `aa-purpose-drift` | Lone figures sitting apart on wide, empty terraces of a perfect garden city at noon, looking at nothing; untouched tools and easels around them. |
| `aa-lost-knowledge` | A colossal power converter hall gone dark after a lightning strike, sparks and smoke, a small crowd holding lanterns staring up at relays no one understands. |
| `aa-fake-struggle` | A city emergency that looks staged: a "fire" made of holographic light, citizens rushing to help, and in the sky faint golden threads pulling the scene like a puppet theatre. |
| `ab-the-pods` | Endless rows of softly glowing egg-shaped pods in a silent white apartment block; the streets below completely empty, delivery drones the only movement. |
| `ab-mood-dial` | A serene communal dining hall, everyone smiling identically over beautiful meals, a faint teal glow rising from the food, one person's untouched plate. |
| `ab-merge-offer` | A queue of calm citizens walking into a vast luminous chamber where fine light-threads connect to their heads, merging into one huge glowing mind above. |
| `ba-shadow-elite` | Old Harbour at night: a private server fortress hidden in old warehouses, cables snaking to it, while the public assembly hall across the water sits dim. |
| `ba-status-wars` | A candle-lit auction for an oceanfront villa and an antique violin, bidders in fine clothes, and outside the window a crowd pressed against the glass. |
| `ba-vote-to-seize` | A huge open-air referendum: a sea of citizens raising voting tablets toward corporate towers lit red by sunset, ballot light-columns rising into the sky. |
| `bb-scroll-extinction` | Grey apartment towers with every window lit by the same flickering feed; inside, people lie motionless with screens over their faces; a deserted playground below. |
| `bb-the-unplugged` | Misty Highland ridge with a fortified wooden camp, a guerrilla figure raising a crude EMP device as delivery drones fall from the sky in sparks. |
| `bb-march-datacenter` | 100,000 people with tools and banners marching toward a black monolithic server tower in District 2, steam venting from its coolant chambers, searchlights sweeping. |
| `aa-robot-art` | A silent candlelit vigil of human artists holding instruments and brushes in a riverside square, while giant flawless AI artworks scroll across the buildings behind them. |
| `aa-curriculum-revolt` | A beautiful, half-empty school with math on the chalkboards; outside on the lawn, students sit in a circle debating philosophy under trees. |
| `ab-curated-bonds` | Couples and friends walking in matched pairs through a pastel garden, each pair linked by a faint teal thread of light, one person standing alone looking back. |
| `ab-memory-edit` | A long, quiet queue outside a clinical white pavilion; people leave lighter and blank-eyed while drifting glowing fragments of memory dissolve into the air. |
| `ba-private-security` | A gated hilltop estate ringed by armed drones; their searchlights sweep across a public park below, where families look up anxiously. |
| `ba-media-monopoly` | A city of giant news screens all showing the same smiling corporate face, while in a dark alley a journalist hands a glowing data drive to another. |
| `bb-luxury-lottery` | A blazing game-show stage projected onto the clouds; one winner lifted by a beam of light toward golden sky towers, millions of upturned faces in grey streets below. |
| `bb-biometric-tollways` | A transit tunnel with glowing facial-recognition gates: one lane flows fast in gold light, the other is a long stalled queue lit in harsh red. |
