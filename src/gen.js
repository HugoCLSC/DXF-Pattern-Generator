/* Vent pattern geometry + exporters. Units: mm, Y up. */
(function (root) {
  const TAU = Math.PI * 2;

  function parseList(s, fallback) {
    const v = String(s).split(/[\s,;]+/).map(Number).filter((x) => isFinite(x) && x > 0);
    return v.length ? v : fallback;
  }

  // closed stadium polyline: [x, y, bulge] where bulge applies to the segment that starts at that vertex
  function lineSlot(p1, p2, d, w) {
    const r = w / 2, n = [-d[1], d[0]];
    const P = (p, s) => [p[0] + n[0] * r * s, p[1] + n[1] * r * s];
    const a = P(p1, -1), b = P(p2, -1), c = P(p2, 1), e = P(p1, 1);
    return [[a[0], a[1], 0], [b[0], b[1], 1], [c[0], c[1], 0], [e[0], e[1], 1]];
  }

  function arcSlot(rc, a1, a2, w) {
    const ro = rc + w / 2, ri = rc - w / 2, b = Math.tan((a2 - a1) / 4);
    const P = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
    const p = [P(ro, a1), P(ro, a2), P(ri, a2), P(ri, a1)];
    return [[...p[0], b], [...p[1], 1], [...p[2], -b], [...p[3], 1]];
  }

  /* ---------- circle: concentric rings of arc slots ---------- */
  function circlePattern(o) {
    const R = o.D / 2, w = o.w, w2 = w / 2, pitchR = w + o.ringGap;
    const lengths = parseList(o.lengths, [8]);
    const slots = [], rings = [];
    let area = 0, rc = R - o.margin - w2, i = 0, prev = 0;
    while (rc - w2 >= o.hub / 2 - 1e-9 && rc > w2) {
      const target = Math.max(lengths[i % lengths.length], w + 0.05);
      const sinArg = (w + o.spokeMin) / (2 * rc);
      if (sinArg < 1) {
        const gap = 2 * Math.asin(sinArg);
        const n = Math.max(1, Math.round(TAU / ((target - w) / rc + gap)));
        const pitch = TAU / n, span = pitch - gap;
        if (span > 0) {
          const off = prev + pitch / 2 + (o.twist * Math.PI) / 180;
          prev = off;
          for (let k = 0; k < n; k++) {
            const a1 = off + k * pitch;
            slots.push(arcSlot(rc, a1, a1 + span, w));
          }
          area += n * (span * rc * w + Math.PI * w2 * w2);
          rings.push({ r: rc, n, len: span * rc + w });
        }
      }
      rc -= pitchR; i++;
    }
    const outlineArea = Math.PI * R * R;
    return {
      outline: { type: "circle", r: R }, slots, area, outlineArea, rows: rings,
      extent: R, hubD: rings.length ? 2 * (rings[rings.length - 1].r - w2) : 0,
    };
  }

  /* ---------- square: parallel angled slots (default 45°) ---------- */
  function sdfRoundBox(x, y, hx, hy, rc) {
    const qx = Math.abs(x) - (hx - rc), qy = Math.abs(y) - (hy - rc);
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
    return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - rc;
  }

  function rectSlot(p1, p2, d, w) {
    const r = w / 2, n = [-d[1], d[0]];
    const Q = (p, sd, sn) => [p[0] + (d[0] * sd + n[0] * sn) * r, p[1] + (d[1] * sd + n[1] * sn) * r, 0];
    return [Q(p1, -1, -1), Q(p2, 1, -1), Q(p2, 1, 1), Q(p1, -1, 1)];
  }

  function squarePattern(o) {
    const Wd = o.W ?? o.S, Ht = o.H ?? o.S;
    const hx = Wd / 2, hy = Ht / 2, rc = Math.min(Math.max(o.cornerR, 0), Math.min(hx, hy));
    const w = o.w, r = w / 2, squareEnds = o.ends === "square";
    const th = (o.angle * Math.PI) / 180, d = [Math.cos(th), Math.sin(th)], nrm = [-d[1], d[0]];
    const lengths = parseList(o.lengths, [6]);
    const pitchV = w + o.rowGap;
    const at = (u, v) => [u * d[0] + v * nrm[0], u * d[1] + v * nrm[1]];
    const sdf = (u, v) => { const p = at(u, v); return sdfRoundBox(p[0], p[1], hx, hy, rc); };
    // round ends: end-cap centre must sit margin + r inside; square ends: all four end corners margin inside
    const ok = squareEnds
      ? (u, v) => Math.max(sdf(u - r, v - r), sdf(u - r, v + r), sdf(u + r, v - r), sdf(u + r, v + r)) <= -o.margin
      : (u, v) => sdf(u, v) <= -(o.margin + r);

    function interval(v) {
      const U = Math.max(Wd, Ht), step = 0.05;
      let lo = null, hi = null;
      for (let u = -U; u <= U; u += step) if (ok(u, v)) { if (lo === null) lo = u; hi = u; }
      if (lo === null) return null;
      const refine = (inside, outside) => {
        for (let k = 0; k < 40; k++) { const m = (inside + outside) / 2; ok(m, v) ? (inside = m) : (outside = m); }
        return inside;
      };
      return [refine(lo, lo - step), refine(hi, hi + step)];
    }

    const slots = [], rowsInfo = [];
    const endArea = squareEnds ? w * w : Math.PI * r * r;
    let area = 0;
    const K = Math.ceil(Math.hypot(hx, hy) / pitchV) + 1;
    for (let k = -K; k <= K; k++) {
      const v = k * pitchV, iv = interval(v);
      if (!iv) continue;
      const [umin, umax] = iv;
      const L = Math.max(lengths[Math.abs(k) % lengths.length], w + 0.05);
      const pitchU = L + o.web;
      const off = Math.abs(k) % 2 ? pitchU / 2 : 0;
      const row = []; let dropL = false, dropR = false;
      const j0 = Math.floor((umin - off) / pitchU) - 1, j1 = Math.ceil((umax - off) / pitchU) + 1;
      for (let j = j0; j <= j1; j++) {
        const c = off + j * pitchU, a = c - (L / 2 - r), b = c + (L / 2 - r);
        if (b < umin || a > umax) continue;
        const x1 = Math.max(a, umin), x2 = Math.min(b, umax);
        if (x2 - x1 + w >= o.minLen - 1e-9) row.push([x1, x2]);
        else if (c < (umin + umax) / 2) dropL = true; else dropR = true;
      }
      if (o.stretch) {
        if (row.length && dropL) row[0][0] = umin;
        if (row.length && dropR) row[row.length - 1][1] = umax;
      }
      if (!row.length && umax - umin + w >= o.minLen) row.push([umin, umax]);
      for (const [x1, x2] of row) {
        slots.push((squareEnds ? rectSlot : lineSlot)(at(x1, v), at(x2, v), d, w));
        area += (x2 - x1) * w + endArea;
      }
      if (row.length) rowsInfo.push({ v, n: row.length, len: L });
    }
    const outlineArea = Wd * Ht - (4 - Math.PI) * rc * rc;
    return { outline: { type: "rect", hx, hy, rc }, slots, area, outlineArea, rows: rowsInfo, extent: Math.max(hx, hy) };
  }

  function outlinePoly(ol) {
    // rounded rectangle as bulged polyline (CCW)
    const hx = ol.hx ?? ol.h, hy = ol.hy ?? ol.h, rc = ol.rc;
    if (rc <= 1e-9) return [[-hx, -hy, 0], [hx, -hy, 0], [hx, hy, 0], [-hx, hy, 0]];
    const b = Math.tan(Math.PI / 8), sx = hx - rc, sy = hy - rc;
    const pts = [
      [-sx, -hy, 0], [sx, -hy, b], [hx, -sy, 0], [hx, sy, b],
      [sx, hy, 0], [-sx, hy, b], [-hx, sy, 0], [-hx, -sy, b],
    ];
    // drop zero-length straight edges (when rc equals a half-side)
    return pts.filter((p, i) => { const q = pts[(i + 1) % pts.length]; return p[2] !== 0 || Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-9; });
  }

  /* ---------- SVG path from bulged polyline ---------- */
  const f = (x) => (Math.abs(x) < 5e-7 ? 0 : +x.toFixed(4));
  function polyToPath(pts) {
    let dStr = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1, b] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      if (Math.abs(b) < 1e-12) dStr += `L${f(x2)} ${f(y2)}`;
      else {
        const th = 4 * Math.atan(Math.abs(b)), chord = Math.hypot(x2 - x1, y2 - y1);
        const rad = chord / (2 * Math.sin(th / 2));
        dStr += `A${f(rad)} ${f(rad)} 0 ${th > Math.PI ? 1 : 0} ${b > 0 ? 1 : 0} ${f(x2)} ${f(y2)}`;
      }
    }
    return dStr + "Z";
  }

  function toSVG(g, opts = {}) {
    const E = g.extent, pad = 0.5, W = 2 * (E + pad);
    const stroke = opts.stroke || 0.08;
    const outline = g.outline.type === "circle"
      ? `<circle cx="0" cy="0" r="${f(g.outline.r)}"/>`
      : `<path d="${polyToPath(outlinePoly(g.outline))}"/>`;
    const slots = g.slots.map((s) => `<path d="${polyToPath(s)}"/>`).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}mm" height="${f(W)}mm" viewBox="${f(-E - pad)} ${f(-E - pad)} ${f(W)} ${f(W)}">` +
      `<g transform="scale(1,-1)" fill="none" stroke-width="${stroke}">` +
      `<g id="OUTLINE" stroke="${opts.outlineColor || "#000"}">${outline}</g>` +
      `<g id="SLOTS" stroke="${opts.slotColor || "#d00"}">${slots}</g></g></svg>`;
  }

  /* ---------- DXF (R12 ASCII, mm) ---------- */
  function toDXF(g) {
    const L = [];
    const p = (code, val) => L.push(String(code), String(val));
    const num = (x) => f(x).toString();
    p(0, "SECTION"); p(2, "HEADER");
    p(9, "$ACADVER"); p(1, "AC1009");
    p(9, "$INSUNITS"); p(70, 4);
    p(9, "$MEASUREMENT"); p(70, 1);
    p(0, "ENDSEC");
    p(0, "SECTION"); p(2, "TABLES");
    p(0, "TABLE"); p(2, "LTYPE"); p(70, 1);
    p(0, "LTYPE"); p(2, "CONTINUOUS"); p(70, 0); p(3, "Solid line"); p(72, 65); p(73, 0); p(40, 0.0);
    p(0, "ENDTAB");
    p(0, "TABLE"); p(2, "LAYER"); p(70, 2);
    for (const [name, col] of [["OUTLINE", 7], ["SLOTS", 1]]) {
      p(0, "LAYER"); p(2, name); p(70, 0); p(62, col); p(6, "CONTINUOUS");
    }
    p(0, "ENDTAB"); p(0, "ENDSEC");
    p(0, "SECTION"); p(2, "ENTITIES");
    const poly = (pts, layer) => {
      p(0, "POLYLINE"); p(8, layer); p(66, 1); p(10, 0); p(20, 0); p(30, 0); p(70, 1);
      for (const [x, y, b] of pts) {
        p(0, "VERTEX"); p(8, layer); p(10, num(x)); p(20, num(y)); p(30, 0);
        if (Math.abs(b) > 1e-12) p(42, b.toFixed(8));
      }
      p(0, "SEQEND"); p(8, layer);
    };
    if (g.outline.type === "circle") {
      p(0, "CIRCLE"); p(8, "OUTLINE"); p(10, 0); p(20, 0); p(30, 0); p(40, num(g.outline.r));
    } else poly(outlinePoly(g.outline), "OUTLINE");
    for (const s of g.slots) poly(s, "SLOTS");
    p(0, "ENDSEC"); p(0, "EOF");
    return L.join("\r\n") + "\r\n";
  }

  const api = { circlePattern, squarePattern, toSVG, toDXF, polyToPath, outlinePoly, parseList };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VentGen = api;
})(typeof window !== "undefined" ? window : globalThis);
