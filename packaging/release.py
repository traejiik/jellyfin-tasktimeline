"""Build Jellyfin release assets without modifying tracked version placeholders."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import zipfile

DLL = 'Jellyfin.Plugin.TaskTimeline.dll'


def version_from_tag(tag):
    match = re.fullmatch(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', tag)
    if not match:
        raise ValueError('Expected a stable vMAJOR.MINOR.PATCH tag')
    parts = tuple(map(int, match.groups()))
    if parts == (0, 0, 0) or any(part > 65534 for part in parts):
        raise ValueError('Release version must be nonzero and fit .NET assembly version fields')
    return '.'.join(map(str, (*parts, 0)))


def package(template, publish, output, tag, repository, notes):
    version = version_from_tag(tag)
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Repository must have the form owner/name')
    assembly = publish / DLL
    if not assembly.is_file():
        raise FileNotFoundError(f'Missing published assembly: {assembly}')
    manifest = json.loads(template.read_text())
    plugin = manifest[0]
    # Never publish a template placeholder as a broken artwork URL.
    if plugin.get('imageUrl') == 'tbd':
        del plugin['imageUrl']
    release = {
        'version': version,
        'targetAbi': plugin['versions'][0]['targetAbi'],
        'changelog': notes.strip(),
        'timestamp': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
    }
    plugin['versions'] = [release]
    metadata = {key: plugin[key] for key in ('guid', 'name', 'description', 'overview', 'owner', 'category')}
    metadata.update(release)
    metadata.update(status='Active', autoUpdate=True, assemblies=[DLL])
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f'tasktimeline_{version}.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
        bundle.write(assembly, DLL)
        bundle.writestr('meta.json', json.dumps(metadata, indent=2) + '\n')
    data = archive.read_bytes()
    release['checksum'] = hashlib.md5(data).hexdigest()  # Jellyfin feed format.
    release['sourceUrl'] = f'https://github.com/{repository}/releases/download/{tag}/{archive.name}'
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (output / f'{archive.name}.sha256').write_text(f'{hashlib.sha256(data).hexdigest()}  {archive.name}\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('version', 'package'))
    parser.add_argument('--tag', required=True)
    parser.add_argument('--repository')
    parser.add_argument('--publish-dir', type=Path)
    parser.add_argument('--output', type=Path, default=Path('dist'))
    parser.add_argument('--notes-file', type=Path)
    args = parser.parse_args()
    if args.command == 'version':
        print(version_from_tag(args.tag))
        return
    if not all((args.repository, args.publish_dir, args.notes_file)):
        parser.error('package requires --repository, --publish-dir, and --notes-file')
    package(Path(__file__).resolve().parents[1] / 'manifest.json', args.publish_dir,
            args.output, args.tag, args.repository, args.notes_file.read_text())


if __name__ == '__main__':
    main()
