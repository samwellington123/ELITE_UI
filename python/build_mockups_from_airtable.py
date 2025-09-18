import os, json, tempfile, argparse, shutil, mimetypes
import requests
from urllib.parse import urlparse, quote

# Try to import SDK; otherwise use REST
USE_AIRTABLE_SDK = False
try:
    from airtable import Airtable  # pip install airtable-python-wrapper
    USE_AIRTABLE_SDK = True
except Exception:
    USE_AIRTABLE_SDK = False

# Your generator (provided by you)
try:
    from generate_mockups_pipeline_optimized import process_single_logo  # noqa: F401
except Exception:
    # Fallback: minimal PIL-based compositor
    from PIL import Image

    def process_single_logo(info, products_dir, output_dir, pdf_output_dir, preview_output_dir, mockup_config, logos_dir):
        """
        Minimal fallback compositor:
        - info: (logo_filename, _, _)
        - mockup_config: { image_file: { boxes: [ {x1,y1,x2,y2,name}, ... ] } }
        - Writes composited PNG to output_dir and a preview copy to preview_output_dir
        - If exactly one image_file is targeted, writes output using the original image_file name
        """
        logo_filename = info[0]
        logo_path = os.path.join(logos_dir, logo_filename)
        try:
            logo_img = Image.open(logo_path).convert("RGBA")
        except Exception as e:
            raise SystemExit(f"Failed to open logo: {e}")

        single_target = len(mockup_config.keys()) == 1

        for image_file, cfg in mockup_config.items():
            base_path = os.path.join(products_dir, image_file)
            if not os.path.isfile(base_path):
                # Try url-quoted fallback path
                base_path = os.path.join(products_dir, quote(image_file))
            try:
                base_img = Image.open(base_path).convert("RGBA")
            except Exception:
                # Skip this one if base can't be opened
                continue

            boxes = cfg.get("boxes", [])
            if not boxes:
                continue
            box = boxes[0]
            x1, y1, x2, y2 = int(box["x1"]), int(box["y1"]), int(box["x2"]), int(box["y2"]) 
            w, h = max(1, x2 - x1), max(1, y2 - y1)

            # Resize logo preserving aspect ratio to fit within box
            logo_w, logo_h = logo_img.size
            scale = min(w / logo_w, h / logo_h)
            new_size = (max(1, int(logo_w * scale)), max(1, int(logo_h * scale)))
            logo_resized = logo_img.resize(new_size, Image.LANCZOS)

            # Center inside box
            offset_x = x1 + max(0, (w - new_size[0]) // 2)
            offset_y = y1 + max(0, (h - new_size[1]) // 2)

            composite = base_img.copy()
            composite.alpha_composite(logo_resized, (offset_x, offset_y))

            # Use original filename when single target to overwrite placeholder and match UI
            if single_target:
                out_name = os.path.basename(image_file)
            else:
                out_name = os.path.splitext(os.path.basename(image_file))[0] + "_mockup.png"

            out_path = os.path.join(output_dir, out_name)
            os.makedirs(output_dir, exist_ok=True)
            # Preserve extension based on out_name
            if out_name.lower().endswith(('.jpg', '.jpeg')):
                composite.convert("RGB").save(out_path, "JPEG", quality=92)
            else:
                composite.convert("RGBA").save(out_path, "PNG")

            # Write preview copy
            os.makedirs(preview_output_dir, exist_ok=True)
            shutil.copy2(out_path, os.path.join(preview_output_dir, out_name))

            # Optional: PDF skipped in fallback

# Python S3 uploader
from upload_s3 import upload_folder as upload_folder_to_s3

def ensure_dir(p): os.makedirs(p, exist_ok=True)

def content_type_for(url_or_path):
    guess = mimetypes.guess_type(url_or_path)[0]
    return guess or 'application/octet-stream'

def download_logo(logo_url, dest_dir):
    ensure_dir(dest_dir)
    fn = os.path.basename(urlparse(logo_url).path) or "logo.png"
    if '.' not in fn:
        try:
            head = requests.head(logo_url, timeout=10)
            ct = head.headers.get('content-type','').split(';')[0]
            ext = mimetypes.guess_extension(ct) or '.png'
        except Exception:
            ext = '.png'
        fn = f"logo{ext}"
    fp = os.path.join(dest_dir, fn)
    r = requests.get(logo_url, timeout=60)
    r.raise_for_status()
    with open(fp, "wb") as f:
        f.write(r.content)
    return fp

def airtable_fetch_records_pat(base_id, table_name, pat_token):
    rows = []
    url = f"https://api.airtable.com/v0/{base_id}/{table_name}"
    headers = {"Authorization": f"Bearer {pat_token}"}
    params = {"pageSize": 100}
    while True:
        resp = requests.get(url, headers=headers, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        rows.extend(data.get("records", []))
        offset = data.get("offset")
        if not offset:
            break
        params["offset"] = offset
    return rows

def ensure_base_image_local(image_file, preferred_dir, fallback_public_base_url, work_root):
    """
    Return a directory that contains `image_file`. Prefer `preferred_dir`.
    If not present, try downloading from <fallback_public_base_url>/images/products/<image_file>
    into work_root/'products' and return that directory. If download fails, return preferred_dir.
    """
    preferred_path = os.path.join(preferred_dir, image_file)
    if os.path.isfile(preferred_path):
        return preferred_dir

    if not fallback_public_base_url:
        return preferred_dir

    try:
        tmp_dir = os.path.join(work_root, 'products')
        ensure_dir(tmp_dir)
        url = f"{fallback_public_base_url.rstrip('/')}/images/products/{quote(image_file)}"
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        with open(os.path.join(tmp_dir, image_file), "wb") as f:
            f.write(r.content)
        return tmp_dir
    except Exception as e:
        print(f"⚠️  Could not download base image {image_file}: {e}", flush=True)
        return preferred_dir

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", required=True)
    ap.add_argument("--logo_url", required=True)
    ap.add_argument("--products_dir", required=True)
    ap.add_argument("--product_id", required=False, help="If provided, only generate for this product_id")
    args = ap.parse_args()

    # ENV
    AIRTABLE_PAT     = os.environ.get("AIRTABLE_PAT")
    AIRTABLE_BASE_ID = os.environ.get("AIRTABLE_BASE_ID")
    AIRTABLE_TABLE   = os.environ.get("AIRTABLE_TABLE_NAME", "Products")
    AWS_BUCKET_NAME  = os.environ.get("AWS_BUCKET_NAME")
    PUBLIC_BASE_URL  = os.environ.get("PUBLIC_BASE_URL")  # used for fallback download

    if not AIRTABLE_BASE_ID or not AIRTABLE_PAT:
        raise SystemExit("Missing AIRTABLE_BASE_ID or AIRTABLE_PAT")

    # Fetch rows
    if USE_AIRTABLE_SDK:
        at = Airtable(AIRTABLE_BASE_ID, AIRTABLE_TABLE, AIRTABLE_PAT)
        records = at.get_all()
    else:
        records = airtable_fetch_records_pat(AIRTABLE_BASE_ID, AIRTABLE_TABLE, AIRTABLE_PAT)

    target_pid = (args.product_id or "").strip()

    # Build mockup_config: image_file -> { boxes: [...] }
    mockup_config = {}
    for rec in records:
        fields = rec["fields"] if not USE_AIRTABLE_SDK else rec.get("fields", rec)
        pid = fields.get("product_id") or fields.get("id")
        if target_pid and pid != target_pid:
            continue
        image_file = fields.get("image_file")
        boxes_raw = fields.get("boxes") or "{}"
        try:
            boxes = json.loads(boxes_raw).get("boxes", [])
        except Exception:
            boxes = []
        if image_file and boxes:
            mockup_config[image_file] = {"boxes": boxes}

    if not mockup_config:
        raise SystemExit("No products with bounding boxes matched selection in Airtable.")

    # Temp work dirs
    work = tempfile.mkdtemp(prefix="mockups_")
    logos_dir = os.path.join(work, "logos")
    out_dir   = os.path.join(work, "out")      # PNGs
    pdf_dir   = os.path.join(work, "pdf")      # PDFs
    prev_dir  = os.path.join(work, "preview")  # previews
    ensure_dir(out_dir); ensure_dir(pdf_dir); ensure_dir(prev_dir)

    # Download logo
    logo_path = download_logo(args.logo_url, logos_dir)
    info = (os.path.basename(logo_path), 1, 1)

    # If we’re targeting a single product, make sure its base image exists locally (fallback to PUBLIC_BASE_URL)
    products_dir_for_run = args.products_dir
    if len(mockup_config.keys()) == 1:
        image_file = next(iter(mockup_config.keys()))
        products_dir_for_run = ensure_base_image_local(
            image_file,
            args.products_dir,
            PUBLIC_BASE_URL,
            work
        )

    # Generate
    _ = process_single_logo(
        info,
        products_dir=products_dir_for_run,
        output_dir=out_dir,
        pdf_output_dir=pdf_dir,
        preview_output_dir=prev_dir,
        mockup_config=mockup_config,
        logos_dir=logos_dir
    )

    # Upload to S3 under <email>/mockups/*
    email_folder = args.email.lower().replace("@","_at_").replace(".","_dot_")
    s3_prefix = f"{email_folder}/mockups"

    uploaded_png, uploaded_pdf, uploaded_prev = [], [], []
    if AWS_BUCKET_NAME:
        uploaded_png  = upload_folder_to_s3(out_dir,  s3_prefix)
        uploaded_pdf  = upload_folder_to_s3(pdf_dir,  s3_prefix)
        uploaded_prev = upload_folder_to_s3(prev_dir, s3_prefix)

    # Emit pure JSON manifest on stdout (server.js reads this)
    manifest = {
        "email": args.email,
        "product_id": target_pid or None,
        "s3_prefix": s3_prefix,
        "product_map": {}
    }
    for image_file in mockup_config.keys():
        manifest["product_map"][image_file] = {
            "png_urls": uploaded_png,
            "pdf_urls": uploaded_pdf,
            "preview_urls": uploaded_prev
        }

    print(json.dumps(manifest), flush=True)

    # Cleanup
    shutil.rmtree(work, ignore_errors=True)

if __name__ == "__main__":
    main()
