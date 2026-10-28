# Fan Vent Generator

> **This project was made entirely by AI.**
> All of the code, this README and the example files were written by AI (Claude, made by Anthropic).
> No human wrote or edited any of it. The repository owner only described what they wanted in a chat
> conversation and reviewed the results; every line of implementation came from the AI.

A browser-based, parametric generator for fan intake and exhaust vent patterns. Pick a shape, adjust the
dimensions, see the pattern update live, and export a DXF (or SVG) ready for CAD, 3D printing or laser cutting.

![Example patterns: concentric arcs in a circle, diagonal round-end slots in a square, rectangular slots in a rectangle](examples/preview.png)

## Patterns

### Circle: concentric arc slots
Rings of curved slots that radiate out from a solid centre hub, following the annulus an axial fan actually
moves air through.

| Parameter | Default | Description |
|---|---|---|
| Diameter | 38 mm | Outer circle |
| Solid border | 1.5 mm | Solid ring between the outline and the outermost slots |
| Min. centre hub Ø | 2 mm | Rings stop before this solid centre |
| Slot width | 1 mm | Radial width of every slot |
| Gap between rings | 1 mm | Material between rings |
| Min. spoke width | 1 mm | Material between neighbouring slots in a ring, measured edge to edge |
| Ring rotation | 21° | Extra turn per ring so spokes never line up |
| Slot lengths | `11, 7, 9.5, 5.5, 8, 6.5, 4.5, 3.5` | Target length per ring, outer ring first; the list repeats |

### Square / rectangle: angled slots
Parallel rows of slots at any angle, staggered so the ribs interlock.

| Parameter | Default | Description |
|---|---|---|
| Width, Height | 38 × 38 mm | Outline size; equal values give a square |
| Corner radius | 3 mm | Rounded outline corners; slots are trimmed to follow them |
| Solid border | 1.5 mm | Solid band around the edge |
| Slot angle | 45° | 0–180°, counter-clockwise from horizontal; slider and presets included |
| Slot ends | Round | Round (obround slots) or Square (rectangular slots) |
| Slot width | 1 mm | Width of each slot |
| Gap between rows | 1 mm | Spacing between parallel rows |
| Gap between slot ends | 1 mm | Material between slots in the same row |
| Shortest edge slot | 2.5 mm | Shorter slots near the edge are removed |
| Stretch edge slots | On | Extend the neighbouring slot to the border instead of leaving a solid patch |
| Slot lengths | `8, 4, 6, 10, 5` | Target length per row, centre row outward, mirrored |

The page also reports slot count and open area, warns about features that are too thin to 3D print with a
0.4 mm nozzle, and lists each ring or row in a breakdown table.

## Using it

- **Online:** open `index.html` through GitHub Pages (Settings → Pages → deploy from the `main` branch).
- **Locally:** download the repository and open `index.html` in a browser. No build step or server needed.

### Export
- **DXF**: R12 ASCII, units in millimetres, layers `OUTLINE` and `SLOTS`. Every slot is a single closed
  polyline (arcs stored as bulge values), so it extrudes or cuts directly in Fusion 360, FreeCAD, Onshape,
  SolidWorks, LibreCAD or laser-cutter software.
- **SVG**: real-size (mm) drawing for Inkscape and laser cutters.
- **Copy DXF text**: puts the DXF on the clipboard.

## Examples

Ready-made files in [`examples/`](examples):

| File | Slots | Open area |
|---|---|---|
| `fan_vent_circle_38mm.dxf` | 62 | 37.6% |
| `fan_vent_square_38mm_45deg.dxf` | 93 | 34.9% |
| `fan_vent_rect_60x30mm_45deg_rectslots.dxf` | 111 | 36.0% |

Regenerate them with Node.js:

```sh
node scripts/generate-examples.js
```

## Using the geometry in your own code

`src/gen.js` has no dependencies and works in the browser (as `window.VentGen`) or in Node.js:

```js
const G = require("./src/gen.js");

const g = G.squarePattern({
  W: 80, H: 20, cornerR: 2, margin: 1.5, angle: 30,
  w: 1.2, rowGap: 1, web: 1, minLen: 2.5, stretch: true,
  ends: "round", lengths: "12, 8",
});

console.log(g.slots.length, (100 * g.area / g.outlineArea).toFixed(1) + "% open");
require("fs").writeFileSync("vent.dxf", G.toDXF(g));
```

`circlePattern(options)` and `squarePattern(options)` return the outline, the slots as closed bulged
polylines, the open area and per-ring/row details; `toDXF(geometry)` and `toSVG(geometry)` export them.

## Design notes

- **Round slot ends** avoid sharp inside corners, where cracks start in printed and moulded parts.
  **Square ends** suit laser-cut sheet; on a CNC router they come out with the cutter's corner radius.
- **Staggered rows and rotated rings** keep the ribs connected in both directions, which is stiffer and
  quieter than long parallel bars with the same open area.
- **Clearance:** leave roughly 3–5 mm between a grille and small fan blades to avoid tonal whine.
- Slots are trimmed with a rounded-box signed distance function, so every slot respects the solid border,
  including at rounded corners and at any slot angle.

## Project layout

```
index.html                  the generator page
src/gen.js                  pattern geometry, DXF and SVG export
scripts/generate-examples.js regenerates the example files
examples/                   example DXF, SVG and preview image
```

## References

- [Autodesk DXF Reference](https://help.autodesk.com/view/OARX/2024/ENU/?guid=GUID-235B22E0-A567-4CF6-92D3-38A2306D73F3): POLYLINE/VERTEX entities and bulge (group 42)
- [ezdxf: bulge values](https://ezdxf.readthedocs.io/en/stable/concepts/bulge.html): how arcs are stored in polylines
- [Inigo Quilez: 2D distance functions](https://iquilezles.org/articles/distfunctions2d/): rounded box SDF used for trimming
