"""Export the accepted vector without redrawing it. Requires pypdfium2 and Pillow."""
from pathlib import Path
import hashlib
import json
import shutil
import zipfile
import xml.etree.ElementTree as ET
import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'design/brand-exploration'
PACK = ROOT / 'design/midniht/brand-kit'
PUBLIC = ROOT / 'apps/web/public/midniht'
PACK.mkdir(parents=True, exist_ok=True)
PUBLIC.mkdir(parents=True, exist_ok=True)
for extension in ('ai', 'pdf', 'svg'):
    original = SOURCE / f'midniht-logo-vector-clean-joins.{extension}'
    canonical = PACK / f'midniht-master.{extension}'
    if not canonical.exists() and original.exists():
        shutil.copy2(original, canonical)
    elif not canonical.exists():
        raise FileNotFoundError(f'Missing approved master: {canonical}')

svg = (PACK / 'midniht-master.svg').read_text()
# Preserve original coordinates and a modest square clear space.
svg = svg.replace('viewBox="0 0 1254 1254"', 'viewBox="36 28 1178 1178"')
(PACK / 'midniht-mark.svg').write_text(svg)
ET.register_namespace('', 'http://www.w3.org/2000/svg')
for name, color in [('ink', '#0b1c2b'), ('cream', '#f7eedb')]:
    tree = ET.fromstring(svg)
    group = tree.find('{http://www.w3.org/2000/svg}g')
    # The navy backing becomes negative space; reader details remain cut out.
    group.remove(group[0])
    for path in group:
        path.set('fill', color)
    (PACK / f'midniht-mark-one-color-{name}.svg').write_text(ET.tostring(tree, encoding='unicode'))

doc = pdfium.PdfDocument(PACK / 'midniht-master.pdf')
master = doc[0].render(scale=2, fill_color=(0, 0, 0, 0)).to_pil().crop((72, 56, 2428, 2412))
for size in (32, 48, 64, 128, 180, 192, 256, 512, 1024, 2048):
    master.resize((size, size), Image.Resampling.LANCZOS).save(PACK / f'midniht-mark-{size}.png')
for name, color in [('dark', '#0c1829'), ('light', '#f6f2ea')]:
    bg = Image.new('RGBA', (2048, 2048), color)
    bg.alpha_composite(master.resize((2048, 2048), Image.Resampling.LANCZOS))
    bg.convert('RGB').save(PACK / f'midniht-mark-{name}-2048.png')
maskable = Image.new('RGBA', (512, 512), '#0c1829')
maskable.alpha_composite(master.resize((384, 384), Image.Resampling.LANCZOS), (64, 64))
maskable.convert('RGB').save(PACK / 'midniht-maskable-512.png')
master.resize((256, 256), Image.Resampling.LANCZOS).save(PACK / 'favicon.ico', sizes=[(16,16),(32,32),(48,48)])
for name in ('midniht-mark.svg', 'midniht-mark-192.png', 'midniht-mark-512.png'):
    shutil.copy2(PACK / name, PUBLIC / name)
# Extract the existing preview's art window, excluding mockup copy and device chrome.
preview = SOURCE / 'midniht-logo-landing-concept-v2-short-wavy.png'
if not (PUBLIC / 'reading-window.webp').exists() and preview.exists():
    Image.open(preview).crop((1040, 188, 1580, 600)).convert('RGB').save(PUBLIC / 'reading-window.webp', quality=94)
elif not (PUBLIC / 'reading-window.webp').exists():
    raise FileNotFoundError('Missing approved reading-window illustration')
share = Image.new('RGBA', (1200, 630), '#0c1829')
share.alpha_composite(master.resize((420, 420), Image.Resampling.LANCZOS), (728, 105))
draw = ImageDraw.Draw(share)
font = '/System/Library/Fonts/Supplemental/Georgia.ttf'
draw.text((64, 52), 'midniht.', font=ImageFont.truetype(font, 40), fill='#d4b16c')
draw.multiline_text((64, 165), 'The quiet place\nyour stories\nreturn to.', font=ImageFont.truetype(font, 64), fill='#f4eddf', spacing=12)
draw.text((64, 505), 'A place for your reading life.', font=ImageFont.truetype(font, 26), fill='#b3bdcb')
share.convert('RGB').save(PACK / 'midniht-share-1200x630.png')
shutil.copy2(PACK / 'midniht-share-1200x630.png', PUBLIC / 'midniht-share-1200x630.png')
manifest = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(PACK.iterdir()) if p.is_file() and p.name != 'checksums.json'}
(PACK / 'checksums.json').write_text(json.dumps(manifest, indent=2)+'\n')
with zipfile.ZipFile(PACK.parent / 'midniht-brand-kit.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(PACK.iterdir()):
        if path.is_file(): archive.write(path, f'midniht-brand-kit/{path.name}')
print(f'Packaged {len(manifest)} assets in {PACK}')
