(function () {
  "use strict";

  const canvas = document.getElementById("warehouse-canvas");
  const frame = document.getElementById("canvas-frame");
  const ctx = canvas.getContext("2d");
  const tooltip = document.getElementById("map-tooltip");
  const productSelect = document.getElementById("product-select");
  const visualAssets = { truck: new Image(), agv: new Image() };
  const CENTRAL_SHEET_CONNECTOR = Object.freeze({
    webAppUrl: "https://script.google.com/macros/s/AKfycbxTRSF5t4C1_vy9YrrkFrf8ENtxc8S6bCa72LFsuaoySdVdKZYwbwZE-t8J4oM_fpQ1ow/exec",
    key: "693d5190eac0e1e3e18cb2ec7e88b36047ae"
  });
  visualAssets.truck.src = "assets/isometric-semi-truck.png?v=1";
  visualAssets.agv.src = "assets/isometric-agv.png?v=1";

  const TILE_W = 76;
  const TILE_H = 38;
  const MAP_COLS = 18;
  const MAP_ROWS = 14;
  const DPR_LIMIT = 2;

  const locations = [
    { code: "A1-01", sku: "R001", name: "Rice Flour", category: "Dry goods", col: 2.5, row: 2.1, span: 2, stock: 120, capacity: 160, levels: 3, color: "#4678b8", productColor: "#d9a441" },
    { code: "A1-02", sku: "C004", name: "Coconut Milk", category: "Beverage", col: 6.5, row: 2.1, span: 2, stock: 48, capacity: 80, levels: 3, color: "#4678b8", productColor: "#5cbf73" },
    { code: "A1-03", sku: "F009", name: "Frozen Corn", category: "Frozen", col: 10.5, row: 2.1, span: 2, stock: 18, capacity: 70, levels: 4, color: "#4678b8", productColor: "#7ec8e3" },
    { code: "B2-01", sku: "W011", name: "Mineral Water", category: "Beverage", col: 2.5, row: 6, span: 2, stock: 96, capacity: 120, levels: 4, color: "#285f9e", productColor: "#5aa8ff" },
    { code: "B2-03", sku: "A001", name: "UHT Milk", category: "Dairy", col: 6.5, row: 6, span: 2, stock: 50, capacity: 100, levels: 4, color: "#285f9e", productColor: "#69a7ff" },
    { code: "B3-03", sku: "A002", name: "Orange Juice", category: "Beverage", col: 10.5, row: 6, span: 2, stock: 30, capacity: 80, levels: 4, color: "#285f9e", productColor: "#f28b4b" },
    { code: "C3-01", sku: "A003", name: "Snack Box", category: "Snack", col: 2.5, row: 9.9, span: 2, stock: 80, capacity: 120, levels: 3, color: "#174b84", productColor: "#e56c92" },
    { code: "C3-02", sku: "P010", name: "Packaging Set", category: "Material", col: 6.5, row: 9.9, span: 2, stock: 15, capacity: 60, levels: 3, color: "#174b84", productColor: "#b18bd5" },
    { code: "C3-03", sku: "B014", name: "Carton Box", category: "Material", col: 10.5, row: 9.9, span: 2, stock: 62, capacity: 100, levels: 3, color: "#174b84", productColor: "#c8915a" }
  ];

  try {
    const savedColors = JSON.parse(localStorage.getItem("warehouse-product-colors") || "{}");
    locations.forEach(item => { if (/^#[0-9a-f]{6}$/i.test(savedColors[item.sku] || "")) item.productColor = savedColors[item.sku]; });
  } catch (_) {}

  const state = {
    selected: "B2-03",
    hovered: null,
    scale: 0.86,
    offsetX: 0,
    offsetY: 0,
    targetX: 0,
    targetY: 0,
    dragging: false,
    dragStart: null,
    pointer: { x: 0, y: 0 },
    hits: [],
    pulse: 0,
    initialized: false,
    agv: null,
    stagingPallet: null
  };

  const palette = {
    floor: "#e6eef7",
    grid: "rgba(134, 158, 184, .42)",
    wallLeft: "#d5e1ed",
    wallRight: "#c3d3e3",
    wallTop: "#edf4fa",
    blue: "#0757d5",
    cyan: "#18b8dc",
    green: "#20a45c",
    orange: "#e79218",
    ink: "#153252",
    boxTop: "#f4c36c",
    boxLeft: "#d99839",
    boxRight: "#bd7622"
  };

  const activities = [
    { type: "in", sku: "A001", qty: 20, code: "B2-03", time: "10:21" },
    { type: "out", sku: "A002", qty: 5, code: "B3-03", time: "10:15" },
    { type: "sync", sku: "Google Sheet", qty: 0, code: "Workshop Data", time: "10:12" }
  ];

  function iso(col, row, z = 0) {
    return {
      x: (col - row) * TILE_W / 2,
      y: (col + row) * TILE_H / 2 - z
    };
  }

  function worldToScreen(point) {
    return {
      x: point.x * state.scale + state.offsetX,
      y: point.y * state.scale + state.offsetY
    };
  }

  function screenToWorld(point) {
    return {
      x: (point.x - state.offsetX) / state.scale,
      y: (point.y - state.offsetY) / state.scale
    };
  }

  function path(points, fill, stroke, width = 1) {
    ctx.beginPath();
    points.forEach((p, index) => index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  }

  function line(a, b, color, width = 1) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function shade(hex, delta) {
    let r, g, b;
    if (hex.startsWith("#")) {
      const value = parseInt(hex.slice(1), 16);
      r = value >> 16; g = (value >> 8) & 255; b = value & 255;
    } else {
      const values = hex.match(/[\d.]+/g);
      if (!values || values.length < 3) return hex;
      [r, g, b] = values.map(Number);
    }
    r = Math.max(0, Math.min(255, r + delta));
    g = Math.max(0, Math.min(255, g + delta));
    b = Math.max(0, Math.min(255, b + delta));
    return `rgb(${r}, ${g}, ${b})`;
  }

  function drawFloor() {
    const a = iso(0, 0), b = iso(MAP_COLS, 0), c = iso(MAP_COLS, MAP_ROWS), d = iso(0, MAP_ROWS);
    path([a, b, c, d], palette.floor, null);
    for (let col = 0; col <= MAP_COLS; col++) line(iso(col, 0), iso(col, MAP_ROWS), palette.grid, col % 2 === 0 ? 1.2 : .65);
    for (let row = 0; row <= MAP_ROWS; row++) line(iso(0, row), iso(MAP_COLS, row), palette.grid, row % 2 === 0 ? 1.2 : .65);

    drawZoneTint(1.1, 1.55, 11.9, 2.15, "rgba(70, 120, 184, .055)");
    drawZoneTint(1.1, 5.45, 11.9, 2.15, "rgba(40, 95, 158, .055)");
    drawZoneTint(1.1, 9.35, 11.9, 2.15, "rgba(23, 75, 132, .055)");
    drawTravelLanes();
    drawCrosswalk(13.72, 6.7);
    drawFloorBay(14.55, .2, 3.4, 3.15, "OUTBOUND", "#e06b35");
    drawFloorBay(14.55, 10.5, 3.4, 3.4, "INBOUND", "#13a768");
  }

  function drawZoneTint(col, row, w, h, fill) {
    path([iso(col, row), iso(col + w, row), iso(col + w, row + h), iso(col, row + h)], fill, null);
  }

  function drawTravelLanes() {
    drawZoneTint(13.65, .45, 1.05, 12.95, "rgba(35, 116, 194, .07)");
    [3.65, 7.55, 11.45].forEach(row => drawZoneTint(1.6, row, 12.6, .82, "rgba(35, 116, 194, .055)"));
    ctx.save();
    ctx.setLineDash([8, 7]);
    line(iso(14.18, .9), iso(14.18, 13), "rgba(25,102,178,.5)", 1.8);
    [4.06, 7.96, 11.86].forEach(row => line(iso(2.1, row), iso(14.18, row), "rgba(25,102,178,.34)", 1.35));
    ctx.restore();
  }

  function drawCrosswalk(col, row) {
    for (let i = 0; i < 6; i++) {
      drawZoneTint(col, row + i * .17, .92, .085, i % 2 ? "rgba(255,255,255,.72)" : "rgba(255,255,255,.92)");
    }
  }

  function drawFloorBay(col, row, w, d, label, color) {
    const points = [iso(col, row), iso(col + w, row), iso(col + w, row + d), iso(col, row + d)];
    path(points, `${color}22`, color, 2);
    const inset = .16;
    path([
      iso(col + inset, row + inset),
      iso(col + w - inset, row + inset),
      iso(col + w - inset, row + d - inset),
      iso(col + inset, row + d - inset)
    ], null, `${color}88`, 1);
    const center = iso(col + w / 2, row + d / 2);
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(Math.atan2(TILE_H, TILE_W));
    ctx.fillStyle = color;
    ctx.font = "900 10px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  function drawExteriorYard() {
    path([iso(1.45, -5.95), iso(13.45, -5.95), iso(13.45, 0), iso(1.45, 0)], "#d4dde5", "#b2bfcb", 1);
    drawTruckAtDock(3.5);
    drawTruckAtDock(7.5);
    drawTruckAtDock(11.5);
  }

  function drawTruckAtDock(centerCol) {
    line(iso(centerCol - 1, -5.8), iso(centerCol - 1, -.08), "rgba(245,181,27,.72)", 1.6);
    line(iso(centerCol + 1, -5.8), iso(centerCol + 1, -.08), "rgba(245,181,27,.72)", 1.6);
    if (!visualAssets.truck.complete || !visualAssets.truck.naturalWidth) return;
    const rearDock = iso(centerCol, -.02);
    ctx.drawImage(visualAssets.truck, rearDock.x - 23, rearDock.y - 202, 310, 210);
  }

  function drawWarehouseFixtures() {
    [[14.47, .12], [17.97, .12], [14.47, 10.42], [17.97, 10.42]].forEach(([col, row]) => drawSafetyBollard(col, row));
  }

  function drawSafetyBollard(col, row) {
    drawPrism(col, row, 0, .11, .11, 8, "#202c37");
    drawPrism(col, row, 8, .11, .11, 8, "#f1b51c");
    drawPrism(col, row, 16, .11, .11, 4, "#202c37");
  }

  function drawWalls() {
    const height = 138;
    const origin = iso(0, 0), northEast = iso(MAP_COLS, 0), northWest = iso(0, MAP_ROWS);
    path([origin, northEast, iso(MAP_COLS, 0, height), iso(0, 0, height)], palette.wallRight, "#aebdcd", 1.5);
    path([origin, northWest, iso(0, MAP_ROWS, height), iso(0, 0, height)], palette.wallLeft, "#aebdcd", 1.5);
    path([iso(0, 0, height), iso(MAP_COLS, 0, height), iso(MAP_COLS, .4, height), iso(0, .4, height)], palette.wallTop, "#afbdcb", 1);
    path([iso(0, 0, height), iso(0, MAP_ROWS, height), iso(.4, MAP_ROWS, height), iso(.4, 0, height)], palette.wallTop, "#afbdcb", 1);

    drawWallRowPlaque(2.15, "A", "#4678b8");
    drawWallRowPlaque(6.05, "B", "#285f9e");
    drawWallRowPlaque(9.95, "C", "#174b84");
    drawWallBayPlaque(2.85, "1", "#326cad");
    drawWallBayPlaque(6.85, "2", "#285f9e");
    drawWallBayPlaque(10.85, "3", "#174b84");
    drawDock(2.7, 0);
    drawDock(6.7, 0);
    drawDock(10.7, 0);
  }

  function drawWallRowPlaque(row, label, color) {
    const plaqueLength = 1.5, low = 98, high = 132, col = .025;
    const points = [iso(col, row, low), iso(col, row + plaqueLength, low), iso(col, row + plaqueLength, high), iso(col, row, high)];
    ctx.save();
    ctx.shadowColor = "rgba(17,42,69,.28)";
    ctx.shadowBlur = 7;
    ctx.shadowOffsetY = 3;
    path(points, color, "rgba(255,255,255,.75)", 1);
    ctx.restore();
    const center = iso(col, row + plaqueLength / 2, (low + high) / 2);
    ctx.save();
    // Shear the baseline onto the left wall while keeping the glyphs vertically upright.
    ctx.transform(1, -TILE_H / TILE_W, 0, 1, center.x, center.y);
    ctx.fillStyle = "#fff";
    ctx.font = "900 24px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  function drawWallBayPlaque(col, label, color) {
    const plaqueLength = 1.3, low = 98, high = 132, row = .025;
    const points = [iso(col, row, low), iso(col + plaqueLength, row, low), iso(col + plaqueLength, row, high), iso(col, row, high)];
    ctx.save();
    ctx.shadowColor = "rgba(17,42,69,.28)";
    ctx.shadowBlur = 7;
    ctx.shadowOffsetY = 3;
    path(points, color, "rgba(255,255,255,.75)", 1);
    ctx.restore();
    const center = iso(col + plaqueLength / 2, row, (low + high) / 2);
    ctx.save();
    // Mirror the wall projection on the back wall; rotating the whole glyph looks tilted.
    ctx.transform(1, TILE_H / TILE_W, 0, 1, center.x, center.y);
    ctx.fillStyle = "#fff";
    ctx.font = "900 24px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  function drawDock(col, row) {
    const w = 1.6, h = 86;
    const a = iso(col, row, 0), b = iso(col + w, row, 0), bt = iso(col + w, row, h), at = iso(col, row, h);
    path([a, b, bt, at], "#254767", "#16344f", 2);
    for (let i = 1; i < 4; i++) line(iso(col, row, i * h / 4), iso(col + w, row, i * h / 4), "rgba(255,255,255,.34)", 1);
    drawPrism(col - .1, -.06, 1, .1, .16, 26, "#202b35");
    drawPrism(col + w, -.06, 1, .1, .16, 26, "#202b35");
  }

  function drawRack(item, selected, hovered) {
    const x1 = item.col, x2 = item.col + item.span;
    const y1 = item.row, y2 = item.row + 1.12;
    const compartmentH = 29;
    const depth = item.levels * compartmentH + 6;
    const baseA = iso(x1, y1), baseB = iso(x2, y1), baseC = iso(x2, y2), baseD = iso(x1, y2);
    const topA = iso(x1, y1, depth), topB = iso(x2, y1, depth), topC = iso(x2, y2, depth), topD = iso(x1, y2, depth);

    // Soft footprint shadow grounds the open steel structure on the floor.
    ctx.save();
    ctx.filter = "blur(5px)";
    path(
      [iso(x1 + .04, y1 + .12), iso(x2 + .2, y1 + .12), iso(x2 + .2, y2 + .24), iso(x1 + .04, y2 + .24)],
      selected ? "rgba(24,184,220,.22)" : "rgba(16,43,73,.13)",
      null
    );
    ctx.restore();

    if (selected) {
      ctx.save();
      ctx.shadowColor = `rgba(22, 184, 220, ${.45 + Math.sin(state.pulse) * .12})`;
      ctx.shadowBlur = 24;
      path([baseA, baseB, baseC, baseD], "rgba(22,184,220,.12)", palette.cyan, 3.2);
      ctx.restore();
    } else if (hovered) {
      path([baseA, baseB, baseC, baseD], "rgba(22,184,220,.08)", "rgba(22,168,224,.8)", 2);
    }

    const steel = selected ? "#1176d3" : hovered ? "#7f91a2" : "#929da8";
    const steelDark = selected ? "#07559f" : "#5d6975";
    const beam = selected ? "#18aeca" : "#aeb7bf";
    const shelf = selected ? "#dcecf7" : "#d8dde2";
    const post = .085;

    // Back uprights and braces first, matching the depth ordering of the Vue artwork.
    drawPrism(x1, y1, 0, post, post, depth, steel);
    drawPrism(x2 - post, y1, 0, post, post, depth, steel);
    drawBrace(x1 + post / 2, y2 - post / 2, 5, x1 + post / 2, y1 + post / 2, depth - 7, steelDark, 2.3);
    drawBrace(x2 - post / 2, y2 - post / 2, 5, x2 - post / 2, y1 + post / 2, depth - 7, steelDark, 2.3);

    const slotsAcross = Math.max(3, Math.round(item.span * 2));
    const totalSlots = slotsAcross * item.levels;
    const filledSlots = Math.round((item.stock / item.capacity) * totalSlots);
    let placed = 0;

    for (let level = 0; level < item.levels; level++) {
      const shelfZ = level * compartmentH;
      // Thin pale shelf deck plus a bright orange front beam.
      drawPrism(x1 + post, y1 + post, shelfZ, item.span - post * 2, 1.12 - post * 2, 3.1, shelf);
      drawPrism(x1 + post, y2 - .11, shelfZ, item.span - post * 2, .1, 6.2, beam);
      drawPrism(x2 - .11, y1 + post, shelfZ, .1, 1.12 - post * 2, 6.2, shade(beam, -18));

      const boxGap = .055;
      const usable = item.span - .28;
      const boxW = usable / slotsAcross - boxGap;
      const boxDepth = .68;
      for (let slot = 0; slot < slotsAcross && placed < filledSlots; slot++, placed++) {
        drawCarton(x1 + .14 + slot * (usable / slotsAcross), y1 + .18, shelfZ + 4, boxW, boxDepth, compartmentH * .59, item.productColor);
      }
    }

    // Front uprights and top rails are last so their silhouette stays crisp.
    drawPrism(x1, y2 - post, 0, post, post, depth, steel);
    drawPrism(x2 - post, y2 - post, 0, post, post, depth, steel);
    drawPrism(x1, y1, depth - 4, item.span, post, 4, steel);
    drawPrism(x1, y2 - post, depth - 4, item.span, post, 4, steel);
    drawPrism(x1, y1, depth - 4, post, 1.12, 4, steelDark);
    drawPrism(x2 - post, y1, depth - 4, post, 1.12, 4, steelDark);

    const labelPos = iso((x1 + x2) / 2, y1 + .56, depth + 13);
    const labelText = item.code;
    ctx.font = "800 11px system-ui";
    const labelWidth = ctx.measureText(labelText).width + 14;
    ctx.fillStyle = selected ? palette.blue : "rgba(255,255,255,.92)";
    ctx.save();
    ctx.shadowColor = "rgba(15,36,62,.2)";
    ctx.shadowBlur = 7;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.roundRect(labelPos.x - labelWidth / 2, labelPos.y - 10, labelWidth, 20, 6);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = selected ? "#ffffff" : palette.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(labelText, labelPos.x, labelPos.y);

    const hitPolygon = [topA, topB, baseB, baseC, baseD, topD];
    state.hits.push({ item, polygon: hitPolygon });
  }

  function drawBrace(c1, r1, z1, c2, r2, z2, color, width) {
    line(iso(c1, r1, z1), iso(c2, r2, z2), color, width);
    line(iso(c1, r1, z1 + 2), iso(c2, r2, z2 + 2), "rgba(255,255,255,.24)", Math.max(1, width * .38));
  }

  function drawPrism(col, row, z, w, d, h, color) {
    const pA = iso(col, row, z), pB = iso(col + w, row, z), pC = iso(col + w, row + d, z), pD = iso(col, row + d, z);
    const at = iso(col, row, z + h), bt = iso(col + w, row, z + h), ct = iso(col + w, row + d, z + h), dt = iso(col, row + d, z + h);
    path([dt, ct, pC, pD], shade(color, -18), "rgba(20,35,55,.18)", .55);
    path([bt, ct, pC, pB], shade(color, -36), "rgba(20,35,55,.18)", .55);
    path([at, bt, ct, dt], shade(color, 22), "rgba(20,35,55,.16)", .55);
  }

  function drawCarton(col, row, z, w, d, boxHeight, color = "#e8a83c") {
    drawPrism(col, row, z, w, d, boxHeight, color);
    const topLeft = iso(col + w * .5, row, z + boxHeight + .2);
    const bottomLeft = iso(col + w * .5, row + d, z + boxHeight + .2);
    line(topLeft, bottomLeft, "rgba(32,47,65,.38)", .65);
  }

  function drawDynamicStaging() {
    const pallet = state.stagingPallet;
    if (!pallet) return;
    if (performance.now() >= pallet.expiresAt) {
      state.stagingPallet = null;
      return;
    }
    // Keep the temporary pallet in its own side slot so it never covers the parked AGV.
    const position = pallet.type === "in" ? { col: 14.75, row: 12.85 } : { col: 14.75, row: 2.15 };
    drawPallet(position.col, position.row, pallet.sku, pallet.color);
  }

  function drawPallet(col, row, label, cargoColor) {
    const palletW = 1.35, palletD = .92;
    const wood = "#b47b43", woodDark = "#7d4f29";

    // Three lower runners and five separated top slats keep the pallet visibly wooden.
    [0.05, .41, .77].forEach(offset => drawPrism(col + .05, row + offset, 0, palletW - .1, .1, 3, woodDark));
    for (let i = 0; i < 5; i++) drawPrism(col + .06 + i * .255, row + .04, 3, .18, palletD - .08, 2.7, wood);

    // Cargo is stacked on the deck, with a small offset between tiers.
    drawCarton(col + .12, row + .09, 6, .5, .36, 19, cargoColor);
    drawCarton(col + .69, row + .09, 6, .5, .36, 19, cargoColor);
    drawCarton(col + .19, row + .49, 6, .5, .32, 19, shade(cargoColor, 12));
    drawCarton(col + .76, row + .49, 6, .44, .32, 19, shade(cargoColor, -8));
    drawCarton(col + .4, row + .24, 26, .52, .38, 17, shade(cargoColor, 6));

    const t = iso(col + palletW / 2, row + palletD + .17);
    ctx.font = "800 8px system-ui";
    const tagW = ctx.measureText(label).width + 12;
    ctx.fillStyle = "rgba(255,255,255,.94)";
    ctx.beginPath(); ctx.roundRect(t.x - tagW / 2, t.y - 7, tagW, 16, 5); ctx.fill();
    ctx.fillStyle = palette.ink; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, t.x, t.y + 1);
  }

  function drawAgv() {
    const inHome = { col: 16.65, row: 12.35 };
    const outHome = { col: 16.65, row: 1.55 };
    const job = state.agv;
    if (!job) {
      drawAgvVehicle(outHome, false, "#f28b4b", "AGV-OUT · READY", "out");
      drawAgvVehicle(inHome, false, "#69a7ff", "AGV-IN · READY", "in");
      return;
    }

    if (job.type === "in") drawAgvVehicle(outHome, false, "#f28b4b", "AGV-OUT · READY", "out");
    else drawAgvVehicle(inHome, false, "#69a7ff", "AGV-IN · READY", "in");

    const elapsed = performance.now() - job.startedAt;
    if (elapsed < 0) {
      drawAgvVehicle(job.route[0], false, job.item.productColor, "AGV-IN · LOADING", "in");
      return;
    }
    const progress = Math.min(1, elapsed / job.duration);
    const travel = progress * job.totalDistance;
    let segmentIndex = job.segments.length - 1;
    for (let i = 0; i < job.segments.length; i++) {
      if (travel <= job.segments[i].end) { segmentIndex = i; break; }
    }
    const segment = job.segments[segmentIndex];
    const local = Math.max(0, Math.min(1, (travel - segment.start) / (segment.length || 1)));
    const position = {
      col: segment.from.col + (segment.to.col - segment.from.col) * local,
      row: segment.from.row + (segment.to.row - segment.from.row) * local
    };

    if (!job.applied && segmentIndex >= job.targetSegment) applyAgvStock(job);
    const loaded = job.type === "in" ? segmentIndex < job.targetSegment : segmentIndex >= job.targetSegment;
    drawAgvVehicle(position, loaded, job.item.productColor, job.type === "in" ? "AGV-IN · RECEIVING" : "AGV-OUT · PICKING", job.type);

    if (progress >= 1) finishAgvJob();
  }

  function drawAgvVehicle(position, loaded, cargoColor, label, role) {
    const { col, row } = position;
    const center = iso(col + .45, row + .31, 0);
    if (visualAssets.agv.complete && visualAssets.agv.naturalWidth) {
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.scale(-1, 1);
      ctx.drawImage(visualAssets.agv, -52, -50, 104, 66);
      ctx.restore();
    }
    if (loaded) {
      [0, .13, .26].forEach(offset => drawPrism(col + .14, row + .11 + offset, 15, .64, .07, 2.2, "#9a6538"));
      drawCarton(col + .19, row + .15, 17.2, .52, .31, 14, cargoColor);
    }

    const beacon = iso(col + .46, row + .3, loaded ? 35 : 22);
    ctx.beginPath();
    ctx.arc(beacon.x, beacon.y, 2.7 + Math.sin(state.pulse * 2) * .45, 0, Math.PI * 2);
    ctx.fillStyle = role === "in" ? "#20d47a" : "#ff8a35";
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10; ctx.fill(); ctx.shadowBlur = 0;

    const tag = iso(col + .46, row + .3, loaded ? 45 : 33);
    ctx.font = "800 8px system-ui";
    const tagW = ctx.measureText(label).width + 12;
    ctx.fillStyle = role === "in" ? "rgba(13,87,73,.94)" : "rgba(145,60,22,.94)";
    ctx.beginPath(); ctx.roundRect(tag.x - tagW / 2, tag.y - 8, tagW, 16, 5); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, tag.x, tag.y);
  }

  function render() {
    const width = frame.clientWidth;
    const height = frame.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_LIMIT);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (!state.initialized) resetView();
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(state.offsetX, state.offsetY);
    ctx.scale(state.scale, state.scale);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    state.hits = [];

    drawFloor();
    drawExteriorYard();
    drawWalls();
    drawWarehouseFixtures();
    [...locations]
      .sort((a, b) => (a.col + a.row) - (b.col + b.row))
      .forEach(item => drawRack(item, item.code === state.selected, item.code === state.hovered));
    drawDynamicStaging();
    drawAgv();
    ctx.restore();

    state.pulse += .045;
    requestAnimationFrame(render);
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      const intersect = ((yi > point.y) !== (yj > point.y)) && (point.x < (xj - xi) * (point.y - yi) / ((yj - yi) || .0001) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function itemAt(screenPoint) {
    const world = screenToWorld(screenPoint);
    for (let i = state.hits.length - 1; i >= 0; i--) if (pointInPolygon(world, state.hits[i].polygon)) return state.hits[i].item;
    return null;
  }

  function showTooltip(item, x, y) {
    if (!item) { tooltip.hidden = true; return; }
    tooltip.innerHTML = `<strong>${item.code} · ${item.sku}</strong><span>${item.name}<br>Stock ${item.stock}/${item.capacity} ชิ้น</span>`;
    tooltip.hidden = false;
    const left = Math.min(frame.clientWidth - 260, Math.max(10, x + 14));
    const top = Math.min(frame.clientHeight - 100, Math.max(10, y + 14));
    tooltip.style.transform = `translate(${left}px, ${top}px)`;
  }

  function selectLocation(code, focus = false) {
    const item = locations.find(entry => entry.code === code);
    if (!item) return;
    state.selected = code;
    productSelect.value = item.sku;
    document.getElementById("location-code").textContent = item.code;
    document.getElementById("product-name").textContent = item.name;
    document.getElementById("product-sku").textContent = `SKU ${item.sku} · ${item.category}`;
    const productIcon = document.getElementById("product-icon");
    productIcon.textContent = item.category.slice(0, 4).toUpperCase();
    productIcon.style.background = `linear-gradient(145deg, ${shade(item.productColor, 28)}, ${shade(item.productColor, -24)})`;
    const productColor = document.getElementById("product-color");
    productColor.value = item.productColor;
    document.getElementById("color-preview").style.background = item.productColor;
    document.getElementById("stock-value").textContent = item.stock;
    document.getElementById("stock-meter").style.width = `${Math.min(100, item.stock / item.capacity * 100)}%`;
    document.querySelector(".stock-meter").setAttribute("aria-valuenow", item.stock);
    document.querySelector(".stock-meter").setAttribute("aria-valuemax", item.capacity);
    document.getElementById("capacity-value").textContent = `Capacity ${item.capacity}`;
    document.getElementById("result-title").textContent = `${item.sku} อยู่ที่ ${item.code}`;
    document.getElementById("result-detail").textContent = `${item.name} · ${item.stock} ชิ้น`;
    if (focus) focusItem(item);
  }

  function focusItem(item) {
    const center = iso(item.col + item.span / 2, item.row + .6, 40);
    state.offsetX = frame.clientWidth / 2 - center.x * state.scale;
    state.offsetY = frame.clientHeight / 2 - center.y * state.scale;
  }

  function resetView() {
    state.scale = frame.clientWidth < 700 ? .41 : Math.min(.88, frame.clientWidth / 1280);
    const center = iso(MAP_COLS / 2, 6, 20);
    state.offsetX = frame.clientWidth / 2 - center.x * state.scale;
    state.offsetY = frame.clientHeight / 2 - center.y * state.scale + 30;
    state.initialized = true;
  }

  function zoomAt(factor, center = { x: frame.clientWidth / 2, y: frame.clientHeight / 2 }) {
    const before = screenToWorld(center);
    state.scale = Math.max(.42, Math.min(1.75, state.scale * factor));
    state.offsetX = center.x - before.x * state.scale;
    state.offsetY = center.y - before.y * state.scale;
  }

  function addActivity(type, item, qty) {
    activities.unshift({ type, sku: item.sku, qty: Math.abs(qty), code: item.code, time: new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) });
    activities.splice(4);
    renderActivities();
  }

  function renderActivities() {
    const list = document.getElementById("activity-list");
    list.innerHTML = activities.map(activity => {
      if (activity.type === "sync") return `<div class="activity-item"><div class="activity-symbol">↻</div><div class="activity-copy"><strong>Synced ${activity.sku}</strong><small>${activity.time} · ${activity.code}</small></div><div class="activity-qty">✓</div></div>`;
      const incoming = activity.type === "in";
      return `<div class="activity-item ${incoming ? "" : "out"}"><div class="activity-symbol">${incoming ? "↓" : "↑"}</div><div class="activity-copy"><strong>${incoming ? "Receive" : "Pick"} ${activity.sku}</strong><small>${activity.time} · ${activity.code}</small></div><div class="activity-qty">${incoming ? "+" : "−"}${activity.qty}</div></div>`;
    }).join("");
  }

  function startAgvJob(delta, type) {
    if (state.agv) return;
    const item = locations.find(entry => entry.code === state.selected);
    const next = Math.max(0, Math.min(item.capacity, item.stock + delta));
    const actual = next - item.stock;
    if (!actual) return;
    const now = performance.now();
    const loadingDelay = type === "in" ? 950 : 0;
    const start = type === "in" ? { col: 16.65, row: 12.35 } : { col: 16.65, row: 1.55 };
    const aisleRow = item.row + 1.55;
    const target = { col: item.col + item.span / 2, row: aisleRow };
    const route = [
      start,
      { col: 14.18, row: start.row },
      { col: 14.18, row: aisleRow },
      target,
      { col: 14.18, row: aisleRow },
      { col: 14.18, row: start.row },
      start
    ];
    let totalDistance = 0;
    const segments = route.slice(0, -1).map((from, index) => {
      const to = route[index + 1];
      const length = Math.hypot(to.col - from.col, to.row - from.row);
      const segment = { from, to, length, start: totalDistance, end: totalDistance + length };
      totalDistance += length;
      return segment;
    });
    state.agv = {
      type, item, delta: actual, route, segments, totalDistance,
      operationId: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      targetSegment: 3,
      startedAt: now + loadingDelay,
      duration: Math.max(4600, totalDistance * 230),
      applied: false
    };
    state.stagingPallet = type === "in" ? {
      type: "in", sku: item.sku, color: item.productColor, expiresAt: now + loadingDelay
    } : null;
    document.getElementById("receive-stock").disabled = true;
    document.getElementById("pick-stock").disabled = true;
    document.getElementById("result-title").textContent = type === "in" ? `AGV กำลังนำ ${item.sku} เข้าชั้น` : `AGV กำลังไปรับ ${item.sku}`;
    document.getElementById("result-detail").textContent = `${type === "in" ? "INBOUND" : "OUTBOUND"} → ${item.code}`;
  }

  function applyAgvStock(job) {
    job.applied = true;
    job.item.stock = Math.max(0, Math.min(job.item.capacity, job.item.stock + job.delta));
    addActivity(job.type, job.item, job.delta);
    selectLocation(job.item.code);
    pushStockToSheet(job);
  }

  function finishAgvJob() {
    const job = state.agv;
    if (!job) return;
    if (!job.applied) applyAgvStock(job);
    if (job.type === "out") {
      state.stagingPallet = {
        type: "out", sku: job.item.sku, color: job.item.productColor, expiresAt: performance.now() + 2800
      };
    }
    state.agv = null;
    document.getElementById("receive-stock").disabled = false;
    document.getElementById("pick-stock").disabled = false;
  }

  function renderProductOptions() {
    const selectedSku = locations.find(item => item.code === state.selected)?.sku;
    productSelect.replaceChildren(...locations.map(item => {
      const option = document.createElement("option");
      option.value = item.sku;
      option.textContent = `${item.sku} · ${item.name} — ${item.code}`;
      return option;
    }));
    if (selectedSku) productSelect.value = selectedSku;
  }

  renderProductOptions();
  document.getElementById("product-search").addEventListener("submit", event => {
    event.preventDefault();
    const item = locations.find(entry => entry.sku === productSelect.value);
    if (item) selectLocation(item.code, true);
  });
  productSelect.addEventListener("change", () => {
    const item = locations.find(entry => entry.sku === productSelect.value);
    if (item) selectLocation(item.code, false);
  });

  document.getElementById("product-color").addEventListener("input", event => {
    const item = locations.find(entry => entry.code === state.selected);
    if (!item) return;
    item.productColor = event.target.value;
    document.getElementById("color-preview").style.background = item.productColor;
    document.getElementById("product-icon").style.background = `linear-gradient(145deg, ${shade(item.productColor, 28)}, ${shade(item.productColor, -24)})`;
    localStorage.setItem("warehouse-product-colors", JSON.stringify(Object.fromEntries(locations.map(entry => [entry.sku, entry.productColor]))));
    scheduleColorSync(item);
  });

  canvas.addEventListener("pointermove", event => {
    const rect = canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    state.pointer = point;
    if (state.dragging && state.dragStart) {
      state.offsetX = state.dragStart.offsetX + point.x - state.dragStart.x;
      state.offsetY = state.dragStart.offsetY + point.y - state.dragStart.y;
      tooltip.hidden = true;
      return;
    }
    const item = itemAt(point);
    state.hovered = item ? item.code : null;
    canvas.style.cursor = item ? "pointer" : "grab";
    showTooltip(item, point.x, point.y);
  });
  canvas.addEventListener("pointerleave", () => { state.hovered = null; tooltip.hidden = true; });
  canvas.addEventListener("pointerdown", event => {
    const rect = canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const item = itemAt(point);
    if (item) { selectLocation(item.code); return; }
    state.dragging = true;
    state.dragStart = { x: point.x, y: point.y, offsetX: state.offsetX, offsetY: state.offsetY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointerup", event => { state.dragging = false; state.dragStart = null; try { canvas.releasePointerCapture(event.pointerId); } catch (_) {} });
  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAt(event.deltaY < 0 ? 1.08 : .92, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }, { passive: false });

  document.getElementById("zoom-in").addEventListener("click", () => zoomAt(1.15));
  document.getElementById("zoom-out").addEventListener("click", () => zoomAt(.87));
  document.getElementById("reset-view").addEventListener("click", resetView);
  document.getElementById("receive-stock").addEventListener("click", () => startAgvJob(20, "in"));
  document.getElementById("pick-stock").addEventListener("click", () => startAgvJob(-10, "out"));
  document.getElementById("clear-log").addEventListener("click", () => { activities.length = 0; renderActivities(); });

  const modal = document.getElementById("sheet-modal");
  const sheetUrl = document.getElementById("sheet-url");
  const connectButton = document.getElementById("connect-sheet");
  const connectionNote = document.getElementById("connection-note");
  const sheetStatus = document.getElementById("sheet-status");
  const syncBadge = document.getElementById("sync-badge");
  const syncBadgeText = document.getElementById("sync-badge-text");
  const sheetConnection = {
    sheetUrl: localStorage.getItem("warehouse-sheet-url") || "",
    webAppUrl: CENTRAL_SHEET_CONNECTOR.webAppUrl,
    key: CENTRAL_SHEET_CONNECTOR.key
  };

  sheetUrl.value = sheetConnection.sheetUrl;

  function isWebAppUrl(value) {
    return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(value);
  }

  function sheetIdFromUrl(value) {
    return String(value || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] || "";
  }

  function setSheetStatus(mode, text, detail) {
    sheetStatus.textContent = text;
    syncBadge.classList.toggle("syncing", mode === "syncing");
    syncBadge.classList.toggle("error", mode === "error");
    syncBadgeText.textContent = mode === "ready" ? "เชื่อมต่อ Google Sheet" : mode === "syncing" ? "กำลังซิงก์" : mode === "error" ? "ซิงก์ไม่สำเร็จ" : "ข้อมูลในเครื่อง";
    if (detail) {
      connectionNote.textContent = detail;
      connectionNote.className = `connection-note ${mode === "ready" ? "success" : mode === "error" ? "error" : ""}`;
    }
  }

  function jsonpRequest(params, timeout = 12000) {
    return new Promise((resolve, reject) => {
      if (!isWebAppUrl(sheetConnection.webAppUrl)) return reject(new Error("Web App URL ไม่ถูกต้อง"));
      const callbackName = `__warehouseSheet_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      const url = new URL(sheetConnection.webAppUrl);
      Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
      url.searchParams.set("callback", callbackName);
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        script.remove();
        try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
      };
      window[callbackName] = payload => { cleanup(); resolve(payload); };
      script.onerror = () => { cleanup(); reject(new Error("ติดต่อ Google Apps Script ไม่ได้")); };
      timer = setTimeout(() => { cleanup(); reject(new Error("การเชื่อมต่อหมดเวลา")); }, timeout);
      script.src = url.toString();
      document.head.appendChild(script);
    });
  }

  function applySheetRows(rows) {
    let updated = 0;
    rows.forEach(row => {
      const code = String(row.code || "").trim();
      const sku = String(row.sku || "").trim();
      const item = locations.find(entry => entry.code === code) || locations.find(entry => entry.sku === sku);
      if (!item) return;
      if (sku) item.sku = sku;
      if (row.name) item.name = String(row.name);
      if (row.category) item.category = String(row.category);
      const stock = Number(row.stock);
      const capacity = Number(row.capacity);
      if (Number.isFinite(stock)) item.stock = Math.max(0, stock);
      if (Number.isFinite(capacity) && capacity > 0) item.capacity = capacity;
      if (/^#[0-9a-f]{6}$/i.test(row.color || "")) item.productColor = row.color;
      updated += 1;
    });
    renderProductOptions();
    const selected = locations.find(entry => entry.code === state.selected) || locations[0];
    selectLocation(selected.code);
    return updated;
  }

  async function readSheetData({ announce = true } = {}) {
    if (announce) setSheetStatus("syncing", "กำลังโหลดข้อมูล…", "กำลังอ่าน Inventory จาก Google Sheet");
    const requestedSheetId = sheetIdFromUrl(sheetConnection.sheetUrl);
    if (!requestedSheetId) throw new Error("Google Sheet URL ไม่ถูกต้อง");
    const payload = await jsonpRequest({ action: "read", key: sheetConnection.key, sheetId: requestedSheetId, _: Date.now() });
    if (!payload || payload.ok !== true || !Array.isArray(payload.items)) throw new Error(payload?.error || "รูปแบบข้อมูลจาก Sheet ไม่ถูกต้อง");
    const expectedSheetId = sheetIdFromUrl(sheetConnection.sheetUrl);
    if (expectedSheetId && payload.spreadsheetId && expectedSheetId !== payload.spreadsheetId) throw new Error("Web App เชื่อมกับ Google Sheet คนละไฟล์");
    const updated = applySheetRows(payload.items);
    if (!updated) throw new Error("ไม่พบ Location ที่ตรงกับแผนที่");
    const now = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    setSheetStatus("ready", `ซิงก์แล้ว ${now}`, `เชื่อมต่อสำเร็จ · โหลด ${updated} ตำแหน่งจาก ${payload.sheetName || "Inventory"}`);
    return payload;
  }

  function submitSheetForm(fields) {
    return new Promise((resolve, reject) => {
      const frameName = `sheet_update_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const iframe = document.createElement("iframe");
      iframe.name = frameName;
      iframe.hidden = true;
      const form = document.createElement("form");
      form.method = "POST";
      form.action = sheetConnection.webAppUrl;
      form.target = frameName;
      form.hidden = true;
      Object.entries(fields).forEach(([name, value]) => {
        const input = document.createElement("input");
        input.name = name;
        input.value = value;
        form.appendChild(input);
      });
      document.body.append(iframe, form);
      try { form.submit(); } catch (error) { iframe.remove(); form.remove(); reject(error); return; }
      setTimeout(() => { iframe.remove(); form.remove(); resolve(); }, 1100);
    });
  }

  function submitSheetUpdate(job) {
    return submitSheetForm({
      action: "update",
      key: sheetConnection.key,
      sheetId: sheetIdFromUrl(sheetConnection.sheetUrl),
      operationId: job.operationId,
      code: job.item.code,
      sku: job.item.sku,
      delta: job.delta,
      type: job.type
    });
  }

  let colorSyncTimer;
  function scheduleColorSync(item) {
    if (!sheetConnection.webAppUrl || !sheetConnection.key) return;
    clearTimeout(colorSyncTimer);
    colorSyncTimer = setTimeout(async () => {
      try {
        setSheetStatus("syncing", "กำลังบันทึกสี…", `กำลังอัปเดตสีของ ${item.sku} ไปยัง Google Sheet`);
        await submitSheetForm({ action: "color", key: sheetConnection.key, sheetId: sheetIdFromUrl(sheetConnection.sheetUrl), code: item.code, sku: item.sku, color: item.productColor });
        await new Promise(resolve => setTimeout(resolve, 450));
        await readSheetData({ announce: false });
      } catch (error) {
        setSheetStatus("error", "บันทึกสีไม่สำเร็จ", error.message);
      }
    }, 450);
  }

  async function pushStockToSheet(job) {
    if (!sheetConnection.webAppUrl || !sheetConnection.key) return;
    try {
      setSheetStatus("syncing", "กำลังบันทึก Stock…", `กำลังส่ง ${job.item.sku} ${job.delta > 0 ? "+" : ""}${job.delta} ไปยัง Google Sheet`);
      await submitSheetUpdate(job);
      await new Promise(resolve => setTimeout(resolve, 500));
      await readSheetData({ announce: false });
    } catch (error) {
      setSheetStatus("error", "บันทึกไม่สำเร็จ", `${error.message} · ค่าในหน้าจอยังไม่ถูกส่งไป Google Sheet`);
    }
  }

  if (sheetConnection.sheetUrl) setSheetStatus("syncing", "กำลังเชื่อมต่อ…");
  document.getElementById("open-sheet-settings").addEventListener("click", () => { modal.hidden = false; requestAnimationFrame(() => sheetUrl.focus()); });
  document.getElementById("close-sheet-settings").addEventListener("click", () => { modal.hidden = true; });
  connectButton.addEventListener("click", async () => {
    const next = { sheetUrl: sheetUrl.value.trim() };
    if (!sheetIdFromUrl(next.sheetUrl)) {
      setSheetStatus("error", "ลิงก์ไม่ถูกต้อง", "กรุณาวางลิงก์ Google Sheet ที่ Fakduai Lab เตรียมให้");
      return;
    }
    sheetConnection.sheetUrl = next.sheetUrl;
    localStorage.setItem("warehouse-sheet-url", next.sheetUrl);
    connectButton.disabled = true;
    try {
      await readSheetData();
      activities.unshift({ type: "sync", sku: "Google Sheet", qty: 0, code: "Inventory", time: new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) });
      activities.splice(4);
      renderActivities();
      setTimeout(() => { modal.hidden = true; }, 500);
    } catch (error) {
      setSheetStatus("error", "เชื่อมต่อไม่สำเร็จ", error.message);
    } finally {
      connectButton.disabled = false;
    }
  });
  document.getElementById("use-demo-data").addEventListener("click", () => {
    localStorage.removeItem("warehouse-sheet-url");
    localStorage.removeItem("warehouse-web-app-url");
    localStorage.removeItem("warehouse-connection-key");
    sheetConnection.sheetUrl = "";
    sheetUrl.value = "";
    setSheetStatus("demo", "ใช้ข้อมูลตัวอย่าง", "ยกเลิกการเชื่อมต่อแล้ว การเปลี่ยน Stock จะอยู่เฉพาะในเครื่องนี้");
    modal.hidden = true;
  });
  modal.addEventListener("click", event => { if (event.target === modal) modal.hidden = true; });
  document.addEventListener("keydown", event => { if (event.key === "Escape") modal.hidden = true; });

  new ResizeObserver(() => { if (state.initialized) resetView(); }).observe(frame);
  selectLocation("B2-03");
  renderActivities();
  render();
  if (sheetConnection.sheetUrl) {
    readSheetData().catch(error => setSheetStatus("error", "เชื่อมต่อไม่สำเร็จ", error.message));
  }
})();
