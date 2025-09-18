'use strict';

// Directum Placement + Pricing Pack V1 (stubs)
// Exports helpers for px↔in conversion, manifest building, and pricing endpoint.

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function derivePxPerInFromZone(zone) {
  if (!zone || !zone.rectPx || !zone.physical) throw new Error('invalid zone spec');
  const { w, h } = zone.rectPx;
  const { w_in, h_in } = zone.physical;
  const sx = w_in > 0 ? (w / w_in) : 0;
  const sy = h_in > 0 ? (h / h_in) : 0;
  const pxPerIn = Math.max(1, Math.min(sx || sy || 0, isFinite(sx) ? sx : sy));
  return pxPerIn;
}

function boxPxToInches(bboxPx, pxPerIn) {
  const w_in = (bboxPx.x2 - bboxPx.x1) / pxPerIn;
  const h_in = (bboxPx.y2 - bboxPx.y1) / pxPerIn;
  return { w_in, h_in };
}

function offsetsInches(bboxPx, zone, pxPerIn, anchor) {
  // Basic: offsets from zone rect origin (x,y). Extend anchors later.
  const dx_px = bboxPx.x1 - zone.rectPx.x;
  const dy_px = bboxPx.y1 - zone.rectPx.y;
  return { x_in: dx_px / pxPerIn, y_in: dy_px / pxPerIn, anchor: anchor || 'zone_origin' };
}

function toPrinterSpec(bboxPx, zone, anchor) {
  const pxPerIn = derivePxPerInFromZone(zone);
  const art = boxPxToInches(bboxPx, pxPerIn);
  const off = offsetsInches(bboxPx, zone, pxPerIn, anchor);
  return {
    unit: 'in',
    pxPerIn,
    artWidthIn: Number(art.w_in.toFixed(3)),
    artHeightIn: Number(art.h_in.toFixed(3)),
    offsetXIn: Number(off.x_in.toFixed(3)),
    offsetYIn: Number(off.y_in.toFixed(3)),
    rotationDeg: Math.round(bboxPx.rot || 0),
    anchor: off.anchor,
    toleranceIn: 0.125
  };
}

/**
 * Derive pixels-per-inch from a rectangular zone in pixels and an imprint area in inches.
 * If both width and height are available, use the more conservative (min) scale.
 */
function derivePxPerInFromRectAndImprint(rectPx, imprintPhysical) {
  if (!rectPx || !imprintPhysical) throw new Error('invalid rect/imprint spec');
  const rw = Number(rectPx.w || (rectPx.x2 - rectPx.x1) || 0);
  const rh = Number(rectPx.h || (rectPx.y2 - rectPx.y1) || 0);
  const iw = Number(imprintPhysical.w_in || 0);
  const ih = Number(imprintPhysical.h_in || 0);
  const sx = iw > 0 ? rw / iw : 0;
  const sy = ih > 0 ? rh / ih : 0;
  const pxPerIn = Math.max(1, (sx && sy) ? Math.min(sx, sy) : (sx || sy));
  return pxPerIn;
}

/**
 * Build a printer spec when you only have a rectPx (origin and size) and a pxPerIn scale.
 * Offsets are measured from rectPx.x/y to the bboxPx.x1/y1.
 */
function toPrinterSpecFromRect(bboxPx, rectPx, pxPerIn, anchor) {
  if (!bboxPx || !rectPx || !pxPerIn) throw new Error('invalid printer rect spec');
  const art = boxPxToInches(bboxPx, pxPerIn);
  const dx_px = bboxPx.x1 - (rectPx.x != null ? rectPx.x : rectPx.x1);
  const dy_px = bboxPx.y1 - (rectPx.y != null ? rectPx.y : rectPx.y1);
  const offX = dx_px / pxPerIn;
  const offY = dy_px / pxPerIn;
  return {
    unit: 'in',
    pxPerIn,
    artWidthIn: Number(art.w_in.toFixed(3)),
    artHeightIn: Number(art.h_in.toFixed(3)),
    offsetXIn: Number(offX.toFixed(3)),
    offsetYIn: Number(offY.toFixed(3)),
    rotationDeg: Math.round(bboxPx.rot || 0),
    anchor: anchor || 'zone_origin',
    toleranceIn: 0.125
  };
}

