// Regenerates the example DXF/SVG files: npm install && npm run examples
const fs = require("fs");
const path = require("path");
const G = require("../src/gen.js");

const out = path.join(__dirname, "..", "examples");
const circle = { shape: "circle", D: 38, margin: 1.5 };
const square = { shape: "rect", W: 38, H: 38, cornerR: 3, margin: 1.5 };
const rect = { shape: "rect", W: 60, H: 30, cornerR: 3, margin: 1.5 };

const examples = {
  circle_38mm_arcs: { ...circle, pattern: "arcs", hub: 2, w: 1, ringGap: 1, spokeMin: 1, twist: 21, lengths: "11, 7, 9.5, 5.5, 8, 6.5, 4.5, 3.5" },
  square_38mm_slots_45deg: { ...square, pattern: "slots", angle: 45, ends: "round", w: 1, rowGap: 1, web: 1, minLen: 2.5, stretch: true, lengths: "8, 4, 6, 10, 5" },
  rect_60x30mm_rectslots_45deg: { ...rect, pattern: "slots", angle: 45, ends: "square", w: 1, rowGap: 1, web: 1, minLen: 2.5, stretch: true, lengths: "8, 4, 6, 10, 5" },
  circle_38mm_holes_growing: { ...circle, pattern: "holes", layout: "rings", dCenter: 1, dEdge: 3.2, curve: 1, web: 1, minD: 0.8, centerHole: false, hub: 4, twist: 0, gradTo: "far" },
  square_38mm_holes_shrinking_hex: { ...square, pattern: "holes", layout: "hex", dCenter: 3.2, dEdge: 1.2, curve: 1.5, web: 1, minD: 0.8, centerHole: true, hub: 0, twist: 0, gradTo: "far" },
  circle_38mm_line_wave: { ...circle, pattern: "line", points: G.presetLine("wave"), L: 10, hScale: 1, w: 1, ends: "round", arrange: "rows", angle: 0, rowPitch: 4.5, gap: 0, stagger: false, mirror: false, minLen: 2 },
  circle_38mm_line_radial_arc: { ...circle, pattern: "line", points: G.presetLine("arc"), L: 13, hScale: 0.8, w: 1, ends: "round", arrange: "radial", count: 10, r0: 3.5, rotation: 0, mirror: false, minLen: 2 },
  rect_60x30mm_line_zigzag: { ...rect, pattern: "line", points: G.presetLine("zigzag"), L: 10, hScale: 1, w: 1, ends: "round", arrange: "rows", angle: 30, rowPitch: 5, gap: 1.5, stagger: true, mirror: false, minLen: 2 },
};

for (const [name, o] of Object.entries(examples)) {
  const g = G.generate(o);
  fs.writeFileSync(path.join(out, `fan_vent_${name}.dxf`), G.toDXF(g));
  fs.writeFileSync(path.join(out, `fan_vent_${name}.svg`), G.toSVG(g));
  console.log(`${name}: ${g.count} cutouts, ${(100 * g.area / g.outlineArea).toFixed(1)}% open${g.warnings.length ? " (" + g.warnings.join("; ") + ")" : ""}`);
}
