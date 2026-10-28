/* Fan vent pattern geometry + exporters. Units: mm, Y up.
 * Shapes: circle, rectangle (optional rounded corners).
 * Patterns: arcs (concentric arc slots, circle only), slots (parallel straight slots),
 *           holes (round holes graded by distance from centre), line (a custom single line
 *           given a width and repeated in rows or radially).
 * Requires ClipperLib (clipper-lib 6.4.2) for the custom line pattern.
 */
(function (root) {
  const TAU = Math.PI * 2;
  const isNode = typeof module !== "undefined" && module.exports;
  const CL = isNode ? require("clipper-lib") : root.ClipperLib;
  const SC = 1000; // Clipper works on integers: 1 unit = 1 µm

  function parseList(s, fallback) {
    const v = String(s).split(/[\s,;]+/).map(Number).filter((x) => isFinite(x) && x > 0);
    return v.length ? v : fallback;
  }
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  /* ================= shapes ================= */
  function sdfRoundBox(x, y, hx, hy, rc) {
    const qx = Math.abs(x) - (hx - rc), qy = Math.abs(y) - (hy - rc);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rc;
  }

  function makeShape(o) {
    if (o.shape === "circle") {
      const R = Math.max(0.5, o.D / 2);
      return {
        type: "circle", R, extent: R, far: R, inscribed: R,
        sdf: (x, y) => Math.hypot(x, y) - R,
        area: Math.PI * R * R,
        outline: { type: "circle", r: R },
        insetPoly(inset) {
          const r = R - inset;
          if (r <= 0) return [];
          const n = Math.max(96, Math.ceil((TAU * r) / 0.05));
          return Array.from({ length: n }, (_, i) => [r * Math.cos((TAU * i) / n), r * Math.sin((TAU * i) / n)]);
        },
      };
    }
    const hx = Math.max(0.5, o.W / 2), hy = Math.max(0.5, o.H / 2);
    const rc = clamp(o.cornerR || 0, 0, Math.min(hx, hy));
    return {
      type: "rect", hx, hy, rc, extent: Math.max(hx, hy), far: Math.hypot(hx, hy), inscribed: Math.min(hx, hy),
      sdf: (x, y) => sdfRoundBox(x, y, hx, hy, rc),
      area: 4 * hx * hy - (4 - Math.PI) * rc * rc,
      outline: { type: "rect", hx, hy, rc },
      insetPoly(inset) {
        const ax = hx - inset, ay = hy - inset;
        if (ax <= 0 || ay <= 0) return [];
        const r = Math.max(rc - inset, 0), pts = [];
        const corners = [[ax - r, ay - r, 0], [-ax + r, ay - r, 1], [-ax + r, -ay + r, 2], [ax - r, -ay + r, 3]];
        for (const [cx, cy, q] of corners) {
          const m = r > 0 ? Math.max(8, Math.ceil((Math.PI / 2 * r) / 0.05)) : 0;
          for (let i = 0; i <= m; i++) {
            const a = (q * Math.PI) / 2 + (m ? (i / m) * (Math.PI / 2) : 0);
            pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
          }
        }
        return pts;
      },
    };
  }

  function outlinePoly(ol) {
    const { hx, hy, rc } = ol;
    if (rc <= 1e-9) return [[-hx, -hy, 0], [hx, -hy, 0], [hx, hy, 0], [-hx, hy, 0]];
    const b = Math.tan(Math.PI / 8), sx = hx - rc, sy = hy - rc;
    const pts = [[-sx, -hy, 0], [sx, -hy, b], [hx, -sy, 0], [hx, sy, b], [sx, hy, 0], [-sx, hy, b], [-hx, sy, 0], [-hx, -sy, b]];
    return pts.filter((p, i) => { const q = pts[(i + 1) % pts.length]; return p[2] !== 0 || Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-9; });
  }

  /* ================= slot outlines (closed bulged polylines [x, y, bulge]) ================= */
  function lineSlot(p1, p2, d, w) {
    const r = w / 2, n = [-d[1], d[0]];
    const P = (p, s) => [p[0] + n[0] * r * s, p[1] + n[1] * r * s];
    const a = P(p1, -1), b = P(p2, -1), c = P(p2, 1), e = P(p1, 1);
    return [[a[0], a[1], 0], [b[0], b[1], 1], [c[0], c[1], 0], [e[0], e[1], 1]];
  }
  function rectSlot(p1, p2, d, w) {
    const r = w / 2, n = [-d[1], d[0]];
    const Q = (p, sd, sn) => [p[0] + (d[0] * sd + n[0] * sn) * r, p[1] + (d[1] * sd + n[1] * sn) * r, 0];
    return [Q(p1, -1, -1), Q(p2, 1, -1), Q(p2, 1, 1), Q(p1, -1, 1)];
  }
  function arcSlot(rc, a1, a2, w) {
    const ro = rc + w / 2, ri = rc - w / 2, b = Math.tan((a2 - a1) / 4);
    const P = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
    const p = [P(ro, a1), P(ro, a2), P(ri, a2), P(ri, a1)];
    return [[...p[0], b], [...p[1], 1], [...p[2], -b], [...p[3], 1]];
  }

  function result(shape, extra) {
    return Object.assign({ outline: shape.outline, outlineArea: shape.area, extent: shape.extent, polys: [], circles: [], rows: [], area: 0, warnings: [] }, extra);
  }

  /* ================= pattern: concentric arc slots (circle) ================= */
  function arcsPattern(shape, o) {
    if (shape.type !== "circle") return result(shape, { warnings: ["Arc slots need a circle outline."] });
    const R = shape.R, w = o.w, w2 = w / 2, pitchR = w + o.ringGap;
    const lengths = parseList(o.lengths, [8]);
    const polys = [], rows = [];
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
          for (let k = 0; k < n; k++) { const a1 = off + k * pitch; polys.push(arcSlot(rc, a1, a1 + span, w)); }
          area += n * (span * rc * w + Math.PI * w2 * w2);
          rows.push({ pos: rc, n, size: span * rc + w });
        }
      }
      rc -= pitchR; i++;
    }
    const hubD = rows.length ? 2 * (rows[rows.length - 1].pos - w2) : 0;
    return result(shape, { polys, area, rows, info: { hubD }, minRib: Math.min(o.ringGap, o.spokeMin) });
  }

  /* ================= pattern: parallel straight slots ================= */
  function slotsPattern(shape, o) {
    const w = o.w, r = w / 2, squareEnds = o.ends === "square";
    const th = (o.angle * Math.PI) / 180, d = [Math.cos(th), Math.sin(th)], nrm = [-d[1], d[0]];
    const lengths = parseList(o.lengths, [6]);
    const pitchV = w + o.rowGap;
    const at = (u, v) => [u * d[0] + v * nrm[0], u * d[1] + v * nrm[1]];
    const sdf = (u, v) => { const p = at(u, v); return shape.sdf(p[0], p[1]); };
    const ok = squareEnds
      ? (u, v) => Math.max(sdf(u - r, v - r), sdf(u - r, v + r), sdf(u + r, v - r), sdf(u + r, v + r)) <= -o.margin
      : (u, v) => sdf(u, v) <= -(o.margin + r);

    function interval(v) {
      const U = shape.far + 1, step = 0.05;
      let lo = null, hi = null;
      for (let u = -U; u <= U; u += step) if (ok(u, v)) { if (lo === null) lo = u; hi = u; }
      if (lo === null) return null;
      const refine = (inside, outside) => { for (let k = 0; k < 40; k++) { const m = (inside + outside) / 2; ok(m, v) ? (inside = m) : (outside = m); } return inside; };
      return [refine(lo, lo - step), refine(hi, hi + step)];
    }

    const polys = [], rows = [], endArea = squareEnds ? w * w : Math.PI * r * r;
    let area = 0;
    const K = Math.ceil(shape.far / pitchV) + 1;
    for (let k = -K; k <= K; k++) {
      const v = k * pitchV, iv = interval(v);
      if (!iv) continue;
      const [umin, umax] = iv;
      const L = Math.max(lengths[Math.abs(k) % lengths.length], w + 0.05);
      const pitchU = L + o.web, off = Math.abs(k) % 2 ? pitchU / 2 : 0;
      const row = []; let dropL = false, dropR = false;
      const j0 = Math.floor((umin - off) / pitchU) - 1, j1 = Math.ceil((umax - off) / pitchU) + 1;
      for (let j = j0; j <= j1; j++) {
        const c = off + j * pitchU, a = c - (L / 2 - r), b = c + (L / 2 - r);
        if (b < umin || a > umax) continue;
        const x1 = Math.max(a, umin), x2 = Math.min(b, umax);
        if (x2 - x1 + w >= o.minLen - 1e-9) row.push([x1, x2]);
        else if (c < (umin + umax) / 2) dropL = true; else dropR = true;
      }
      if (o.stretch) { if (row.length && dropL) row[0][0] = umin; if (row.length && dropR) row[row.length - 1][1] = umax; }
      if (!row.length && umax - umin + w >= o.minLen) row.push([umin, umax]);
      for (const [x1, x2] of row) { polys.push((squareEnds ? rectSlot : lineSlot)(at(x1, v), at(x2, v), d, w)); area += (x2 - x1) * w + endArea; }
      if (row.length) rows.push({ pos: v, n: row.length, size: L });
    }
    return result(shape, { polys, area, rows, minRib: Math.min(o.rowGap, o.web) });
  }

  /* ================= pattern: graded round holes ================= */
  function holesPattern(shape, o) {
    const web = Math.max(0.05, o.web), curve = Math.max(0.05, o.curve);
    const Rref = Math.max(0.5, (o.gradTo === "inscribed" ? shape.inscribed : shape.far) - o.margin);
    const dAt = (rho) => Math.max(0, o.dCenter + (o.dEdge - o.dCenter) * Math.pow(clamp(rho / Rref, 0, 1), curve));
    const fits = (x, y, d) => shape.sdf(x, y) <= -(o.margin + d / 2) + 1e-9;
    const minD = Math.max(0.05, o.minD);
    const circles = [], rows = [];
    const add = (x, y, d) => { if (d >= minD && fits(x, y, d)) { circles.push({ x, y, r: d / 2 }); return true; } return false; };
    const limit = shape.far;

    if (o.layout === "rings") {
      // next ring radius rho so that its holes clear the previous edge by `web`
      const next = (edge) => { let rho = edge + web + dAt(edge) / 2; for (let k = 0; k < 30; k++) rho = edge + web + dAt(rho) / 2; return rho; };
      let rho, k = 0;
      if (o.centerHole) {
        const d0 = dAt(0);
        if (add(0, 0, d0)) rows.push({ pos: 0, n: 1, size: d0 });
        rho = next(d0 / 2);
      } else {
        const edge = Math.max(0, o.hub / 2);
        rho = edge > 0 ? next(edge) - web : Math.max(dAt(0) / 2 + web / 2, 0.01);
        for (let t = 0; t < 30 && edge > 0; t++) rho = edge + dAt(rho) / 2;
      }
      while (rho - dAt(rho) / 2 <= limit && k < 400) {
        const d = dAt(rho);
        if (d >= minD) {
          const s = (d + web) / (2 * rho);
          const n = s >= 1 ? 1 : Math.max(1, Math.floor(Math.PI / Math.asin(s)));
          if (n >= 2 || rho < 1e-6) {
            const phase = (k % 2) * (Math.PI / n) + (k * (o.twist || 0) * Math.PI) / 180;
            let placed = 0;
            for (let i = 0; i < n; i++) { const a = phase + (i * TAU) / n; if (add(rho * Math.cos(a), rho * Math.sin(a), d)) placed++; }
            if (placed) rows.push({ pos: rho, n: placed, size: d });
          }
        }
        rho = next(rho + Math.max(d, 0) / 2);
        k++;
      }
    } else {
      const dMax = Math.max(o.dCenter, o.dEdge), p = dMax + web;
      const hex = o.layout === "hex", dyRow = hex ? (p * Math.sqrt(3)) / 2 : p;
      const ny = Math.ceil(limit / dyRow) + 1, nx = Math.ceil(limit / p) + 2;
      for (let j = -ny; j <= ny; j++) {
        const y = j * dyRow, off = hex && Math.abs(j) % 2 ? p / 2 : 0;
        let placed = 0;
        for (let i = -nx; i <= nx; i++) { const x = i * p + off; if (add(x, y, dAt(Math.hypot(x, y)))) placed++; }
        if (placed) rows.push({ pos: y, n: placed, size: dAt(Math.abs(y)) });
      }
    }
    const area = circles.reduce((s, c) => s + Math.PI * c.r * c.r, 0);
    const sizes = circles.map((c) => 2 * c.r);
    return result(shape, {
      circles, area, rows, minRib: Math.min(web, o.margin),
      info: { dMin: sizes.length ? Math.min(...sizes) : 0, dMax: sizes.length ? Math.max(...sizes) : 0 },
    });
  }

  /* ================= pattern: custom single line ================= */
  // Scale/rotate the user's line so it runs from (0,0) to (L,0).
  function normaliseLine(points, L, hScale) {
    const pts = points.filter((p) => isFinite(p[0]) && isFinite(p[1]));
    if (pts.length < 2) return null;
    const a = pts[0], b = pts[pts.length - 1];
    let len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]), ox = a[0], oy = a[1];
    if (len < 1e-6) { // closed-ish line: use its bounding box width
      const xs = pts.map((p) => p[0]); ox = Math.min(...xs); len = Math.max(...xs) - ox || 1; ang = 0; oy = a[1];
    }
    const s = L / len, c = Math.cos(-ang), sn = Math.sin(-ang);
    return pts.map(([x, y]) => { const dx = x - ox, dy = y - oy; return [(dx * c - dy * sn) * s, (dx * sn + dy * c) * s * hScale]; });
  }

  const pathLen = (p) => { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return s; };

  function linePattern(shape, o) {
    if (!CL) return result(shape, { warnings: ["The polygon library did not load, so custom lines are unavailable."] });
    const L = Math.max(0.5, o.L), w = Math.max(0.05, o.w);
    const motif = normaliseLine(o.points || [], L, o.hScale);
    if (!motif) return result(shape, { warnings: ["The line needs at least two points."] });
    const ys = motif.map((p) => p[1]), amp = Math.max(Math.abs(Math.min(...ys)), Math.abs(Math.max(...ys)));
    const paths = [];
    if (o.arrange === "radial") {
      const N = Math.max(1, Math.round(o.count)), r0 = Math.max(0, o.r0), ph = (o.rotation * Math.PI) / 180;
      for (let i = 0; i < N; i++) {
        const a = ph + (i * TAU) / N, c = Math.cos(a), s = Math.sin(a);
        const flip = o.mirror && i % 2 ? -1 : 1;
        paths.push(motif.map(([mx, my]) => { const u = r0 + mx, v = my * flip; return [u * c - v * s, u * s + v * c]; }));
      }
    } else {
      const th = (o.angle * Math.PI) / 180, d = [Math.cos(th), Math.sin(th)], n = [-d[1], d[0]];
      const at = (u, v) => [u * d[0] + v * n[0], u * d[1] + v * n[1]];
      const pitchV = Math.max(0.05, o.rowPitch), gap = Math.max(0, o.gap), period = L + gap;
      const K = Math.ceil((shape.far + amp) / pitchV) + 1, U = shape.far + L;
      for (let k = -K; k <= K; k++) {
        const v = k * pitchV, odd = Math.abs(k) % 2 === 1;
        const off = o.stagger && odd ? period / 2 : 0, flip = o.mirror && odd ? -1 : 1;
        const j0 = Math.floor((-U - off) / period) - 1, j1 = Math.ceil((U - off) / period) + 1;
        let cont = [];
        for (let j = j0; j <= j1; j++) {
          const base = off + j * period;
          const copy = motif.map(([mx, my]) => at(base + mx, v + my * flip));
          if (gap > 1e-9) paths.push(copy);
          else cont = cont.concat(cont.length ? copy.slice(1) : copy);
        }
        if (cont.length) paths.push(cont);
      }
    }
    // clip centre-lines to the region that keeps the full border, then give them width
    const inner = shape.insetPoly(o.margin + w / 2).map(([x, y]) => ({ X: Math.round(x * SC), Y: Math.round(y * SC) }));
    if (inner.length < 3) return result(shape, { warnings: ["The border is too wide for this outline."] });
    const toCL = (p) => p.map(([x, y]) => ({ X: Math.round(x * SC), Y: Math.round(y * SC) }));
    const clipper = new CL.Clipper();
    clipper.AddPaths(paths.map(toCL), CL.PolyType.ptSubject, false);
    clipper.AddPath(inner, CL.PolyType.ptClip, true);
    const tree = new CL.PolyTree();
    clipper.Execute(CL.ClipType.ctIntersection, tree, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
    const minCenter = Math.max(0, o.minLen - w);
    const pieces = CL.Clipper.OpenPathsFromPolyTree(tree)
      .map((p) => p.map((q) => [q.X / SC, q.Y / SC]))
      .filter((p) => p.length >= 2 && pathLen(p) >= minCenter - 1e-9);
    if (!pieces.length) return result(shape, { warnings: ["No part of the line fits inside the border."] });

    const off = new CL.ClipperOffset(2, 0.004 * SC);
    off.AddPaths(pieces.map(toCL), o.ends === "square" ? CL.JoinType.jtMiter : CL.JoinType.jtRound, o.ends === "square" ? CL.EndType.etOpenButt : CL.EndType.etOpenRound);
    const out = new CL.Paths();
    off.Execute(out, (w / 2) * SC);
    const polys = out.map((p) => p.map((q) => [q.X / SC, q.Y / SC, 0]));
    const area = out.reduce((s, p) => s + CL.Clipper.Area(p), 0) / (SC * SC);
    // expected area if no two slots touched: helps detect rows colliding
    const ends = o.ends === "square" ? 0 : Math.PI * (w / 2) ** 2;
    const expected = pieces.reduce((s, p) => s + pathLen(p) * w + ends, 0);
    const warnings = [];
    if (area < expected * 0.96) warnings.push("Some slots touch or overlap and were merged. Increase the row spacing or the gap, or lower the height.");
    const rows = pieces.map((p, i) => ({ pos: i + 1, n: 1, size: pathLen(p) + (o.ends === "square" ? 0 : w) }));
    return result(shape, { polys, area, rows, warnings, info: { pieces: pieces.length, amp }, minRib: null });
  }

  function generate(o) {
    const shape = makeShape(o);
    const p = o.pattern;
    const g = p === "arcs" ? arcsPattern(shape, o) : p === "holes" ? holesPattern(shape, o) : p === "line" ? linePattern(shape, o) : slotsPattern(shape, o);
    g.count = g.polys.length + g.circles.length;
    return g;
  }

  /* ================= line import ================= */
  function bulgeToPoints(x1, y1, x2, y2, b, out) {
    if (Math.abs(b) < 1e-9) { out.push([x2, y2]); return; }
    const th = 4 * Math.atan(b), chord = Math.hypot(x2 - x1, y2 - y1), r = chord / (2 * Math.sin(Math.abs(th) / 2));
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, h = Math.sqrt(Math.max(r * r - (chord / 2) ** 2, 0));
    const ux = (x2 - x1) / chord, uy = (y2 - y1) / chord, side = (b > 0) === (Math.abs(th) < Math.PI) ? 1 : -1;
    const cx = mx - uy * h * side, cy = my + ux * h * side;
    const a1 = Math.atan2(y1 - cy, x1 - cx), n = Math.max(4, Math.ceil(Math.abs(th) / 0.08));
    for (let i = 1; i <= n; i++) { const a = a1 + (th * i) / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  }

  function chain(polylines) {
    const segs = polylines.filter((p) => p.length >= 2).map((p) => p.slice());
    if (!segs.length) return [];
    let path = segs.shift();
    const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-3;
    let grown = true;
    while (segs.length && grown) {
      grown = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i], head = path[0], tail = path[path.length - 1];
        if (close(tail, s[0])) path = path.concat(s.slice(1));
        else if (close(tail, s[s.length - 1])) path = path.concat(s.slice().reverse().slice(1));
        else if (close(head, s[s.length - 1])) path = s.concat(path.slice(1));
        else if (close(head, s[0])) path = s.slice().reverse().concat(path.slice(1));
        else continue;
        segs.splice(i, 1); grown = true; break;
      }
    }
    return path;
  }

  // Reads LINE, ARC, LWPOLYLINE, POLYLINE/VERTEX and SPLINE (fit or control points) from the ENTITIES section.
  function parseDXFLine(text) {
    const lines = text.split(/\r?\n/), pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
    let i = pairs.findIndex((p, k) => p[0] === 2 && p[1] === "ENTITIES" && pairs[k - 1] && pairs[k - 1][1] === "SECTION");
    if (i < 0) i = 0;
    const ents = [];
    let cur = null;
    for (i++; i < pairs.length; i++) {
      const [c, v] = pairs[i];
      if (c === 0) { if (cur) ents.push(cur); if (v === "ENDSEC") { cur = null; break; } cur = { type: v, g: [] }; }
      else if (cur) cur.g.push([c, v]);
    }
    if (cur) ents.push(cur);
    const polys = [];
    let poly = null;
    const num = (g, c) => { const f = g.find((p) => p[0] === c); return f ? parseFloat(f[1]) : 0; };
    for (const e of ents) {
      if (e.type === "LINE") polys.push([[num(e.g, 10), num(e.g, 20)], [num(e.g, 11), num(e.g, 21)]]);
      else if (e.type === "ARC") {
        const cx = num(e.g, 10), cy = num(e.g, 20), r = num(e.g, 40);
        let a1 = (num(e.g, 50) * Math.PI) / 180, a2 = (num(e.g, 51) * Math.PI) / 180;
        if (a2 <= a1) a2 += TAU;
        const n = Math.max(8, Math.ceil((a2 - a1) / 0.06));
        polys.push(Array.from({ length: n + 1 }, (_, k) => { const a = a1 + ((a2 - a1) * k) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }));
      } else if (e.type === "LWPOLYLINE") {
        const v = []; let last = null;
        for (const [c, val] of e.g) {
          if (c === 10) { last = [parseFloat(val), 0, 0]; v.push(last); }
          else if (c === 20 && last) last[1] = parseFloat(val);
          else if (c === 42 && last) last[2] = parseFloat(val);
        }
        const closed = (num(e.g, 70) & 1) === 1;
        polys.push(expandBulged(v, closed));
      } else if (e.type === "POLYLINE") { poly = { v: [], closed: (num(e.g, 70) & 1) === 1 }; }
      else if (e.type === "VERTEX" && poly) poly.v.push([num(e.g, 10), num(e.g, 20), num(e.g, 42)]);
      else if (e.type === "SEQEND" && poly) { polys.push(expandBulged(poly.v, poly.closed)); poly = null; }
      else if (e.type === "SPLINE") {
        const fit = [], ctl = [], knots = []; let last = null, lastC = null;
        for (const [c, val] of e.g) {
          if (c === 11) { last = [parseFloat(val), 0]; fit.push(last); } else if (c === 21 && last) last[1] = parseFloat(val);
          if (c === 10) { lastC = [parseFloat(val), 0]; ctl.push(lastC); } else if (c === 20 && lastC) lastC[1] = parseFloat(val);
          if (c === 40) knots.push(parseFloat(val));
        }
        const deg = Math.round(num(e.g, 71)) || 3;
        if (ctl.length > deg && knots.length === ctl.length + deg + 1) polys.push(sampleBSpline(ctl, knots, deg, 200));
        else if (fit.length >= 2) polys.push(catmullRom(fit, 16));
        else polys.push(ctl);
      }
    }
    return chain(polys);
  }

  // de Boor evaluation of a (non-rational) B-spline
  function sampleBSpline(ctl, knots, p, n) {
    const t0 = knots[p], t1 = knots[knots.length - p - 1], out = [];
    for (let s = 0; s <= n; s++) {
      const t = Math.min(t0 + ((t1 - t0) * s) / n, t1 - 1e-12);
      let k = p;
      while (k < knots.length - p - 2 && t >= knots[k + 1]) k++;
      const d = []; for (let j = 0; j <= p; j++) d.push(ctl[j + k - p].slice());
      for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--) {
        const i = j + k - p, den = knots[i + p - r + 1] - knots[i], a = den ? (t - knots[i]) / den : 0;
        d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1]];
      }
      out.push(d[p]);
    }
    return out;
  }
  function catmullRom(pts, per) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let s = 1; s <= per; s++) {
        const t = s / per, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)));
      }
    }
    return out;
  }

  function expandBulged(v, closed) {
    if (!v.length) return [];
    const out = [[v[0][0], v[0][1]]], n = closed ? v.length : v.length - 1;
    for (let i = 0; i < n; i++) { const a = v[i], b = v[(i + 1) % v.length]; bulgeToPoints(a[0], a[1], b[0], b[1], a[2] || 0, out); }
    return out;
  }

  function parseCoords(text) {
    const nums = String(text).match(/-?\d*\.?\d+(?:e-?\d+)?/gi);
    if (!nums || nums.length < 4) return null;
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([parseFloat(nums[i]), parseFloat(nums[i + 1])]);
    return pts;
  }

  /* ================= line presets (span 0..10) ================= */
  function presetLine(name) {
    const P = [];
    if (name === "straight") return [[0, 0], [10, 0]];
    if (name === "wave") { for (let i = 0; i <= 40; i++) { const x = (i / 40) * 10; P.push([x, 1.6 * Math.sin((x / 10) * TAU)]); } return P; }
    if (name === "zigzag") return [[0, 0], [2.5, 1.5], [5, 0], [7.5, -1.5], [10, 0]];
    if (name === "chevron") return [[0, 0], [5, 2.5], [10, 0]];
    if (name === "arc") { for (let i = 0; i <= 30; i++) { const a = Math.PI - (i / 30) * Math.PI; P.push([5 + 5 * Math.cos(a), 2.2 * Math.sin(a)]); } return P; }
    if (name === "scurve") { for (let i = 0; i <= 40; i++) { const t = i / 40; P.push([t * 10, 1.8 * Math.sin(t * TAU) * (1 - Math.abs(2 * t - 1) * 0.3)]); } return P; }
    if (name === "square") return [[0, 0], [0, 1.5], [5, 1.5], [5, -1.5], [10, -1.5], [10, 0]];
    return [[0, 0], [10, 0]];
  }

  /* ================= exporters ================= */
  const f = (x) => (Math.abs(x) < 5e-7 ? 0 : +x.toFixed(4));
  function polyToPath(pts) {
    let s = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1, b = 0] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      if (Math.abs(b) < 1e-12) s += `L${f(x2)} ${f(y2)}`;
      else {
        const th = 4 * Math.atan(Math.abs(b)), chord = Math.hypot(x2 - x1, y2 - y1), r = chord / (2 * Math.sin(th / 2));
        s += `A${f(r)} ${f(r)} 0 ${th > Math.PI ? 1 : 0} ${b > 0 ? 1 : 0} ${f(x2)} ${f(y2)}`;
      }
    }
    return s + "Z";
  }
  function outlineSVG(ol) {
    return ol.type === "circle" ? `<circle cx="0" cy="0" r="${f(ol.r)}"/>` : `<path d="${polyToPath(outlinePoly(ol))}"/>`;
  }
  function cutsSVG(g) {
    return g.polys.map((s) => `<path d="${polyToPath(s)}"/>`).join("") + g.circles.map((c) => `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(c.r)}"/>`).join("");
  }
  function toSVG(g) {
    const E = g.extent, pad = 0.5, W = 2 * (E + pad);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}mm" height="${f(W)}mm" viewBox="${f(-E - pad)} ${f(-E - pad)} ${f(W)} ${f(W)}">` +
      `<g transform="scale(1,-1)" fill="none" stroke-width="0.08">` +
      `<g id="OUTLINE" stroke="#000">${outlineSVG(g.outline)}</g><g id="CUTOUTS" stroke="#d00">${cutsSVG(g)}</g></g></svg>`;
  }

  function toDXF(g) {
    const L = [], p = (c, v) => L.push(String(c), String(v)), num = (x) => f(x).toString();
    p(0, "SECTION"); p(2, "HEADER"); p(9, "$ACADVER"); p(1, "AC1009"); p(9, "$INSUNITS"); p(70, 4); p(9, "$MEASUREMENT"); p(70, 1); p(0, "ENDSEC");
    p(0, "SECTION"); p(2, "TABLES");
    p(0, "TABLE"); p(2, "LTYPE"); p(70, 1); p(0, "LTYPE"); p(2, "CONTINUOUS"); p(70, 0); p(3, "Solid line"); p(72, 65); p(73, 0); p(40, 0.0); p(0, "ENDTAB");
    p(0, "TABLE"); p(2, "LAYER"); p(70, 2);
    for (const [name, col] of [["OUTLINE", 7], ["CUTOUTS", 1]]) { p(0, "LAYER"); p(2, name); p(70, 0); p(62, col); p(6, "CONTINUOUS"); }
    p(0, "ENDTAB"); p(0, "ENDSEC");
    p(0, "SECTION"); p(2, "ENTITIES");
    const poly = (pts, layer) => {
      p(0, "POLYLINE"); p(8, layer); p(66, 1); p(10, 0); p(20, 0); p(30, 0); p(70, 1);
      for (const [x, y, b = 0] of pts) { p(0, "VERTEX"); p(8, layer); p(10, num(x)); p(20, num(y)); p(30, 0); if (Math.abs(b) > 1e-12) p(42, b.toFixed(8)); }
      p(0, "SEQEND"); p(8, layer);
    };
    const circle = (x, y, r, layer) => { p(0, "CIRCLE"); p(8, layer); p(10, num(x)); p(20, num(y)); p(30, 0); p(40, num(r)); };
    if (g.outline.type === "circle") circle(0, 0, g.outline.r, "OUTLINE"); else poly(outlinePoly(g.outline), "OUTLINE");
    for (const s of g.polys) poly(s, "CUTOUTS");
    for (const c of g.circles) circle(c.x, c.y, c.r, "CUTOUTS");
    p(0, "ENDSEC"); p(0, "EOF");
    return L.join("\r\n") + "\r\n";
  }

  const api = { generate, makeShape, toSVG, toDXF, polyToPath, outlinePoly, outlineSVG, parseList, parseDXFLine, parseCoords, presetLine, normaliseLine };
  if (isNode) module.exports = api; else root.VentGen = api;
})(typeof window !== "undefined" ? window : globalThis);
