"""Export install icons from the existing Pista SVG (build-time Inkscape only).

Run: python3 scripts/export_icons.py
The app does not need Python, Inkscape or any image library at runtime.
"""
from pathlib import Path
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
INKSCAPE = shutil.which('inkscape')
if not INKSCAPE:
    raise SystemExit('Install Inkscape to re-export the app icons.')

NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)
logo = ET.parse(ROOT / 'logo.svg').getroot()
source_background = logo.find(f'{{{NS}}}rect')
background = source_background.get('fill')
dest = ROOT / 'icons'
dest.mkdir(exist_ok=True)

with tempfile.TemporaryDirectory(prefix='pista-icons-') as scratch:
    for filename, size, scale in [
        ('icon-192.png', 192, 1),
        ('icon-512.png', 512, 1),
        ('maskable-512.png', 512, .8),
        ('apple-touch-icon.png', 180, 1),
    ]:
        # Opaque background lets the operating system apply its own icon mask.
        # The smaller maskable mark fits comfortably inside the central 40%-radius circle.
        image = ET.Element(f'{{{NS}}}svg', {'viewBox': '0 0 64 64'})
        ET.SubElement(image, f'{{{NS}}}rect', {
            'width': '64', 'height': '64', 'fill': background,
        })
        offset = 32 * (1 - scale)
        group = ET.SubElement(image, f'{{{NS}}}g', {
            'transform': f'translate({offset:g} {offset:g}) scale({scale:g})',
        })
        for child in logo:
            if child is not source_background:
                group.append(child)
        source = Path(scratch) / f'{filename}.svg'
        ET.ElementTree(image).write(source, encoding='utf-8', xml_declaration=True)
        subprocess.run([
            INKSCAPE, str(source), '--export-type=png',
            f'--export-width={size}', f'--export-height={size}',
            f'--export-filename={dest / filename}',
        ], check=True, capture_output=True)
        print(f'{filename}: {size}x{size}')
