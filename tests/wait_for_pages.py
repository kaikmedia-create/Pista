"""Verify that the public Pages deployment serves this exact release, not stale HTML."""
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('PISTA_URL', 'https://kaikmedia-create.github.io/Pista/')
COMMIT = os.environ.get('PISTA_COMMIT', 'manual')
ASSETS = ['index.html', 'styles.css', 'tracker.css', 'tracker-view.js', 'refinements.css', 'app.js', 'core.js', 'training-plan.js', 'pdf.js', 'sw.js', 'logo.svg', 'manifest.webmanifest']
expected = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in ASSETS}
deadline = time.monotonic() + 240
last_error = ''
while time.monotonic() < deadline:
    try:
        observed = {}
        for name in ASSETS:
            req = urllib.request.Request(BASE + name + '?release=' + COMMIT, headers={'Cache-Control': 'no-cache', 'User-Agent': 'Pista-Deployment-Verification'})
            with urllib.request.urlopen(req, timeout=20) as response:
                assert response.status == 200, (name, response.status)
                observed[name] = hashlib.sha256(response.read()).hexdigest()
            assert observed[name] == expected[name], f'{name} is not yet the requested release'
        out = ROOT / 'test-results'
        out.mkdir(exist_ok=True)
        (out / 'live-deployment.json').write_text(json.dumps({'url': BASE, 'commit': COMMIT, 'all_assets_match': True, 'sha256': observed}, indent=2))
        print(f'LIVE RELEASE VERIFIED: {BASE} commit {COMMIT}; all {len(ASSETS)} files match.', flush=True)
        break
    except Exception as error:
        last_error = str(error)
        print('Deployment not yet verified: ' + last_error, flush=True)
        time.sleep(8)
else:
    raise RuntimeError('Could not verify public Pages release: ' + last_error)