function buildPlacementManifest(params) {
  const { productId, zoneName, bboxPx, zoneSpec, anchor } = params || {};
  const spec = toPrinterSpec(bboxPx, zoneSpec, anchor);
  return {
    productId,
    placement: {
      zone: zoneName,
      bboxPx,
      pxPerIn: spec.pxPerIn,
      printerSpec: {
        unit: spec.unit,
        artWidthIn: spec.artWidthIn,
        artHeightIn: spec.artHeightIn,
        anchor: spec.anchor,
        offsetXIn: spec.offsetXIn,
        offsetYIn: spec.offsetYIn,
        rotationDeg: spec.rotationDeg,
        toleranceIn: spec.toleranceIn
      }
    },
    createdAt: new Date().toISOString()
  };
}

async function loadZonesSpec(adapters, styleId) {
  const { s3GetJson } = adapters || {};
  const bucket = process.env.AWS_BUCKET_NAME || 'leadprocessor';
  const key = `catalog/${styleId}/zones.json`;
  return s3GetJson(bucket, key);
}

// Pricing matrix query
function pickMatrixRow(matrix, method, qty, decorations) {
  const rows = matrix.filter(r => r.method === method);
  let best = null;
  for (const r of rows) {
    const within = qty >= (r.qtyMin || 1) && (r.qtyMax == null || qty <= r.qtyMax);
    if (!within) continue;
    // optional constraints
    if (method === 'screen' || method === 'dtf') {
      const colors = decorations?.colors || 1;
      if (typeof r.colors === 'number' && colors !== r.colors) continue;
    }
    if (method === 'embroidery') {
      const stitches = decorations?.stitches || 0;
      if (typeof r.stitchMax === 'number' && stitches > r.stitchMax) continue;
    }
    if (!best) best = r;
  }
  return best;
}

async function priceQuoteHandler(req, res, adapters) {
  try {
    const body = req.body || {};
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length) return res.status(400).json({ error: 'lines required' });

    // Load matrix from S3 config
    const { s3GetJson, fetchSageFullDetail } = adapters || {};
    const bucket = process.env.AWS_BUCKET_NAME || 'leadprocessor';
    const matrixKey = process.env.PFI_MATRIX_KEY || 'config/pfi_decor_matrix_v1.json';
    const matrix = await s3GetJson(bucket, matrixKey);

    const out = [];
    for (const line of lines) {
      const qty = Math.max(1, parseInt(line.qty, 10) || 1);
      let unitBlankCost = Number(line.unitBlankCost || 0);
      if (!unitBlankCost && typeof fetchSageFullDetail === 'function' && line.prodEId) {
        const sage = await fetchSageFullDetail({ prodEId: line.prodEId }).catch(() => null);
        if (sage && Array.isArray(sage.qty) && Array.isArray(sage.net)) {
          for (let i = 0; i < sage.qty.length; i++) {
            const qmin = Number(sage.qty[i] || 0);
            if (qty >= qmin) unitBlankCost = Number(sage.net[i] || unitBlankCost);
          }
        }
      }
      unitBlankCost = Number(unitBlankCost || 0);

      const decos = Array.isArray(line.decorations) ? line.decorations : [];
      let setupFees = 0;
      let decoUnit = 0;
      const decorationsOut = [];
      for (const d of decos) {
        const method = d.method;
        const row = pickMatrixRow(matrix, method, qty, d) || { costPerPiece: 0, setupFee: 0 };
        const costEach = Number(row.costPerPiece || 0);
        const setup = Number(row.setupFee || 0);
        decoUnit += costEach;
        setupFees += setup;
        decorationsOut.push({ method, costEach, setup });
      }

      const unit = unitBlankCost + decoUnit;
      const extended = unit * qty + setupFees;
      out.push({
        productId: line.productId || line.prodEId || '',
        qty,
        unitBlankCost: Number(unitBlankCost.toFixed(2)),
        decorUnit: Number(decoUnit.toFixed(2)),
        unit: Number(unit.toFixed(2)),
        setupFees: Number(setupFees.toFixed(2)),
        extended: Number(extended.toFixed(2)),
        decorations: decorationsOut
      });
    }

    res.json({ ok: true, lines: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

module.exports = {
  derivePxPerInFromZone,
  toPrinterSpec,
  boxPxToInches,
  offsetsInches,
  buildPlacementManifest,
  loadZonesSpec,
  priceQuoteHandler,
  derivePxPerInFromRectAndImprint,
  toPrinterSpecFromRect
};


