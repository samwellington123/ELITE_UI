// server.js
require('dotenv').config();

const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { uploadFileToS3 } = require('./s3'); // Node S3 uploader (used for base placeholder upload)
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const sharp = require('sharp');
const app = express();
const { parseStringPromise } = require('xml2js');
const { Pool } = require('pg');
// FTP/SFTP removed; reverting to SOAP-only import

// Configuration object - must be defined before S3Client
const CONFIG = {
  AWS_BUCKET_URL: process.env.AWS_BUCKET_URL || 'https://leadprocessor.s3.us-east-2.amazonaws.com',
  AWS_REGION: process.env.AWS_REGION || 'us-east-2',
  AWS_BUCKET_NAME: process.env.AWS_BUCKET_NAME || 'leadprocessor',
  PORT: process.env.PORT || 3000,
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  ALLOWED_SHIP_COUNTRIES: (process.env.ALLOWED_SHIP_COUNTRIES || 'US,CA')
    .split(',')
    .map(s => s.trim().toUpperCase())
  ,
  AIRTABLE_ENABLE_MOCKUP_FIELDS: String(process.env.AIRTABLE_ENABLE_MOCKUP_FIELDS || '').toLowerCase() === 'true'
};

// Import AWS SDK for S3 operations
const { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3Client = new S3Client({
  region: CONFIG.AWS_REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

// ---- Postgres (Neon) pool ----
let pgPool = null;
if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '') {
  try {
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 30000 });
    pgPool.on('error', (err) => console.error('pg pool error', err));
  } catch (e) {
    console.error('Failed to init Postgres pool:', e.message);
  }
} else {
  console.warn('DATABASE_URL not set; Neon integration disabled.');
}

// --- Small helpers to read/write JSON to S3 ---
async function readJsonFromS3(key) {
  try {
    const url = await presignGetObject(key, 60);
    const { data } = await axios.get(url, { responseType: 'json' });
    return data;
  } catch (_) { return null; }
}
async function writeJsonToS3(key, obj) {
  const buf = Buffer.from(JSON.stringify(obj, null, 2));
  await s3Client.send(new PutObjectCommand({ Bucket: CONFIG.AWS_BUCKET_NAME, Key: key, Body: buf, ContentType: 'application/json' }));
}

// Initialize Stripe only if we have a valid API key
let stripe = null;
if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.trim() !== '') {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
} else {
  console.warn('⚠️  STRIPE_SECRET_KEY not found or empty. Stripe features will be disabled.');
}

// Airtable removed

// (Removed) SAGE import route

// Admin: Import SanMar items by providing styleId and base image URL
// Body: { items: [ { styleId, name?, sku?, imageUrl } ] }
app.post('/api/admin/import-sanmar', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: 'items[] required' });

    const results = [];
    for (const it of items) {
      const styleId = String(it.styleId || '').trim();
      const imageUrl = String(it.imageUrl || '').trim();
      if (!styleId || !imageUrl) { results.push({ styleId, ok: false, error: 'missing styleId or imageUrl' }); continue; }

      // Upload base image directly to S3 (no local writes)
      const extGuess = (imageUrl.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
      const safeExt = ['png','jpg','jpeg','webp'].includes(extGuess) ? extGuess : 'jpg';
      const fileName = `${styleId}.${safeExt}`;
      try {
        const { uploadBuffer } = require('./s3');
        const resp = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 20000 });
        const key = `catalog-images/${styleId}/${fileName}`;
        const contentType = safeExt === 'png' ? 'image/png' : (safeExt === 'webp' ? 'image/webp' : 'image/jpeg');
        await uploadBuffer(key, Buffer.from(resp.data), contentType);
      } catch (e) {
        results.push({ styleId, ok: false, error: `image upload failed: ${e.message}` });
        continue;
      }

      // Create Airtable record (optional)
      let createdRec = null;
      if (AIRTABLE.token && AIRTABLE.baseId) {
        const fields = {
          product_id: styleId,
          name: it.name || `SanMar ${styleId}`,
          sku: it.sku || styleId,
          image_file: fileName,
          pricing_json: JSON.stringify([
            { minQty: 1, maxQty: 9, price: 29.99 },
            { minQty: 10, maxQty: 49, price: 26.99 },
            { minQty: 50, maxQty: 99, price: 23.99 },
            { minQty: 100, maxQty: null, price: 19.99 }
          ])
        };
        try { createdRec = await airtableCreateRecord(fields); }
        catch (_) { /* ignore duplicates */ }
      }

      results.push({ styleId, ok: true, fileName, airtable: !!createdRec });
    }

    // Invalidate cache
    _airtableCache = { products: null, expiresAt: 0 };
    res.json({ ok: true, results });
  } catch (e) {
    console.error('import-sanmar error:', e);
    res.status(500).json({ error: 'Failed to import SanMar items', details: e.message });
  }
});

