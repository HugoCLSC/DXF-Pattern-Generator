// Regenerates the example DXF/SVG files: node scripts/generate-examples.js
const fs = require("fs");
const path = require("path");
const G = require("../src/gen.js");

const out = path.join(__dirname, "..", "examples");
const examples = {
  "circle_38mm": G.circlePattern({
    D: 38, margin: 1.5, hub: 2, w: 1, ringGap: 1, spokeMin: 1, twist: 21,
    lengths: "11, 7, 9.5, 5.5, 8, 6.5, 4.5, 3.5",
  }),
  "square_38mm_45deg": G.squarePattern({
    W: 38, H: 38, cornerR: 3, margin: 1.5, angle: 45, w: 1, rowGap: 1, web: 1,
    minLen: 2.5, stretch: true, ends: "round", lengths: "8, 4, 6, 10, 5",
  }),
  "rect_60x30mm_45deg_rectslots": G.squarePattern({
    W: 60, H: 30, cornerR: 3, margin: 1.5, angle: 45, w: 1, rowGap: 1, web: 1,
    minLen: 2.5, stretch: true, ends: "square", lengths: "8, 4, 6, 10, 5",
  }),
};

for (const [name, g] of Object.entries(examples)) {
  fs.writeFileSync(path.join(out, `fan_vent_${name}.dxf`), G.toDXF(g));
  fs.writeFileSync(path.join(out, `fan_vent_${name}.svg`), G.toSVG(g));
  console.log(`${name}: ${g.slots.length} slots, ${(100 * g.area / g.outlineArea).toFixed(1)}% open`);
}