// Admin: Import a SanMar style directly via SanMar SOAP API (no SAGE)
// Body: { styleId }
app.post('/api/admin/import-sanmar-direct', async (req, res) => {
  try {
    const styleId = String((req.body && (req.body.styleId || req.body.style || req.body.id)) || req.query?.styleId || req.query?.style || '').trim();
    const colorReq = String((req.body && req.body.color) || req.query?.color || '').trim();
    const sizeReq = String((req.body && req.body.size) || req.query?.size || '').trim();
    const flatsOnly = /^(1|true|yes)$/i.test(String((req.body && req.body.flatsOnly) || req.query?.flatsOnly || ''));
    if (!styleId) return res.status(400).json({ error: 'styleId required' });

    const sanmarAccount = process.env.SANMAR_ACCOUNT_NUMBER || '';
    const sanmarUser = process.env.SANMAR_USERNAME || '';
    const sanmarPass = process.env.SANMAR_PASSWORD || '';
    if (!sanmarAccount || !sanmarUser || !sanmarPass) {
      return res.status(400).json({ error: 'Missing SANMAR_ACCOUNT_NUMBER, SANMAR_USERNAME, SANMAR_PASSWORD in .env' });
    }

    const arg0Parts = [`<style>${styleId}</style>`];
    if (colorReq) arg0Parts.unshift(`<color>${colorReq}</color>`);
    if (sizeReq) arg0Parts.unshift(`<size>${sizeReq}</size>`);
    const xmlPayload = `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:impl="http://impl.webservice.integration.sanmar.com/">
  <soapenv:Header />
  <soapenv:Body>
    <impl:getProductInfoByStyleColorSize>
      <arg0>
        ${arg0Parts.join('\n        ')}
      </arg0>
      <arg1>
        <sanMarCustomerNumber>${sanmarAccount}</sanMarCustomerNumber>
        <sanMarUserName>${sanmarUser}</sanMarUserName>
        <sanMarUserPassword>${sanmarPass}</sanMarUserPassword>
      </arg1>
    </impl:getProductInfoByStyleColorSize>
  </soapenv:Body>
 </soapenv:Envelope>`;

    const { data: soapXml } = await axios.post(
      'https://ws.sanmar.com:8080/SanMarWebService/SanMarProductInfoServicePort',
      xmlPayload,
      { headers: { 'Content-Type': 'text/xml' }, timeout: 30000 }
    );

    const parsed = await parseStringPromise(soapXml);
    const list = parsed?.['S:Envelope']?.['S:Body']?.[0]?.['ns2:getProductInfoByStyleColorSizeResponse']?.[0]?.['return']?.[0]?.['listResponse'] || [];
    if (!Array.isArray(list) || list.length === 0) {
      return res.json({ ok: true, styleId, found: 0, items: [] });
    }

    const results = [];
    const downloadedFiles = new Set();
    for (const product of list) {
      const basicInfo = product?.['productBasicInfo']?.[0] || {};
      const imageInfo = product?.['productImageInfo']?.[0] || {};
      const priceInfo = product?.['productPriceInfo']?.[0] || {};
      const name = basicInfo['productTitle']?.[0] || `SanMar ${styleId}`;
      const sku = basicInfo['style']?.[0] || styleId;
      const color = basicInfo['color']?.[0] || '';
      const description = basicInfo['productDescription']?.[0] || '';
      const brand = basicInfo['brandName']?.[0] || '';
      const category = basicInfo['category']?.[0] || '';
      const productStatus = basicInfo['productStatus']?.[0] || '';
      const keywords = basicInfo['keywords']?.[0] || '';
      const pieceWeight = basicInfo['pieceWeight']?.[0] || '';
      const caseSize = basicInfo['caseSize']?.[0] || '';
      const specSheetUrl = imageInfo['specSheet']?.[0] || '';
      const price = {
        casePrice: priceInfo['casePrice']?.[0] || '',
        dozenPrice: priceInfo['dozenPrice']?.[0] || '',
        piecePrice: priceInfo['piecePrice']?.[0] || '',
        priceCode: priceInfo['priceCode']?.[0] || '',
        priceText: priceInfo['priceText']?.[0] || ''
      };
      // Collect all candidate image URLs across known view fields and any extra string URLs
      const candidates = [];
      const viewMap = {
        productImage: 'product',
        colorProductImage: 'color',
        frontModel: 'front',
        backModel: 'back',
        leftModel: 'left',
        rightModel: 'right',
        frontFlat: 'front',
        backFlat: 'back',
        leftFlat: 'left',
        rightFlat: 'right'
      };
      for (const [key, val] of Object.entries(imageInfo)) {
        const arr = Array.isArray(val) ? val : [val];
        for (const v of arr) {
          const url = typeof v === 'string' ? v : (typeof v === 'object' && v?._) ? v._ : '';
          if (!url || !/^https?:\/\//i.test(url)) continue;
          // Skip obvious non-product assets
          if (/thumbnail|swatch|logo|brand|colorproductimagethumbnail|mp4|video/i.test(String(key)) || /thumbnail|swatch|logo|brand|mp4|video/i.test(url)) continue;
          const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
          if (!['png','jpg','jpeg','webp','tif','tiff'].includes(ext)) continue; // allow TIFF flats
          const view = viewMap[key] || key;
          const isModel = /model/i.test(key) || /model/i.test(url);
          const isFlat = /flat/i.test(key) || /_flat_/i.test(url) || /\bflat\b/i.test(url);
          const isProductColor = /^(productImage|colorProductImage)$/i.test(key);
          const base = url.split('?')[0];
          candidates.push({ url: base, view, isModel, isFlat, isProductColor });
        }
      }
      // Deduplicate by URL
      const unique = new Map();
      for (const c of candidates) if (!unique.has(c.url)) unique.set(c.url, c);
      const listAll = Array.from(unique.values());
      const flats = listAll.filter(c => c.isFlat && !c.isModel);
      const nonModel = listAll.filter(c => !c.isModel);
      const fallbacks = listAll.filter(c => c.isProductColor);
      let pickList = flats.length ? flats : (nonModel.length ? nonModel : fallbacks);
      if (flatsOnly) {
        if (!flats.length) continue; // skip this color if no flat images available
        pickList = flats;
      }
      // Sort chosen set: front, back, left, right, color, product
      const order = ['front','back','left','right','color','product'];
      pickList.sort((a,b)=>{
        const ai = order.indexOf(a.view); const bi = order.indexOf(b.view);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
      for (const { url, view } of pickList) {
        const extGuess = (url.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
        const isTiff = (extGuess === 'tif' || extGuess === 'tiff');
        const safeExt = isTiff ? 'png' : (['png','jpg','jpeg','webp'].includes(extGuess) ? extGuess : 'jpg');
        const safeColor = String(color).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
        const viewSlug = String(view || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
        const fileName = `${sku}${safeColor ? '_' + safeColor : ''}${viewSlug ? '_' + viewSlug : ''}.${safeExt}`;
        if (downloadedFiles.has(fileName)) continue;
        try {
          const { uploadBuffer, urlForKey } = require('./s3');
          const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
          const key = `catalog-images/${sku}/${fileName}`;
          const contentType = safeExt === 'png' ? 'image/png' : (safeExt === 'webp' ? 'image/webp' : 'image/jpeg');
          if (isTiff) {
            const png = await sharp(Buffer.from(resp.data)).png().toBuffer();
            await uploadBuffer(key, png, 'image/png');
          } else {
            await uploadBuffer(key, Buffer.from(resp.data), contentType);
          }
          downloadedFiles.add(fileName);
          const publicUrl = urlForKey(key);
          results.push({ styleId: sku, name, color, view: viewSlug || null, fileName, s3Key: key, url: publicUrl, specSheet: specSheetUrl, description, brand, category, productStatus, keywords, pieceWeight, caseSize, price });
        } catch (_) {
          // ignore failed image
        }
      }
    }

    // Airtable removed: skip Airtable upserts entirely

    // Upsert minimal product + images into Neon if configured
    let neon = { ok: !!pgPool, upserts: [] };
    if (pgPool && results.length) {
      const client = await pgPool.connect();
      try {
        await client.query('begin');
        // upsert product row using first result as canonical
        const first = results[0];
        const brandName = first.brand || null;
        const categoryName = first.category || null;
        const specUrl = first.specSheet || null;
        const pxDefault = null; // leave null; you’ll set via calibrator/S3
        const calibrated = false;

        const brandId = brandName ? (await client.query(
          'insert into brands(name) values ($1) on conflict(name) do update set name=excluded.name returning id',
          [brandName]
        )).rows[0].id : null;
        const categoryId = categoryName ? (await client.query(
          'insert into categories(name) values ($1) on conflict(name) do update set name=excluded.name returning id',
          [categoryName]
        )).rows[0].id : null;

        const prodRow = (await client.query(
          `insert into products(style_id,name,brand_id,category_id,spec_sheet_url,px_per_in_default,calibrated)
           values ($1,$2,$3,$4,$5,$6,$7)
           on conflict(style_id) do update set name=excluded.name, brand_id=excluded.brand_id, category_id=excluded.category_id, spec_sheet_url=excluded.spec_sheet_url
           returning id`,
          [styleId, first.name || styleId, brandId, categoryId, specUrl, pxDefault, calibrated]
        )).rows[0];

        const prodId = prodRow.id;
        // ensure front/back views exist
        const ensureView = async (name) => {
          const r = await client.query(
            'insert into product_views(product_id,name) values ($1,$2) on conflict(product_id,name) do update set name=excluded.name returning id',
            [prodId, name]
          );
          return r.rows[0].id;
        };
        const viewIds = {};
        for (const v of ['front','back','left','right','product','color']) {
          viewIds[v] = await ensureView(v).catch(() => null);
        }

        // insert images
        for (const r of results) {
          const viewId = viewIds[r.view || 'product'] || null;
          const s3Key = r.s3Key || `catalog-images/${styleId}/${r.fileName}`;
          const urlFor = require('./s3').urlForKey;
          const publicUrl = urlFor(s3Key);
          await client.query(
            `insert into product_images(product_id,view_id,color_id,s3_key,url,width_px,height_px,is_flat,is_model,is_primary)
             values ($1,$2,null,$3,$4,null,null,true,false,false)
             on conflict do nothing`,
            [prodId, viewId, s3Key, publicUrl]
          );
        }

        await client.query('commit');
        neon.upserts.push({ styleId, productId: prodId, images: results.length });
      } catch (e) {
        await client.query('rollback').catch(() => {});
        neon.error = String(e.message || e);
      } finally {
        client.release();
      }
    }

    res.json({ ok: true, styleId, found: results.length, results, neon });
  } catch (e) {
    console.error('import-sanmar-direct error:', e);
    res.status(500).json({ error: 'Failed to import from SanMar SOAP', details: String(e.message || e) });
  }
});

// FTP/SFTP import route removed; SOAP-based import remains

// Debug: Check missing products by name
app.get('/api/debug/missing-products', async (req, res) => {
  try {
    const missingNames = [
      'Custom Mens Sublimated Crew Neck T Shirt',
      'A4 Mens Cooling Performance Long Sleeve Hooded Tee', 
      'Carhartt Duck Active Jacket With Quilted Flannel',
      'Charles River Adult Classic Solid Pullover',
      'Mens Challenger Vest',
      'Sport Tek Adult Posicharge Competitor T Shirt'
    ];
    
    // Get all raw Airtable records
    let records = [];
    let offset;
    do {
      const page = await fetchAirtablePage(offset);
      records = records.concat(page.records || []);
      offset = page.offset;
    } while (offset);
    
    const result = { found: [], notFound: [], issues: [] };
    
    missingNames.forEach(targetName => {
      const rec = records.find(r => {
        const name = (r.fields?.name || '').toLowerCase().trim();
        return name === targetName.toLowerCase().trim();
      });
      
      if (rec) {
        const mapped = mapAirtableRecordToProduct(rec);
        const issues = [];
        if (!mapped.id) issues.push('missing ID');
        if (!mapped.imageFile) issues.push('missing imageFile');
        if (!Array.isArray(mapped.pricing)) issues.push('invalid pricing');
        
        result.found.push({
          name: targetName,
          mapped,
          raw: rec.fields,
          issues: issues.length ? issues : null
        });
      } else {
        result.notFound.push(targetName);
      }
    });
    
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* ---------------------------------
   Product Catalog (local fallback)
   --------------------------------- */
const PRODUCTS = [
  {
    id: 'PROD001',
    name: 'Premium T-Shirt - Black',
    sku: 'TSHIRT-18500-BLACK',
    category: 'apparel',
    description: 'Premium cotton t-shirt with custom logo',
    imageFile: '18500_Black_Flat_Front-01_big_back.png',
    pricing: [
      { minQty: 1, maxQty: 9, price: 29.99 },
      { minQty: 10, maxQty: 49, price: 26.99 },
      { minQty: 50, maxQty: 99, price: 23.99 },
      { minQty: 100, maxQty: null, price: 19.99 }
    ]
  },
  // ... keep all your existing products through PROD020 ...
  {
    id: 'PROD020',
    name: 'Classic Polo - Black',
    sku: 'C932-BLACK',
    category: 'apparel',
    description: 'Classic black polo shirt with embroidered logo',
    imageFile: 'C932_Black_Flat_Front-01_right_chest.png',
    pricing: [
      { minQty: 1, maxQty: 19, price: 39.99 },
      { minQty: 20, maxQty: 99, price: 35.99 },
      { minQty: 100, maxQty: 499, price: 31.99 },
      { minQty: 500, maxQty: null, price: 27.99 }
    ]
  }
];

/* ---------------------------------
   Helpers
   --------------------------------- */
function emailToS3Folder(email) {
  return (email || '').toLowerCase().replace(/@/g, '_at_').replace(/\./g, '_dot_');
}

function chooseDefaultLogoForEmail(email, s3Objects) {
  const domain = String((email || '').split('@')[1] || '').toLowerCase();
  const domainBase = (domain.split('.')[0] || '').toLowerCase();
  const filenameOf = (k) => (k || '').split('/').pop().toLowerCase();

  function score(key) {
    const fn = filenameOf(key);
    let s = 0;
    if (new RegExp(`^${domainBase}(_logo)?\\.(png|jpe?g|svg)$`, 'i').test(fn)) s += 100;
    if (new RegExp(`${domainBase}.*_logo\\.(png|jpe?g|svg)$`, 'i').test(fn)) s += 60;
    if (/_logo\.(png|jpe?g|svg)$/i.test(fn)) s += 30;
    if (fn.indexOf(domainBase) >= 0) s += 10;
    return s;
  }

  let best = null, bestScore = -1;
  for (const obj of s3Objects) {
    const s = score(obj.Key || '');
    if (s > bestScore) { best = obj; bestScore = s; }
  }
  return best || s3Objects[0];
}

function getProductImageUrl(product, customerEmail) {
  const emailFolder = emailToS3Folder(customerEmail || 'default@example.com');
  const encodedFile = encodeURIComponent(product.imageFile);
  const baseUrl = CONFIG.AWS_BUCKET_URL.replace(/\/$/, '');
  return `${baseUrl}/${emailFolder}/mockups/${encodedFile}`;
}

function calculatePrice(product, quantity) {
  const q = Math.max(1, parseInt(quantity, 10) || 1);
  const fallbackPricing = [
    { minQty: 1, maxQty: 9, price: 29.99 },
    { minQty: 10, maxQty: 49, price: 26.99 },
    { minQty: 50, maxQty: 99, price: 23.99 },
    { minQty: 100, maxQty: null, price: 19.99 }
  ];
  const tiers = Array.isArray(product?.pricing) && product.pricing.length ? product.pricing : fallbackPricing;
  const tier = tiers.find((p) => q >= p.minQty && (p.maxQty === null || q <= p.maxQty)) || tiers[0];
  return Number(tier.price);
}

// Parse imprint area strings like: 3" W x 2" H, 3.5 x 2.25 in, 3 x 2, 3w x 2h, etc.
function parseImprintInchesFromString(text) {
  if (!text || typeof text !== 'string') return null;
  const s = text.toLowerCase().replace(/\s+/g, ' ').trim();
  // Normalize separators (x, ×)
  const re = /([0-9]+(?:\.[0-9]+)?)\s*(?:"|in|in\.|inch|inches)?\s*[x×]\s*([0-9]+(?:\.[0-9]+)?)/i;
  const m = s.match(re);
  if (m) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (isFinite(w) && isFinite(h) && w > 0 && h > 0) return { w_in: w, h_in: h };
  }
  // Fallback: try to read w and h tagged (e.g., 3w x 2h)
  const re2 = /([0-9]+(?:\.[0-9]+)?)\s*(?:w|width)?\s*[x×]\s*([0-9]+(?:\.[0-9]+)?)\s*(?:h|height)?/i;
  const m2 = s.match(re2);
  if (m2) {
    const w = Number(m2[1]);
    const h = Number(m2[2]);
    if (isFinite(w) && isFinite(h) && w > 0 && h > 0) return { w_in: w, h_in: h };
  }
  return null;
}

async function getActiveProducts() {
  // Neon-backed minimal product list. Returns array of { id, sku, name }
  try {
    if (!pgPool) return [];
    const { rows } = await pgPool.query(
      'select style_id as id, style_id as sku, name from products order by id desc limit 1000'
    );
    return rows.map(r => ({ id: r.id, sku: r.sku, name: r.name, imageFile: '', pricing: [] }));
  } catch (err) {
    console.warn('Neon getActiveProducts error:', err.message);
    return [];
  }
}

function shippingOptionsFor(subtotalCents, shippingAddress) {
  const isUS = (shippingAddress?.country || 'US').toUpperCase() === 'US';
  const options = [];
  if (isUS) {
    const standardAmount = subtotalCents < 10000 ? 1000 : 0; // <$100 => $10, else free
    options.push({
      shipping_rate_data: {
        display_name: standardAmount === 0 ? 'Standard (Free over $100)' : 'Standard',
        type: 'fixed_amount',
        fixed_amount: { amount: standardAmount, currency: 'usd' },
        tax_behavior: 'exclusive',
        delivery_estimate: { minimum: { unit: 'business_day', value: 5 }, maximum: { unit: 'business_day', value: 8 } }
      }
    });
    options.push({
      shipping_rate_data: {
        display_name: 'Express',
        type: 'fixed_amount',
        fixed_amount: { amount: 2500, currency: 'usd' },
        tax_behavior: 'exclusive',
        delivery_estimate: { minimum: { unit: 'business_day', value: 2 }, maximum: { unit: 'business_day', value: 3 } }
      }
    });
  } else {
    options.push({
      shipping_rate_data: {
        display_name: 'Standard (Intl.)',
        type: 'fixed_amount',
        fixed_amount: { amount: 2500, currency: 'usd' },
        tax_behavior: 'exclusive'
      }
    });
    options.push({
      shipping_rate_data: {
        display_name: 'Express (Intl.)',
        type: 'fixed_amount',
        fixed_amount: { amount: 5000, currency: 'usd' },
        tax_behavior: 'exclusive'
      }
    });
  }
  return options;
}

/* ---------------------------------
   Express
   --------------------------------- */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
/* --------- Directum placement/pricing pack wiring --------- */
try {
  const pack = require('./directum_placement_pricing_pack_v1');
  const { s3GetJson } = require('./s3');

  // Optional SAGE adapter stub (expand later)
  async function fetchSageFullDetail({ prodEId }) {
    try {
      const base = process.env.SAGE_BASE_URL || '';
      if (!base) return null;
      // ConnectAPI mode
      if (/ConnectAPI/i.test(base)) {
        // Use JSON POST per ConnectAPI docs (Basic Product Detail serviceId 104 or Full 105)
        const payload = {
          serviceId: 105,
          apiVer: 130,
          auth: {
            acctId: Number(process.env.SAGE_ACCT_ID || 0),
            loginId: process.env.SAGE_LOGIN_ID || '',
            key: process.env.SAGE_AUTH_KEY || ''
          },
          prodEId: String(prodEId),
          includeSuppInfo: 0
        };
        const { data } = await axios.post(base, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 20000
        });
        return data || null;
      }
      // REST mode
      const key = process.env.SAGE_API_KEY || '';
      const url = `${base.replace(/\/$/, '')}/products/${encodeURIComponent(prodEId)}`;
      const { data } = await axios.get(url, {
        headers: key ? { Authorization: `Bearer ${key}` } : undefined,
        timeout: 8000
      });
      return data || null;
    } catch (_) { return null; }
  }

  app.locals.directumAdapters = { s3GetJson, fetchSageFullDetail };

  // --- SanMar SOAP helpers (standard services) ---
  async function sanmarProductInfoSOAP(style, color, size) {
    const endpoint = process.env.SANMAR_STD_PRODUCT_INFO_URL || 'https://ws.sanmar.com:8080/SanMarWebService/SanMarProductInfoServicePort';
    const sanmarAccount = process.env.SANMAR_ACCOUNT_NUMBER || '';
    const sanmarUser = process.env.SANMAR_USERNAME || '';
    const sanmarPass = process.env.SANMAR_PASSWORD || '';
    if (!sanmarAccount || !sanmarUser || !sanmarPass) throw new Error('Missing SANMAR credentials');
    const parts = [`<style>${style}</style>`];
    if (color) parts.unshift(`<color>${color}</color>`);
    if (size) parts.unshift(`<size>${size}</size>`);
    const xmlPayload = `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:impl="http://impl.webservice.integration.sanmar.com/">
  <soapenv:Header />
  <soapenv:Body>
    <impl:getProductInfoByStyleColorSize>
      <arg0>
        ${parts.join('\n        ')}
      </arg0>
      <arg1>
        <sanMarCustomerNumber>${sanmarAccount}</sanMarCustomerNumber>
        <sanMarUserName>${sanmarUser}</sanMarUserName>
        <sanMarUserPassword>${sanmarPass}</sanMarUserPassword>
      </arg1>
    </impl:getProductInfoByStyleColorSize>
  </soapenv:Body>
 </soapenv:Envelope>`;
    const { data } = await axios.post(endpoint, xmlPayload, { headers: { 'Content-Type': 'text/xml' }, timeout: 30000 });
    return parseStringPromise(data);
  }

  async function sanmarInventorySOAP(style) {
    const endpoint = process.env.SANMAR_STD_INVENTORY_URL || 'https://ws.sanmar.com:8080/SanMarWebService/SanMarWebServicePort';
    const sanmarAccount = process.env.SANMAR_ACCOUNT_NUMBER || '';
    const sanmarUser = process.env.SANMAR_USERNAME || '';
    const sanmarPass = process.env.SANMAR_PASSWORD || '';
    if (!sanmarAccount || !sanmarUser || !sanmarPass) throw new Error('Missing SANMAR credentials');
    const xmlPayloadInventory = `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://webservice.integration.sanmar.com/">
  <soapenv:Header/>
  <soapenv:Body>
    <web:getInventoryQtyForStyleColorSize>
      <arg0>${sanmarAccount}</arg0>
      <arg1>${sanmarUser}</arg1>
      <arg2>${sanmarPass}</arg2>
      <arg3>${style}</arg3>
    </web:getInventoryQtyForStyleColorSize>
  </soapenv:Body>
</soapenv:Envelope>`;
    const { data } = await axios.post(endpoint, xmlPayloadInventory, { headers: { 'Content-Type': 'text/xml' }, timeout: 30000 });
    const parsed = await parseStringPromise(data);
    const inv = parsed?.['S:Envelope']?.['S:Body']?.[0]?.['ns2:getInventoryQtyForStyleColorSizeResponse']?.[0]?.['return']?.[0]?.['response']?.[0];
    if (!inv) return { style, skus: [] };
    const result = { style: inv.style?.[0] || style, skus: [] };
    const skus = inv.skus?.[0]?.sku || [];
    for (const sku of skus) {
      const color = sku.color?.[0] || '';
      const size = sku.size?.[0] || '';
      const whse = [];
      for (const w of sku.whse || []) {
        whse.push({ whseID: w.whseID?.[0] || '', whseName: w.whseName?.[0] || '', qty: Number(w.qty?.[0] || 0) });
      }
      result.skus.push({ color, size, whse });
    }
    return result;
  }

  // Admin: Fetch a full SanMar data bundle for a style
  app.get('/api/admin/sanmar/full/:styleId', async (req, res) => {
    try {
      const styleId = String(req.params.styleId || '').trim();
      if (!styleId) return res.status(400).json({ ok: false, error: 'styleId required' });
      const pi = await sanmarProductInfoSOAP(styleId);
      const inv = await sanmarInventorySOAP(styleId).catch(() => ({ style: styleId, skus: [] }));
      res.json({ ok: true, styleId, productInfo: pi, inventory: inv });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // V1 Pricing quote
  app.post('/api/price/quote', express.json(), (req, res) => pack.priceQuoteHandler(req, res, app.locals.directumAdapters));

  // Zones loader: /api/zones/:styleId
  app.get('/api/zones/:styleId', async (req, res) => {
    try {
      const bucket = process.env.AWS_BUCKET_NAME || 'leadprocessor';
      const key = `catalog/${req.params.styleId}/zones.json`;
      const data = await s3GetJson(bucket, key);
      res.json({ ok: true, data });
    } catch (e) {
      res.status(404).json({ ok: false, err: 'zones-not-found' });
    }
  });
  
  // Admin: store/fetch per-style (and optional size) pxPerIn scales so one calibration
  // covers all color images. Stored under catalog/<styleId>/scales.json
  // Shape: { defaultPxPerIn: number, sizes: { [size]: number } }
  app.get('/api/admin/scales/:styleId', async (req, res) => {
    try {
      const styleId = req.params.styleId;
      const key = `catalog/${styleId}/scales.json`;
      const data = await readJsonFromS3(key);
      if (!data) return res.status(404).json({ ok: false, error: 'not-found' });
      res.json({ ok: true, data });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/admin/scales/:styleId', async (req, res) => {
    try {
      const styleId = req.params.styleId;
      const { defaultPxPerIn, size, pxPerIn, view } = req.body || {};
      if (!(Number(defaultPxPerIn) > 0) && !(size && Number(pxPerIn) > 0) && !(view && Number(pxPerIn) > 0)) {
        return res.status(400).json({ ok: false, error: 'Provide defaultPxPerIn or size+pxPerIn or view+pxPerIn' });
      }
      const key = `catalog/${styleId}/scales.json`;
      const current = (await readJsonFromS3(key)) || { defaultPxPerIn: undefined, sizes: {}, views: {} };
      if (Number(defaultPxPerIn) > 0) current.defaultPxPerIn = Number(defaultPxPerIn);
      if (size && Number(pxPerIn) > 0) {
        current.sizes = current.sizes || {};
        current.sizes[String(size)] = Number(pxPerIn);
      }
      if (view && Number(pxPerIn) > 0) {
        current.views = current.views || {};
        current.views[String(view)] = { pxPerIn: Number(pxPerIn) };
      }
      await writeJsonToS3(key, current);
      // Neon sync for px/in
      let neon = { ok: false };
      if (pgPool) {
        const client = await pgPool.connect();
        try {
          await client.query('begin');
          const pr = await client.query('select id from products where style_id=$1', [styleId]);
          const p = pr.rows[0];
          if (p) {
            if (Number(defaultPxPerIn) > 0) {
              await client.query('update products set px_per_in_default=$1, calibrated=true, updated_at=now() where id=$2', [Number(defaultPxPerIn), p.id]);
            }
            if (view && Number(pxPerIn) > 0) {
              const vr = await client.query(
                'insert into product_views(product_id,name) values ($1,$2) on conflict(product_id,name) do update set name=excluded.name returning id',
                [p.id, String(view)]
              );
              await client.query('update product_views set px_per_in=$1 where id=$2', [Number(pxPerIn), vr.rows[0].id]);
              // Mark product as calibrated when any per-view calibration is saved
              await client.query('update products set calibrated=true, updated_at=now() where id=$1', [p.id]);
            }
            await client.query('commit');
            neon = { ok: true };
          } else {
            await client.query('rollback');
            neon = { ok: false, error: 'product-not-found' };
          }
        } catch (e) {
          try { await client.query('rollback'); } catch {}
          neon = { ok: false, error: String(e.message || e) };
        } finally {
          client.release();
        }
      } else {
        neon = { ok: false, error: 'pg-not-configured' };
      }
      res.json({ ok: true, key, data: current, neon });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Fetch SanMar Spec Sheet + Measurements (PDF URL) via SOAP for a style
  app.get('/api/admin/sanmar/spec/:styleId', async (req, res) => {
    try {
      const styleId = String(req.params.styleId || '').trim();
      const colorReq = String(req.query?.color || '').trim();
      const sizeReq = String(req.query?.size || '').trim();
      if (!styleId) return res.status(400).json({ ok: false, error: 'styleId required' });

      const sanmarAccount = process.env.SANMAR_ACCOUNT_NUMBER || '';
      const sanmarUser = process.env.SANMAR_USERNAME || '';
      const sanmarPass = process.env.SANMAR_PASSWORD || '';
      if (!sanmarAccount || !sanmarUser || !sanmarPass) {
        return res.status(400).json({ ok: false, error: 'Missing SANMAR credentials' });
      }

      const arg0 = [ `<style>${styleId}</style>` ];
      if (colorReq) arg0.unshift(`<color>${colorReq}</color>`);
      if (sizeReq) arg0.unshift(`<size>${sizeReq}</size>`);
      const xmlPayload = `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:impl="http://impl.webservice.integration.sanmar.com/">
  <soapenv:Header />
  <soapenv:Body>
    <impl:getProductInfoByStyleColorSize>
      <arg0>
        ${arg0.join('\n        ')}
      </arg0>
      <arg1>
        <sanMarCustomerNumber>${sanmarAccount}</sanMarCustomerNumber>
        <sanMarUserName>${sanmarUser}</sanMarUserName>
        <sanMarUserPassword>${sanmarPass}</sanMarUserPassword>
      </arg1>
    </impl:getProductInfoByStyleColorSize>
  </soapenv:Body>
 </soapenv:Envelope>`;

      const { data: soapXml } = await axios.post(
        'https://ws.sanmar.com:8080/SanMarWebService/SanMarProductInfoServicePort',
        xmlPayload,
        { headers: { 'Content-Type': 'text/xml' }, timeout: 30000 }
      );
      const parsed = await parseStringPromise(soapXml);
      const list = parsed?.['S:Envelope']?.['S:Body']?.[0]?.['ns2:getProductInfoByStyleColorSizeResponse']?.[0]?.['return']?.[0]?.['listResponse'] || [];
      const urlsSet = new Set();
      for (const product of list) {
        const imageInfo = product?.['productImageInfo']?.[0] || {};
        const spec = imageInfo['specSheet']?.[0] || '';
        if (spec && /^https?:\/\//i.test(spec)) urlsSet.add(spec.split('?')[0]);
      }
      const urls = Array.from(urlsSet);
      res.json({ ok: true, styleId, urls, count: urls.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
  
  // List SanMar images for a style from S3 (replaces local scan)
  app.get('/api/admin/sanmar/images/:styleId', async (req, res) => {
    try {
      const styleId = String(req.params.styleId || '').trim();
      if (!styleId) return res.status(400).json({ ok: false, error: 'styleId required' });
      const prefix = `catalog-images/${styleId}/`;
      const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
      const out = await s3Client.send(new ListObjectsV2Command({ Bucket: CONFIG.AWS_BUCKET_NAME, Prefix: prefix }));
      const items = [];
      for (const obj of (out.Contents || [])) {
        const key = obj.Key || '';
        if (!key.toLowerCase().match(/\.(png|jpe?g|webp)$/)) continue;
        let url = null;
        try { url = await presignGetObject(key, 300); } catch { url = `${CONFIG.AWS_BUCKET_URL.replace(/\/$/, '')}/${key}`; }
        items.push({ file: (key || '').split('/').pop(), url });
      }
      // Sort front first
      const score = (f) => {
        const s = (f || '').toLowerCase();
        if (/front/.test(s)) return 0;
        if (/(product|color)/.test(s)) return 1;
        if (/(left|right)/.test(s)) return 2;
        if (/back/.test(s)) return 3;
        return 9;
      };
      items.sort((a,b)=> score(a.file) - score(b.file));
      res.json({ ok: true, items });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // List prepared S3 images for calibration
  app.get('/api/admin/calibrate/images/:styleId', async (req, res) => {
    try {
      const styleId = String(req.params.styleId || '').trim();
      if (!styleId) return res.status(400).json({ ok: false, error: 'styleId required' });
      const prefix = `catalog-images/${styleId}/`;
      const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
      const out = await s3Client.send(new ListObjectsV2Command({ Bucket: CONFIG.AWS_BUCKET_NAME, Prefix: prefix }));
      const items = [];
      for (const obj of (out.Contents || [])) {
        const key = obj.Key || '';
        if (!key.toLowerCase().match(/\.(png|jpe?g|webp)$/)) continue;
        let url = null;
        try { url = await presignGetObject(key, 300); } catch { url = `${CONFIG.AWS_BUCKET_URL.replace(/\/$/, '')}/${key}`; }
        items.push({ key, url });
      }
      res.json({ ok: true, items });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Prepare a style for calibration: fetch SanMar images, upload to S3 under catalog-images/<styleId>/,
  // upsert basic product + images in Neon, and return view → URLs.
  app.post('/api/admin/calibrate/prepare', async (req, res) => {
    try {
      const styleId = String(req.body?.styleId || req.query?.styleId || '').trim();
      const flatsOnly = !/^false$/i.test(String(req.body?.flatsOnly || req.query?.flatsOnly || 'true'));
      if (!styleId) return res.status(400).json({ ok: false, error: 'styleId required' });

      // Reuse SanMar SOAP fetch via import endpoint logic (minimal re-impl of selection)
      const sanmarAccount = process.env.SANMAR_ACCOUNT_NUMBER || '';
      const sanmarUser = process.env.SANMAR_USERNAME || '';
      const sanmarPass = process.env.SANMAR_PASSWORD || '';
      if (!sanmarAccount || !sanmarUser || !sanmarPass) {
        return res.status(400).json({ ok: false, error: 'Missing SANMAR credentials' });
      }
      const xmlPayload = `\
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:impl="http://impl.webservice.integration.sanmar.com/">\
  <soapenv:Header />\
  <soapenv:Body>\
    <impl:getProductInfoByStyleColorSize>\
      <arg0>\
        <style>${styleId}</style>\
      </arg0>\
      <arg1>\
        <sanMarCustomerNumber>${sanmarAccount}</sanMarCustomerNumber>\
        <sanMarUserName>${sanmarUser}</sanMarUserName>\
        <sanMarUserPassword>${sanmarPass}</sanMarUserPassword>\
      </arg1>\
    </impl:getProductInfoByStyleColorSize>\
  </soapenv:Body>\
 </soapenv:Envelope>`;
      const { data: soapXml } = await axios.post(
        'https://ws.sanmar.com:8080/SanMarWebService/SanMarProductInfoServicePort',
        xmlPayload,
        { headers: { 'Content-Type': 'text/xml' }, timeout: 30000 }
      );
      const parsed = await parseStringPromise(soapXml);
      const list = parsed?.['S:Envelope']?.['S:Body']?.[0]?.['ns2:getProductInfoByStyleColorSizeResponse']?.[0]?.['return']?.[0]?.['listResponse'] || [];
      const items = [];
      for (const product of list) {
        const basicInfo = product?.['productBasicInfo']?.[0] || {};
        const imageInfo = product?.['productImageInfo']?.[0] || {};
        const name = basicInfo['productTitle']?.[0] || styleId;
        const brand = basicInfo['brandName']?.[0] || '';
        const category = basicInfo['category']?.[0] || '';
        const specSheet = imageInfo['specSheet']?.[0] || '';
        const viewMap = { productImage:'product', colorProductImage:'color', frontModel:'front', backModel:'back', leftModel:'left', rightModel:'right', frontFlat:'front', backFlat:'back', leftFlat:'left', rightFlat:'right' };
        for (const [key, val] of Object.entries(imageInfo)) {
          const arr = Array.isArray(val) ? val : [val];
          for (const v of arr) {
            const url = typeof v === 'string' ? v : (typeof v === 'object' && v?._) ? v._ : '';
            if (!/^https?:\/\//i.test(url)) continue;
            if (/thumbnail|swatch|logo|brand|mp4|video/i.test(String(key)) || /thumbnail|swatch|logo|brand|mp4|video/i.test(url)) continue;
            const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
            if (!['png','jpg','jpeg','webp','tif','tiff'].includes(ext)) continue;
            const isModel = /model/i.test(key) || /model/i.test(url);
            const isFlat = /flat/i.test(key) || /_flat_/i.test(url) || /\bflat\b/i.test(url);
            const view = viewMap[key] || 'product';
            if (flatsOnly && (!isFlat || isModel)) continue;
            items.push({ name, brand, category, specSheet, url: url.split('?')[0], view });
          }
        }
      }
      // Upload to S3 and upsert Neon
      const { uploadBuffer, urlForKey } = require('./s3');
      const uploadedByView = {};
      const neon = { ok: !!pgPool };
      for (const it of items) {
        try {
          const { data } = await axios.get(it.url, { responseType: 'arraybuffer', timeout: 30000 });
          const ext = (it.url.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
          const safeExt = ['png','jpg','jpeg','webp'].includes(ext) ? ext : 'jpg';
          const fileName = `${styleId}_${it.view}.${safeExt}`;
          const key = `catalog-images/${styleId}/${fileName}`;
          const contentType = safeExt === 'png' ? 'image/png' : (safeExt === 'webp' ? 'image/webp' : 'image/jpeg');
          await uploadBuffer(key, Buffer.from(data), contentType);
          const publicUrl = urlForKey(key);
          uploadedByView[it.view] = uploadedByView[it.view] || [];
          uploadedByView[it.view].push(publicUrl);
        } catch (_) {}
      }

      if (pgPool && items[0]) {
        const client = await pgPool.connect();
        try {
          await client.query('begin');
          const brandId = (await client.query('insert into brands(name) values ($1) on conflict(name) do update set name=excluded.name returning id', [items[0].brand || null])).rows?.[0]?.id || null;
          const categoryId = (await client.query('insert into categories(name) values ($1) on conflict(name) do update set name=excluded.name returning id', [items[0].category || null])).rows?.[0]?.id || null;
          const prod = (await client.query(`insert into products(style_id,name,brand_id,category_id,spec_sheet_url,calibrated) values ($1,$2,$3,$4,$5,false)
            on conflict(style_id) do update set name=excluded.name, brand_id=excluded.brand_id, category_id=excluded.category_id, spec_sheet_url=excluded.spec_sheet_url returning id`,
            [styleId, items[0].name, brandId, categoryId, items[0].specSheet || null])).rows[0];
          const prodId = prod.id;
          const ensureView = async (name) => (await client.query('insert into product_views(product_id,name) values ($1,$2) on conflict(product_id,name) do update set name=excluded.name returning id',[prodId,name])).rows[0].id;
          for (const [v, urls] of Object.entries(uploadedByView)) {
            const vId = await ensureView(v);
            for (const u of urls) {
              await client.query('insert into product_images(product_id,view_id,s3_key,url,is_flat,is_primary) values ($1,$2,$3,$4,true,false) on conflict do nothing',
                [prodId, vId, u.replace(/^https?:\/\/[^/]+\//,'') , u]);
            }
          }
          await client.query('commit');
        } catch (e) {
          try { await client.query('rollback'); } catch {}
          neon.error = String(e.message || e);
        } finally {
          client.release();
        }
      }

      res.json({ ok: true, styleId, uploadedByView });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Normalize all images for a style (and optional view) to a target px/in using stored scale
  app.post('/api/admin/sanmar/normalize/:styleId', async (req, res) => {
    try {
      const styleId = String(req.params.styleId || '').trim();
      const view = req.body?.view ? String(req.body.view) : (req.query?.view ? String(req.query.view) : '');
      const targetPxPerIn = Number(req.body?.targetPxPerIn || req.query?.targetPxPerIn || 30);
      if (!styleId) return res.status(400).json({ ok: false, error: 'styleId required' });
      if (!(targetPxPerIn > 0)) return res.status(400).json({ ok: false, error: 'targetPxPerIn must be > 0' });

      // Load current scale
      const key = `catalog/${styleId}/scales.json`;
      const scales = (await readJsonFromS3(key)) || null;
      if (!scales) return res.status(400).json({ ok: false, error: 'calibration missing: save a scale first' });
      let currentPxPerIn = Number(scales.defaultPxPerIn) > 0 ? Number(scales.defaultPxPerIn) : null;
      if (view && scales.views && scales.views[view] && Number(scales.views[view].pxPerIn) > 0) {
        currentPxPerIn = Number(scales.views[view].pxPerIn);
      }
      if (!(currentPxPerIn > 0)) return res.status(400).json({ ok: false, error: 'no usable pxPerIn found in scales.json' });

      const factor = targetPxPerIn / currentPxPerIn;

      // Resize matching images in S3 under catalog-images/<styleId>/
      const { ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
      const prefix = `catalog-images/${styleId}/`;
      const out = await s3Client.send(new ListObjectsV2Command({ Bucket: CONFIG.AWS_BUCKET_NAME, Prefix: prefix }));
      const keys = (out.Contents || []).map(o => o.Key).filter(k => /\.(png|jpe?g|webp)$/i.test(String(k)));
      const updated = [];
      for (const key of keys) {
        try {
          const obj = await s3Client.send(new GetObjectCommand({ Bucket: CONFIG.AWS_BUCKET_NAME, Key: key }));
          const buf = Buffer.from(await obj.Body.transformToByteArray());
          const meta = await sharp(buf).metadata();
          const newW = Math.max(1, Math.round((meta.width || 0) * factor));
          const newH = Math.max(1, Math.round((meta.height || 0) * factor));
          if (newW && newH) {
            const resized = await sharp(buf).resize({ width: newW, height: newH }).toBuffer();
            const ext = (key.split('.').pop() || 'jpg').toLowerCase();
            const contentType = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
            await s3Client.send(new PutObjectCommand({ Bucket: CONFIG.AWS_BUCKET_NAME, Key: key, Body: resized, ContentType: contentType }));
            updated.push({ key, width: newW, height: newH });
          }
        } catch (_) { /* skip */ }
      }

      // Update scales to reflect target
      const next = Object.assign({ views: {} }, scales);
      if (view) {
        next.views = next.views || {};
        next.views[view] = { pxPerIn: targetPxPerIn };
      } else {
        next.defaultPxPerIn = targetPxPerIn;
      }
      await writeJsonToS3(key, next);

      res.json({ ok: true, styleId, targetPxPerIn, factor, updatedCount: updated.length, updated });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
} catch (_) {
  // pack is optional until file exists
}
/* Upload logo via server (avoid S3 CORS) */
app.post('/api/logo/upload', upload.single('logo'), async (req, res) => {
  try {
    const email = (req.body?.email || '').trim();
    const file = req.file;
    if (!email || !file) return res.status(400).json({ error: 'email and logo file are required' });
    const emailFolder = emailToS3Folder(email);
    const fileName = file.originalname || `logo_${Date.now()}.png`;
    const key = `${emailFolder}/logo/${fileName}`;
    // Reuse node S3 client via s3.js
    const { uploadBuffer, urlForKey } = require('./s3');
    await uploadBuffer(key, file.buffer, file.mimetype || 'application/octet-stream');
    const url = urlForKey(key);
    res.json({ ok: true, key, url });
  } catch (e) {
    console.error('logo upload error:', e);
    res.status(500).json({ error: 'Failed to upload logo' });
  }
});

/* ---------------------------------
   S3 helpers: key builders and presigners
   --------------------------------- */
function companyDomainFromEmail(email) {
  const s = String(email || '').toLowerCase();
  const at = s.split('@')[1] || 'unknown.local';
  return at;
}

function s3KeyForLogo(companyDomain, logoId, filename) {
  return `company/${companyDomain}/logos/${logoId}/${filename}`;
}
function s3KeyForDesign(companyDomain, quoteId, versionId, productId) {
  return `company/${companyDomain}/quotes/${quoteId}/versions/${versionId}/designs/${productId}.json`;
}
function s3KeyForPreview(companyDomain, quoteId, versionId, productId) {
  return `company/${companyDomain}/quotes/${quoteId}/versions/${versionId}/previews/${productId}.webp`;
}
function s3KeyForVersionIndex(companyDomain, quoteId, versionId) {
  return `company/${companyDomain}/quotes/${quoteId}/versions/${versionId}/index.json`;
}

async function presignPutObject(key, contentType, expiresSec = 900) {
  const cmd = new PutObjectCommand({ Bucket: CONFIG.AWS_BUCKET_NAME, Key: key, ContentType: contentType });
  return getSignedUrl(s3Client, cmd, { expiresIn: expiresSec });
}
async function presignGetObject(key, expiresSec = 900) {
  const cmd = new GetObjectCommand({ Bucket: CONFIG.AWS_BUCKET_NAME, Key: key });
  return getSignedUrl(s3Client, cmd, { expiresIn: expiresSec });
}

/* Presign upload for logo */
app.post('/api/logo/presign', async (req, res) => {
  try {
    const { email, logoId, filename, contentType } = req.body || {};
    if (!email || !logoId || !filename || !contentType) return res.status(400).json({ error: 'email, logoId, filename, contentType required' });
    const domain = companyDomainFromEmail(email);
    const key = s3KeyForLogo(domain, logoId, filename);
    const url = await presignPutObject(key, contentType, 900);
    const publicUrl = `${CONFIG.AWS_BUCKET_URL.replace(/\/$/, '')}/${key}`;
    const getUrl = await presignGetObject(key, 900);
    res.json({ key, url, publicUrl, getUrl });
  } catch (e) {
    console.error('presign logo error:', e);
    res.status(500).json({ error: 'Failed to presign logo upload' });
  }
});

/* Products (Neon-backed; returns array for your UI) */
app.get('/api/products', async (req, res) => {
  const { customerEmail, quoteId, versionId } = req.query || {};
  let products;
  products = await getActiveProducts();

  // Enrich each product with primary image and description from Neon
  if (pgPool && products.length) {
    try {
      const ids = products.map(p => p.id);
      const { rows } = await pgPool.query(
        `select p.style_id as id,
                p.name,
                p.description,
                p.spec_sheet_url,
                (select url from product_images i where i.product_id = p.id order by i.is_primary desc, i.is_flat desc, i.created_at asc limit 1) as image_url,
                (
                  select coalesce(json_agg(json_build_object('minQty', t.min_qty, 'maxQty', t.max_qty, 'price', t.price) order by t.min_qty), '[]'::json)
                  from pricing_tiers t where t.product_id = p.id
                ) as pricing
         from products p
         where p.style_id = any($1)`, [ids]
      );
      const byId = new Map(rows.map(r => [r.id, r]));
      products = products.map(p => {
        const r = byId.get(p.id) || {};
        const defaultPricing = [
          { minQty: 1, maxQty: 9, price: 29.99 },
          { minQty: 10, maxQty: 49, price: 26.99 },
          { minQty: 50, maxQty: 99, price: 23.99 },
          { minQty: 100, maxQty: null, price: 19.99 }
        ];
        const pricing = Array.isArray(r.pricing) && r.pricing.length ? r.pricing : defaultPricing;
        return {
          ...p,
          name: r.name || p.name || p.id,
          description: r.description || '',
          specSheetUrl: r.spec_sheet_url || null,
          baseImageUrl: r.image_url || null,
          pricing
        };
      });
    } catch (e) {
      console.warn('Neon enrichment failed:', e.message);
    }
  }

  const enriched = products.map(p => {
    const baseImageUrl = p.baseImageUrl || `${CONFIG.PUBLIC_BASE_URL}/images/products/${encodeURIComponent(p.imageFile || '')}`;
    let previewImageUrl = null;
    if (quoteId && versionId && customerEmail) {
      const domain = companyDomainFromEmail(customerEmail);
      const key = s3KeyForPreview(domain, quoteId, versionId, p.id);
      // Client cannot access private S3 without presign; provide a presigned URL for quick display
      // Note: this is ephemeral (5 minutes). Frontend should refresh as needed.
      previewImageUrl = null; // default; will be filled by presign below
    } else if (customerEmail) {
      // Legacy email-based preview location; will presign below to support private buckets
      previewImageUrl = null;
    }

    const pricing = p.pricing || [];
    const pricingTable = pricing.map(t => ({
      quantity_range: t.maxQty ? `${t.minQty}-${t.maxQty}` : `${t.minQty}+`,
      price_per_unit: `$${Number(t.price || 0).toFixed(2)}`
    }));

    return { ...p, baseImageUrl, previewImageUrl, pricingTable, currentPrice: Number(pricing?.[0]?.price || 0) };
  });

  // If version requested, presign previews in batch (best-effort)
  if (quoteId && versionId && customerEmail) {
    const domain = companyDomainFromEmail(customerEmail);
    await Promise.all(enriched.map(async (p) => {
      let url = null;
      try {
        const key = s3KeyForPreview(domain, quoteId, versionId, p.id);
        url = await presignGetObject(key, 300);
      } catch (_) {}
      if (!url) {
        try {
          const emailFolder = emailToS3Folder(customerEmail);
          const legacyKey = `${emailFolder}/mockups/${p.imageFile}`;
          url = await presignGetObject(legacyKey, 300);
        } catch (_) {}
      }
      if (!url) {
        // Final public URL fallback
        const emailFolder = emailToS3Folder(customerEmail);
        url = `${CONFIG.AWS_BUCKET_URL.replace(/\/$/, '')}/${emailFolder}/mockups/${encodeURIComponent(p.imageFile)}`;
      }
      p.previewImageUrl = url || p.previewImageUrl || null;
    }));
  } else if (customerEmail) {
    // Legacy email-based mockups: presign each object's URL so private buckets work
    const emailFolder = emailToS3Folder(customerEmail);
    await Promise.all(enriched.map(async (p) => {
      try {
        const key = `${emailFolder}/mockups/${p.imageFile}`;
        p.previewImageUrl = await presignGetObject(key, 300);
      } catch (_) {
        // Fallback to public URL if presign fails
        p.previewImageUrl = `${CONFIG.AWS_BUCKET_URL}/${emailFolder}/mockups/${encodeURIComponent(p.imageFile)}`;
      }
    }));
  }

  res.json(enriched); // plain array for your existing front-end
});

/* Price calculation per quantity (uses Neon-backed products) */
app.post('/api/calculate-price', async (req, res) => {
  const { productId, quantity } = req.body || {};
  if (!productId) return res.status(400).json({ error: 'productId required' });

  const list = await getActiveProducts();
  const product = list.find(p => p.id === productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const unitPrice = calculatePrice(product, qty);
  const totalPrice = unitPrice * qty;
  const basePrice = product.pricing?.[0]?.price || unitPrice;
  const savings = qty > 1 ? (basePrice - unitPrice) * qty : 0;

  res.json({
    productId,
    quantity: qty,
    unitPrice,
    totalPrice,
    savings: Number(savings.toFixed(2)),
    pricingTier: product.pricing.find((p) => qty >= p.minQty && (p.maxQty === null || qty <= p.maxQty))
  });
});

/* Tax calculation endpoint */
app.post('/api/calculate-tax', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY' });

    const { zip, items } = req.body || {};
    if (!zip || !Array.isArray(items) || !items.length) return res.json({ taxAmount: 0 });

    const line_items = items.map((item) => ({
      amount: Math.round(Number(item.unitPrice || 0) * 100),
      quantity: item.quantity,
      reference: item.productId
    }));

    const calculation = await stripe.tax.calculations.create({
      currency: 'usd',
      line_items,
      customer_details: { address: { postal_code: zip, country: 'US' }, address_source: 'shipping' }
    });

    const taxAmount = calculation.tax_amount_exclusive / 100;
    res.json({ taxAmount: Number(taxAmount.toFixed(2)), taxBreakdown: calculation.tax_breakdown });
  } catch (err) {
    console.error('Tax calculation error:', err);
    res.status(500).json({ error: 'Failed to calculate tax', taxAmount: 0 });
  }
});

/* Stripe Checkout with Stripe Tax + shipping */
app.post('/api/create-checkout', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY in .env' });

    const { customerInfo, products: cart, quoteId, versionId } = req.body || {};
    if (!Array.isArray(cart) || !cart.length) return res.status(400).json({ error: 'Cart is empty' });

    const safeCustomerInfo = customerInfo || { name: '', email: '', company: '', phone: '' };
    const activeProducts = await getActiveProducts();

    // Optional guardrail: require placement/printerSpec for each line
    if (String(process.env.GUARD_PLACEMENT || '').toLowerCase() === 'true') {
      for (const item of cart) {
        const chosenVersion = (item && typeof item.versionId === 'string' && item.versionId) ? item.versionId : (versionId || '');
        if (!chosenVersion) {
          return res.status(400).json({ error: `Missing design version for product ${item.productId}. Set logo position and save a version first.` });
        }
        const emailForImages = (customerInfo && customerInfo.email) || '';
        if (!emailForImages) {
          return res.status(400).json({ error: 'Email required to validate design placement' });
        }
        try {
          const domain = companyDomainFromEmail(emailForImages);
          const key = s3KeyForDesign(domain, quoteId || 'QDEFAULT', chosenVersion, item.productId);
          const url = await presignGetObject(key, 60);
          const { data: design } = await axios.get(url, { responseType: 'json' });
          const hasPxPerIn = !!(design && design.placement && (design.placement.pxPerIn || (design.placement.printerSpec && design.placement.printerSpec.pxPerIn)));
          const hasPrinter = !!(design && design.placement && design.placement.printerSpec);
          if (!hasPxPerIn || !hasPrinter) {
            return res.status(400).json({ error: `Design for product ${item.productId} is missing printerSpec/pxPerIn. Re-save placement.` });
          }
        } catch (e) {
          return res.status(400).json({ error: `Could not load design for product ${item.productId}. Save placement first.` });
        }
      }
    }

    const line_items = await Promise.all(cart.map(async (item) => {
      const p = activeProducts.find((x) => x.id === item.productId);
      if (!p) throw new Error(`Unknown product ${item.productId}`);
      const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
      const unit = calculatePrice(p, qty);
      const emailForImages = safeCustomerInfo.email || '';
      let baseImageUrl = p.baseImageUrl || `${CONFIG.PUBLIC_BASE_URL}/images/products/${encodeURIComponent(p.imageFile || '')}`;
      if (!baseImageUrl) {
        // Try S3 catalog image for this styleId
        try {
          const styleIdForImages = p.sku || p.id;
          const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
          const prefix = `catalog-images/${styleIdForImages}/`;
          const listing = await s3Client.send(new ListObjectsV2Command({ Bucket: CONFIG.AWS_BUCKET_NAME, Prefix: prefix }));
          const allKeys = (listing.Contents || []).map(o => o.Key).filter(k => /(front|product|color).*(png|jpe?g|webp)$/i.test(String(k)));
          const score = (k) => (/front/i.test(k) ? 0 : (/(product|color)/i.test(k) ? 1 : 9));
          allKeys.sort((a,b)=> score(a)-score(b));
          if (allKeys[0]) baseImageUrl = `${CONFIG.AWS_BUCKET_URL.replace(/\/$/, '')}/${allKeys[0]}`;
        } catch (_) { /* ignore */ }
      }
      let img = null;
      // Prefer per-item selected version, else global versionId
      const chosenVersion = (item && typeof item.versionId === 'string' && item.versionId) ? item.versionId : (versionId || '');
      if (quoteId && chosenVersion && emailForImages) {
        try {
          const domain = companyDomainFromEmail(emailForImages);
          const key = s3KeyForPreview(domain, quoteId, chosenVersion, p.id);
          img = await presignGetObject(key, 300);
        } catch (_) { img = null; }
      }
      // Fallback to legacy email-based preview
      if (!img && emailForImages) {
        try {
          const emailFolder = emailToS3Folder(emailForImages);
          const legacyKey = `${emailFolder}/mockups/${p.imageFile}`;
          img = await presignGetObject(legacyKey, 300);
        } catch (_) { img = null; }
      }
      // Final fallback to base product image
      if (!img) img = baseImageUrl;

      const productData = { name: p.name || `Item ${p.id}` };
      if (p.description && String(p.description).trim() !== '') {
        productData.description = p.description;
      }
      if (img && String(img).trim() !== '') {
        productData.images = [img];
      }
      if (chosenVersion) {
        productData.metadata = Object.assign({}, productData.metadata || {}, { design_version: chosenVersion, quote_id: quoteId || '' });
      }

      return {
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(unit * 100),
          tax_behavior: 'exclusive',
          product_data: productData
        },
        quantity: qty
      };
    }));

    const subtotalCents = cart.reduce((sum, item) => {
      const p = activeProducts.find(ap => ap.id === item.productId);
      if (!p) return sum;
      const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
      const unit = calculatePrice(p, qty);
      return sum + Math.round(unit * 100) * qty;
    }, 0);

    const shipping_options = shippingOptionsFor(subtotalCents, { country: 'US' });

    const sessionConfig = {
      mode: 'payment',
      billing_address_collection: 'required',
      shipping_address_collection: { allowed_countries: CONFIG.ALLOWED_SHIP_COUNTRIES },
      phone_number_collection: { enabled: true },
      customer_email: safeCustomerInfo.email || undefined,
      shipping_options,
      automatic_tax: { enabled: true },
      line_items,
      allow_promotion_codes: true,
      success_url: `${CONFIG.PUBLIC_BASE_URL}/?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CONFIG.PUBLIC_BASE_URL}/?canceled=1`
    };

    // Attach quote-level metadata, including a compact versions map
    const versionsMap = Array.isArray(cart) ? cart.reduce((acc, it) => { if (it.productId) acc[it.productId] = it.versionId || ''; return acc; }, {}) : {};
    sessionConfig.metadata = { quoteId: quoteId || '', versionId: versionId || '', versions_json: JSON.stringify(versionsMap) };
    const session = await stripe.checkout.sessions.create(sessionConfig);
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe create-checkout error:', err);
    res.status(500).json({ error: 'Failed to create payment link', details: err.message });
  }
});

/* ====== Per-product endpoints: boxes, mockup+upload (combined), upload base ====== */

// Save boxes JSON to Airtable "boxes" field for a product_id
// Boxes endpoint: store with design or Neon in future; for now, accept and echo
app.post('/api/products/:id/boxes', async (req, res) => {
    const productId = req.params.id;
    const boxes = req.body?.boxes;
    if (!Array.isArray(boxes) || boxes.length === 0) {
      return res.status(400).json({ error: 'boxes array required' });
    }
  res.json({ ok: true, productId, boxes });
});

// Bulk update boxes: [{ productId, boxes: [{name,x1,y1,x2,y2}, ...] }, ...]
app.post('/api/products/boxes/bulk', async (req, res) => {
    let items = null;
    if (req.body && Array.isArray(req.body.items)) {
      items = req.body.items;
    } else if (req.body && typeof req.body === 'object') {
      const keys = Object.keys(req.body);
      const looksLikeMap = keys.every(k => req.body[k] && Array.isArray(req.body[k].boxes));
      if (looksLikeMap) {
        items = keys.map(imageFile => ({ imageFile, boxes: req.body[imageFile].boxes }));
      }
    }
    if (!items || !items.length) return res.status(400).json({ error: 'Provide items[] or an object of imageFile->{boxes:[]}' });
  const results = items.map(it => ({ id: it.productId || it.id || it.imageFile, ok: Array.isArray(it.boxes) && it.boxes.length > 0 }));
    res.json({ ok: true, results });
});

/* Create or update a design manifest for a product within a version */
app.post('/api/quotes/:quoteId/versions/:versionId/designs/:productId', async (req, res) => {
  try {
    const { quoteId, versionId, productId } = req.params;
    const { email, logoRef, placement, name } = req.body || {};
    if (!email || !logoRef || !placement) return res.status(400).json({ error: 'email, logoRef, placement required' });
    const domain = companyDomainFromEmail(email);

    const indexKey = s3KeyForVersionIndex(domain, quoteId, versionId);
    const designKey = s3KeyForDesign(domain, quoteId, versionId, productId);

    const now = new Date().toISOString();
    let design = { productId, logoRef, placement, updatedAt: now };

    // Enrich placement with pxPerIn + printerSpec
    try {
      const pack = require('./directum_placement_pricing_pack_v1');
      const { s3GetJson } = require('./s3');
      const adapters = app.locals.directumAdapters || {};
      const bucket = process.env.AWS_BUCKET_NAME || 'leadprocessor';
      // Expect product.sku or id to include a style identifier usable for catalog path
      const products = await getActiveProducts();
      const prod = products.find(x => x.id === productId);
      const styleId = (prod && (prod.sku || prod.id || '')).split(/[^A-Za-z0-9_-]/)[0] || '';
      let enriched = false;
      // Preferred: LS-style zones.json if available
      if (styleId) {
        try {
          const zones = await s3GetJson(bucket, `catalog/${styleId}/zones.json`).catch(() => null);
          if (zones && zones.zones && Array.isArray(zones.zones)) {
            const zoneName = (placement && placement.name) || (zones.zones[0] && zones.zones[0].name) || 'print_area';
            const zoneSpec = zones.zones.find(z => z.name === zoneName) || zones.zones[0];
            if (zoneSpec && placement && placement.px) {
              const spec = pack.toPrinterSpec(placement.px, zoneSpec, 'zone_origin');
              const artTooLarge = (spec.artWidthIn > (zoneSpec.physical?.w_in || Infinity)) || (spec.artHeightIn > (zoneSpec.physical?.h_in || Infinity));
              if (artTooLarge) {
                return res.status(400).json({ error: 'art-exceeds-physical-bounds', details: { art: { w_in: spec.artWidthIn, h_in: spec.artHeightIn }, physical: zoneSpec.physical } });
              }
              design.placement = Object.assign({}, design.placement, { pxPerIn: spec.pxPerIn, printerSpec: spec });
              enriched = true;
            }
          }
        } catch (_) {}
      }

      // Fallbacks: (1) stored per-style pxPerIn, else (2) compute via SAGE inches + image rect
      if (!enriched && placement && placement.px) {
        try {
          // (1) stored scale (style-level, with per-view override)
          if (styleId) {
            const scales = await readJsonFromS3(`catalog/${styleId}/scales.json`);
            let pxPerInStored = (scales && Number(scales.defaultPxPerIn) > 0) ? Number(scales.defaultPxPerIn) : null;
            // View-aware override if placement.view is provided
            const viewName = (placement && placement.view) ? String(placement.view) : '';
            if (viewName && scales && scales.views && scales.views[viewName] && Number(scales.views[viewName].pxPerIn) > 0) {
              pxPerInStored = Number(scales.views[viewName].pxPerIn);
            }
            if (pxPerInStored) {
              const toIn = (px) => Number((px / pxPerInStored).toFixed(3));
              const box = placement.px;
              const spec = {
                unit: 'in',
                pxPerIn: pxPerInStored,
                artWidthIn: toIn((box.x2 - box.x1)),
                artHeightIn: toIn((box.y2 - box.y1)),
                offsetXIn: toIn(box.x1),
                offsetYIn: toIn(box.y1),
                rotationDeg: Math.round(box.rot || 0),
                anchor: 'zone_origin',
                toleranceIn: 0.125
              };
              design.placement = Object.assign({}, design.placement, { pxPerIn: pxPerInStored, printerSpec: spec });
              enriched = true;
            }
          }
          // (2) compute via SAGE inches and base image rect
          if (!enriched) {
            // Load a base catalog image from S3 and treat whole image as rect
            const styleKeyPrefix = styleId ? `catalog-images/${styleId}/` : null;
            let baseBuffer = null;
            if (styleKeyPrefix) {
              try {
                const { ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
                const listing = await s3Client.send(new ListObjectsV2Command({ Bucket: CONFIG.AWS_BUCKET_NAME, Prefix: styleKeyPrefix }));
                const keys = (listing.Contents || []).map(o => o.Key).filter(k => /(png|jpe?g|webp)$/i.test(String(k)));
                const score = (k) => { const s = String(k).toLowerCase(); if (/front/.test(s)) return 0; if (/(product|color)/.test(s)) return 1; if (/(left|right)/.test(s)) return 2; if (/back/.test(s)) return 3; return 9; };
                keys.sort((a,b)=> score(a)-score(b));
                if (keys[0]) {
                  const obj = await s3Client.send(new GetObjectCommand({ Bucket: CONFIG.AWS_BUCKET_NAME, Key: keys[0] }));
                  baseBuffer = Buffer.from(await obj.Body.transformToByteArray());
                }
              } catch (_) {}
            }
            let rectPx = null;
            if (baseBuffer) {
              const meta = await sharp(baseBuffer).metadata();
              rectPx = { x: 0, y: 0, w: Number(meta.width || 0), h: Number(meta.height || 0) };
            }
            const fetchSageFullDetail = adapters.fetchSageFullDetail || (async () => null);
            const sage = await fetchSageFullDetail({ prodEId: prod?.id || productId }).catch(() => null);
            const imprint = (() => {
              if (!sage) return null;
              const areas = sage.imprintAreas || sage.imprint || sage.printAreas || [];
              const first = Array.isArray(areas) && areas[0] ? areas[0] : null;
              const w_in = Number(first?.widthIn || first?.w_in || first?.width || 0);
              const h_in = Number(first?.heightIn || first?.h_in || first?.height || 0);
              return (w_in > 0 || h_in > 0) ? { w_in, h_in } : null;
            })();

            if (rectPx && imprint) {
              const pxPerIn = require('./directum_placement_pricing_pack_v1').derivePxPerInFromRectAndImprint(rectPx, imprint);
              const spec = require('./directum_placement_pricing_pack_v1').toPrinterSpecFromRect(placement.px, rectPx, pxPerIn, 'zone_origin');
              design.placement = Object.assign({}, design.placement, { pxPerIn: spec.pxPerIn, printerSpec: spec });
              enriched = true;
            }
          }
        } catch (_) {}
      }

      // Last resort: accept provided pxPerIn/printerSpec from client (temporary until SAGE wired)
      if (!enriched && placement && (placement.pxPerIn || placement.printerSpec)) {
        const pxPerIn = Number(placement.pxPerIn || (placement.printerSpec && placement.printerSpec.pxPerIn) || 0) || undefined;
        const printerSpec = placement.printerSpec || undefined;
        if (pxPerIn && printerSpec) {
          design.placement = Object.assign({}, design.placement, { pxPerIn, printerSpec });
          enriched = true;
        }
      }
    } catch (_) {}

    // Write design JSON
    const designBuf = Buffer.from(JSON.stringify(design, null, 2));
    await s3Client.send(new PutObjectCommand({ Bucket: CONFIG.AWS_BUCKET_NAME, Key: designKey, Body: designBuf, ContentType: 'application/json' }));

    // Update index (best-effort; if 404, create)
    let index = { name: name || versionId, createdAt: now, products: [], writeToken: undefined };
    try {
      const url = await presignGetObject(indexKey, 60);
      const resp = await axios.get(url, { responseType: 'json' });
      if (resp?.data) index = resp.data;
    } catch (_) {}
    const existsIdx = (index.products || []).findIndex(p => p.productId === productId);
    if (existsIdx >= 0) index.products[existsIdx] = { productId, updatedAt: now };
    else (index.products = index.products || []).push({ productId, updatedAt: now });
    const indexBuf = Buffer.from(JSON.stringify(index, null, 2));
    await s3Client.send(new PutObjectCommand({ Bucket: CONFIG.AWS_BUCKET_NAME, Key: indexKey, Body: indexBuf, ContentType: 'application/json' }));

    res.json({ ok: true, designKey, indexKey });
  } catch (e) {
    console.error('save design error:', e);
    res.status(500).json({ error: 'Failed to save design' });
  }
});

/* Get presigned preview URL for a product/version */
app.get('/api/quotes/:quoteId/versions/:versionId/previews/:productId', async (req, res) => {
  try {
    const { quoteId, versionId, productId } = req.params;
    const { email } = req.query || {};
    if (!email) return res.status(400).json({ error: 'email required' });
    const domain = companyDomainFromEmail(email);
    const key = s3KeyForPreview(domain, quoteId, versionId, productId);
    const url = await presignGetObject(key, 300);
    res.json({ key, url });
  } catch (e) {
    console.error('presign preview error:', e);
    res.status(500).json({ error: 'Failed to presign preview' });
  }
});

/* Render and upload a preview image (composite) given design manifest */
app.post('/api/quotes/:quoteId/versions/:versionId/previews/:productId/render', async (req, res) => {
  try {
    const { quoteId, versionId, productId } = req.params;
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email required' });
    const domain = companyDomainFromEmail(email);

    // Load design manifest
    const designKey = s3KeyForDesign(domain, quoteId, versionId, productId);
    const designUrl = await presignGetObject(designKey, 60);
    const { data: design } = await axios.get(designUrl, { responseType: 'json' });

    // Resolve base image from S3 catalog-images/<styleId>/ (front preferred)
    const products = await getActiveProducts();
    const p = products.find(x => x.id === productId);
    // Allow rendering even if product isn't in Airtable; derive styleId from productId
    const styleIdForImages = p ? (p.sku || p.id) : productId;
    const { ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
    const prefix = `catalog-images/${styleIdForImages}/`;
    const listing = await s3Client.send(new ListObjectsV2Command({ Bucket: CONFIG.AWS_BUCKET_NAME, Prefix: prefix }));
    const allKeys = (listing.Contents || []).map(o => o.Key).filter(k => /\.(png|jpe?g|webp)$/i.test(String(k)));
    const score = (k) => {
      const s = String(k).toLowerCase();
      if (/front/.test(s)) return 0;
      if (/(product|color)/.test(s)) return 1;
      if (/(left|right)/.test(s)) return 2;
      if (/back/.test(s)) return 3;
      return 9;
    };
    allKeys.sort((a,b)=> score(a) - score(b));
    if (!allKeys.length) return res.status(404).json({ error: 'No catalog images found in S3 for product' });
    const baseKey = allKeys[0];
    const obj = await s3Client.send(new GetObjectCommand({ Bucket: CONFIG.AWS_BUCKET_NAME, Key: baseKey }));
    const baseImageInput = Buffer.from(await obj.Body.transformToByteArray());

    // Load logo (download to buffer)
    let logoHttpUrl = design.logoRef;
    if (design.logoRef && typeof design.logoRef === 'string') {
      if (design.logoRef.startsWith('s3://')) {
        const key = design.logoRef.replace(/^s3:\/\//, '').replace(`${CONFIG.AWS_BUCKET_NAME}/`, '');
        logoHttpUrl = await presignGetObject(key, 120);
    } else {
        // If the URL points to our bucket host (private), presign it
        try {
          const bucketHostA = `${CONFIG.AWS_BUCKET_NAME}.s3.${CONFIG.AWS_REGION}.amazonaws.com`;
          const bucketHostB = CONFIG.AWS_BUCKET_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
          const u = new URL(design.logoRef);
          const isOurBucket = (u.host === bucketHostA) || (u.host === bucketHostB);
          if (isOurBucket) {
            let key = u.pathname.replace(/^\//, '');
            // If pathname includes bucket name, strip it
            key = key.replace(new RegExp(`^${CONFIG.AWS_BUCKET_NAME}\/`), '');
            logoHttpUrl = await presignGetObject(key, 120);
          }
        } catch (_) { /* fallback to provided URL */ }
      }
    }
    const logoResp = await axios.get(logoHttpUrl, { responseType: 'arraybuffer' });
    const logoBuffer = Buffer.from(logoResp.data);

    const placement = design.placement?.px;
    if (!placement) return res.status(400).json({ error: 'placement.px required' });
    const { x1, y1, x2, y2 } = placement;

    // Composite with sharp
    const baseImage = sharp(baseImageInput);
    const metadata = await baseImage.metadata();
    const width = Math.max(1, Math.round(x2 - x1));
    const height = Math.max(1, Math.round(y2 - y1));
    // Resize logo to fit within box with transparent letterboxing (no black bars)
    const resizedLogo = await sharp(logoBuffer)
      .ensureAlpha() // add alpha channel if source lacks one (e.g., JPEG)
      .resize({ width, height, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png() // keep transparency in intermediate buffer
      .toBuffer();
    const compositeBuf = await sharp(baseImageInput)
      .composite([{ input: resizedLogo, left: Math.round(x1), top: Math.round(y1), blend: 'over' }])
      .webp({ quality: 90 })
      .toBuffer();

    // Upload preview to S3 (private)
    const previewKey = s3KeyForPreview(domain, quoteId, versionId, productId);
    await s3Client.send(new PutObjectCommand({ Bucket: CONFIG.AWS_BUCKET_NAME, Key: previewKey, Body: compositeBuf, ContentType: 'image/webp' }));
    const previewUrl = await presignGetObject(previewKey, 300);

    res.json({ ok: true, previewKey, previewUrl, size: compositeBuf.length, base: { width: metadata.width, height: metadata.height } });
  } catch (e) {
    console.error('render preview error:', e);
    res.status(500).json({ error: 'Failed to render preview' });
  }
});

/* Minimal quote/version create & list (index.json only) */
app.post('/api/quotes/:quoteId/versions', async (req, res) => {
  try {
    const { quoteId } = req.params;
    const { email, versionId, name } = req.body || {};
    if (!email || !versionId) return res.status(400).json({ error: 'email and versionId required' });
    const domain = companyDomainFromEmail(email);
    const key = s3KeyForVersionIndex(domain, quoteId, versionId);
    const now = new Date().toISOString();
    const index = { name: name || versionId, createdBy: email, createdAt: now, products: [] };
    await s3Client.send(new PutObjectCommand({ Bucket: CONFIG.AWS_BUCKET_NAME, Key: key, Body: Buffer.from(JSON.stringify(index, null, 2)), ContentType: 'application/json' }));
    res.json({ ok: true, key });
  } catch (e) {
    console.error('create version error:', e);
    res.status(500).json({ error: 'Failed to create version' });
  }
});

app.get('/api/quotes/:quoteId/versions/:versionId', async (req, res) => {
  try {
    const { quoteId, versionId } = req.params;
    const { email } = req.query || {};
    if (!email) return res.status(400).json({ error: 'email required' });
    const domain = companyDomainFromEmail(email);
    const key = s3KeyForVersionIndex(domain, quoteId, versionId);
    const url = await presignGetObject(key, 60);
    const { data } = await axios.get(url, { responseType: 'json' });
    res.json({ key, index: data });
  } catch (e) {
    console.error('get version error:', e);
    res.status(500).json({ error: 'Failed to get version' });
  }
});

// Fetch a saved design manifest (for UI guardrails)
app.get('/api/quotes/:quoteId/versions/:versionId/designs/:productId', async (req, res) => {
  try {
    const { quoteId, versionId, productId } = req.params;
    const { email } = req.query || {};
    if (!email) return res.status(400).json({ error: 'email required' });
    const domain = companyDomainFromEmail(email);
    const key = s3KeyForDesign(domain, quoteId, versionId, productId);
    const url = await presignGetObject(key, 60);
    const { data } = await axios.get(url, { responseType: 'json' });
    res.json({ key, design: data });
  } catch (e) {
    console.error('get design error:', e);
    res.status(404).json({ error: 'Design not found' });
  }
});

// List versions that have a design for a specific product
app.get('/api/quotes/:quoteId/products/:productId/versions', async (req, res) => {
  try {
    const { quoteId, productId } = req.params;
    const { email } = req.query || {};
    if (!email) return res.status(400).json({ error: 'email required' });
    const domain = companyDomainFromEmail(email);
    const prefix = `company/${domain}/quotes/${quoteId}/versions/`;
    const command = new ListObjectsV2Command({ Bucket: CONFIG.AWS_BUCKET_NAME, Prefix: prefix });
    const out = await s3Client.send(command);
    const versions = new Set();
    for (const obj of out.Contents || []) {
      const key = obj.Key || '';
      // match versions/<versionId>/designs/<productId>.json
      const parts = key.split('/');
      const idx = parts.indexOf('versions');
      if (idx >= 0 && parts[idx+2] === 'designs' && parts[idx+3] === `${productId}.json`) {
        const versionId = parts[idx+1];
        if (versionId) versions.add(versionId);
      }
    }
    res.json({ versions: Array.from(versions) });
  } catch (e) {
    console.error('list product versions error:', e);
    res.status(500).json({ error: 'Failed to list product versions' });
  }
});

/* List versions for a quote by inspecting S3 prefixes */
app.get('/api/quotes/:quoteId/versions', async (req, res) => {
  try {
    const { quoteId } = req.params;
    const { email } = req.query || {};
    if (!email) return res.status(400).json({ error: 'email required' });
    const domain = companyDomainFromEmail(email);
    const prefix = `company/${domain}/quotes/${quoteId}/versions/`;
    const command = new ListObjectsV2Command({ Bucket: CONFIG.AWS_BUCKET_NAME, Prefix: prefix, Delimiter: '/' });
    const out = await s3Client.send(command);
    const versions = (out.CommonPrefixes || [])
      .map(cp => (cp.Prefix || '').slice(prefix.length).replace(/\/$/, ''))
      .filter(v => !!v);
    res.json({ versions });
  } catch (e) {
    console.error('list versions error:', e);
    res.status(500).json({ error: 'Failed to list versions' });
  }
});

/* Find logo in S3 for customer email */
app.get('/api/customer/:email/logo', async (req, res) => {
  try {
    const email = req.params.email;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const emailFolder = emailToS3Folder(email);
    const logoPrefix = `${emailFolder}/logo/`;

    // List objects in the logo folder
    const command = new ListObjectsV2Command({
      Bucket: CONFIG.AWS_BUCKET_NAME,
      Prefix: logoPrefix,
      MaxKeys: 10
    });

    const response = await s3Client.send(command);
    const logoFiles = (response.Contents || [])
      .filter(obj => obj.Key && !obj.Key.endsWith('/')) // Exclude folder markers
      .filter(obj => {
        const filename = obj.Key.toLowerCase();
        return filename.endsWith('.png') || filename.endsWith('.jpg') || 
               filename.endsWith('.jpeg') || filename.endsWith('.svg');
      })
      .sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified)); // Most recent first

    if (logoFiles.length === 0) {
      return res.status(404).json({ error: 'No logo found', hasLogo: false });
    }

    // Prefer filename-based company default: match on filename only
    const domain = String(email.split('@')[1] || '').toLowerCase();
    const domainBase = (domain.split('.')[0] || '').toLowerCase();
    const filenameOf = (k) => (k || '').split('/').pop().toLowerCase();
    // Exact: d2completion_logo.* or d2completion.*
    const exactRe = new RegExp(`^${domainBase}(_logo)?\\.(png|jpe?g|svg)$`, 'i');
    // Prefer *_logo.* containing company base
    const containsLogoRe = new RegExp(`${domainBase}.*_logo\\.(png|jpe?g|svg)$`, 'i');
    const endsWithLogoRe = /_logo\.(png|jpe?g|svg)$/i;
    const preferredExact = logoFiles.find(f => exactRe.test(filenameOf(f.Key)));
    const preferredContainsLogo = logoFiles.find(f => containsLogoRe.test(filenameOf(f.Key)));
    const preferredEndsWithLogo = logoFiles.find(f => endsWithLogoRe.test(filenameOf(f.Key)));
    const logoFile = preferredExact || preferredContainsLogo || preferredEndsWithLogo || logoFiles[0];
    let logoUrl = null;
    try { logoUrl = await presignGetObject(logoFile.Key, 300); } catch { logoUrl = `${CONFIG.AWS_BUCKET_URL}/${logoFile.Key}`; }

    res.json({
      hasLogo: true,
      logoUrl: logoUrl,
      key: logoFile.Key,
      filename: logoFile.Key.split('/').pop(),
      uploadedAt: logoFile.LastModified
    });

  } catch (error) {
    console.error('Error fetching customer logo:', error);
    res.status(500).json({ error: 'Failed to fetch logo', hasLogo: false });
  }
});

/**
 * Generate mockup for a single product:
 * - Upload base image to S3 as placeholder
 * - Run Python generator (which uploads mockups to S3)
 * - Parse JSON manifest from Python stdout
 * - Update Airtable with mockup URLs + metadata
 */
// server.js  — REPLACE the existing /api/products/:id/mockup handler with this one
app.post('/api/products/:id/mockup', async (req, res) => {
  try {
    const productId = req.params.id;
    let { email, logoUrl } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email required' });

    // If logoUrl not provided, pick a default logo for this email
    if (!logoUrl) {
      try {
        // Try new company-based structure first
        const domain = companyDomainFromEmail(email);
        const logoPrefix = `company/${domain}/logos/`;
        let command = new ListObjectsV2Command({ Bucket: CONFIG.AWS_BUCKET_NAME, Prefix: logoPrefix, MaxKeys: 100 });
        let response = await s3Client.send(command);
        let files = (response.Contents || [])
          .filter(o => o.Key && !o.Key.endsWith('/'))
          .filter(o => /\.(png|jpe?g|svg)$/i.test(o.Key));
        
        // Fallback to legacy email-based structure if no files found
        if (!files.length) {
          const emailFolder = emailToS3Folder(email);
          const legacyLogoPrefix = `${emailFolder}/logo/`;
          command = new ListObjectsV2Command({ Bucket: CONFIG.AWS_BUCKET_NAME, Prefix: legacyLogoPrefix, MaxKeys: 100 });
          response = await s3Client.send(command);
          files = (response.Contents || [])
            .filter(o => o.Key && !o.Key.endsWith('/'))
            .filter(o => /\.(png|jpe?g|svg)$/i.test(o.Key));
        }
        
        if (!files.length) throw new Error(`No logo files found in company/${domain}/logos/ or ${emailToS3Folder(email)}/logo/`);
        const pick = chooseDefaultLogoForEmail(email, files);
        try { logoUrl = await presignGetObject(pick.Key, 300); } catch { logoUrl = `${CONFIG.AWS_BUCKET_URL.replace(/\/$/, '')}/${pick.Key}`; }
      } catch (e) {
        return res.status(400).json({ 
          error: 'logo not found for email', 
          details: String(e),
          email,
          domain: companyDomainFromEmail(email),
          searchedPaths: [
            `company/${companyDomainFromEmail(email)}/logos/`,
            `${emailToS3Folder(email)}/logo/`
          ]
        });
      }
    }

    // Find product via Neon-backed list
    const list = await getActiveProducts();
    const p = list.find(x => x.id === productId);
    if (!p) return res.status(404).json({ error: 'Product not found' });

    // 1) Try to upload base image as placeholder if it exists locally; otherwise fallback to public URL
    const localPath = path.join(__dirname, 'public', 'images', 'products', p.imageFile);
    const folder = emailToS3Folder(email);
    const baseKey = `${folder}/mockups/${p.imageFile}`;
    const ext = (p.imageFile.split('.').pop() || '').toLowerCase();
    const type = ext === 'png' ? 'image/png' : (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream');

    let placeholderBaseUrl = `${CONFIG.PUBLIC_BASE_URL}/images/products/${encodeURIComponent(p.imageFile)}`;
    if (fs.existsSync(localPath) && typeof uploadFileToS3 === 'function') {
      try {
        placeholderBaseUrl = await uploadFileToS3(localPath, baseKey, type, true);
      } catch (e) {
        console.warn('Placeholder upload failed, continuing with public URL fallback:', e.message);
      }
    } else {
      console.warn(`Base image not on disk (${p.imageFile}); using public URL fallback.`);
    }

    // 2) Run Python generator (it will also upload mockups and can fetch the base image if missing)
    const scriptPath = path.join(__dirname, 'python', 'build_mockups_from_airtable.py'); // legacy script name; Airtable no longer used
    const args = [
      scriptPath,
      '--email', email,
      '--logo_url', logoUrl,
      '--products_dir', path.join(__dirname, 'public', 'images', 'products'),
      '--product_id', productId
    ];
    let pyStdout = '';
    let pyStderr = '';
    const isWindows = process.platform === 'win32';
    // Prefer project venv python if available
    const venvPython = isWindows
      ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
      : path.join(__dirname, '.venv', 'bin', 'python3');
    const hasVenvPython = fs.existsSync(venvPython);
    const pythonCmd = hasVenvPython ? venvPython : (isWindows ? 'py' : 'python3');
    const pythonPrefixArgs = hasVenvPython ? [] : (isWindows ? ['-3'] : []);
    const py = spawn(pythonCmd, [...pythonPrefixArgs, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    py.stdout.on('data', (d) => { pyStdout += d.toString(); });
    py.stderr.on('data', (d) => { pyStderr += d.toString(); });
    py.on('close', async (code) => {
      if (code !== 0) {
        console.error('mockup stderr:', pyStderr);
        return res.status(500).json({ error: `mockup generation failed (${code})`, stderr: pyStderr, stdout: pyStdout });
      }

      let manifest = null;
      try { manifest = JSON.parse(pyStdout.trim()); }
      catch (e) {
        console.error('Manifest parse error:', e.message, '\nSTDOUT:', pyStdout);
        return res.status(500).json({ error: 'Invalid manifest from generator' });
      }

      // Airtable removed: skip updating external tables
      const nowIso = new Date().toISOString();
      const imageFile = p.imageFile;
      const pm = (manifest.product_map && manifest.product_map[imageFile]) || {};
      const pngUrl = (pm.png_urls && pm.png_urls[0]) || placeholderBaseUrl;
      const pdfUrl = (pm.pdf_urls && pm.pdf_urls[0]) || null;
      const previewUrl = (pm.preview_urls && pm.preview_urls[0]) || null;


      res.json({
        ok: true,
        placeholder_base_url: placeholderBaseUrl,
        mockup: { pngUrl, pdfUrl, previewUrl },
        chosen_logo_url: logoUrl,
        manifest
      });
    });
  } catch (e) {
    console.error('mockup error:', e);
    res.status(500).json({ error: e.message });
  }
});

/* Health */
app.get('/health', (_req, res) => res.json({ ok: true }));

/* Start */
app.listen(CONFIG.PORT, () => {
  console.log(`Server running on port ${CONFIG.PORT}`);
  console.log(`Open ${CONFIG.PUBLIC_BASE_URL}`);
});
