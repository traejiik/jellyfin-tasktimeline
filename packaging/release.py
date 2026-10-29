"""Build Jellyfin install folders and release assets without changing source versions."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import zipfile
import xml.etree.ElementTree as ET

DLL = 'Jellyfin.Plugin.TaskTimeline.dll'
ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / 'src/Jellyfin.Plugin.TaskTimeline/Jellyfin.Plugin.TaskTimeline.csproj'
CARD = 'tasktimeline-card.png'


def version_from_tag(tag):
    match = re.fullmatch(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', tag)
    if not match:
        raise ValueError('Expected a stable vMAJOR.MINOR.PATCH tag')
    parts = tuple(map(int, match.groups()))
    if parts == (0, 0, 0) or any(part > 65534 for part in parts):
        raise ValueError('Release version must be nonzero and fit .NET assembly version fields')
    return '.'.join(map(str, (*parts, 0)))


def parse_describe(describe):
    match = re.fullmatch(r'v(\d+\.\d+\.\d+)-(\d+)-g([0-9a-f]+)(-dirty)?', describe.strip())
    if not match:
        raise ValueError('Expected git describe output from a stable vMAJOR.MINOR.PATCH tag')
    base, commits, sha, dirty = match.groups()
    numeric = f'{base}.{commits}'
    if any(int(part) > 65534 for part in numeric.split('.')):
        raise ValueError('Git-derived version does not fit .NET assembly version fields')
    return numeric, f'{base}+{commits}.g{sha}' + ('.dirty' if dirty else '')


def dev_version(root):
    root = Path(root).resolve()
    def git(*args):
        return subprocess.run(['git', '-C', str(root), *args], capture_output=True, text=True)
    try:
        top = git('rev-parse', '--show-toplevel')
        if top.returncode or Path(top.stdout.strip()).resolve() != root:
            return '0.0.0.0', '0.0.0+unknown'
        if git('rev-parse', '--is-shallow-repository').stdout.strip() == 'true':
            raise ValueError('Fetch complete Git history and tags first: git fetch --unshallow --tags')
        described = git('describe', '--tags', '--long', '--dirty', '--match', 'v[0-9]*', '--exclude', '*-*')
        if described.returncode == 0:
            return parse_describe(described.stdout)
        count = git('rev-list', '--count', 'HEAD')
        sha = git('rev-parse', '--short', 'HEAD')
        if count.returncode or sha.returncode:
            return '0.0.0.0', '0.0.0+unknown'
        dirty = '-dirty' if git('status', '--porcelain', '--untracked-files=no').stdout.strip() else ''
        return parse_describe(f'v0.0.0-{count.stdout.strip()}-g{sha.stdout.strip()}{dirty}')
    except FileNotFoundError:
        return '0.0.0.0', '0.0.0+unknown'


def publish_plugin(output, version, informational):
    subprocess.run([
        'dotnet', 'publish', str(PROJECT), '--configuration', 'Release', '--output', str(output),
        f'-p:Version={version}', f'-p:AssemblyVersion={version}', f'-p:FileVersion={version}',
        f'-p:InformationalVersion={informational}', '-p:IncludeSourceRevisionInInformationalVersion=false',
    ], check=True)


def target_abi():
    project = ET.parse(PROJECT)
    server_version = project.find(".//PackageReference[@Include='Jellyfin.Controller']").attrib['Version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', server_version):
        raise ValueError('Pin Jellyfin.Controller to a three-part version to derive the target ABI')
    return server_version + '.0'


def distribution_files(publish):
    files = {DLL: publish / DLL, 'LICENSE.md': ROOT / 'LICENSE.md', CARD: ROOT / 'docs/assets' / CARD}
    for name, source in files.items():
        if not source.is_file():
            raise FileNotFoundError(f'Missing distribution file {name}: {source}')
    return files


def plugin_metadata(plugin, release):
    metadata = {key: plugin[key] for key in ('guid', 'name', 'description', 'overview', 'owner', 'category')}
    metadata.update(release)
    metadata.update(status='Active', autoUpdate=True, assemblies=[DLL], imagePath=CARD)
    return metadata


def local_package(template, publish, output, version, informational):
    files = distribution_files(publish)
    plugin = json.loads(template.read_text())[0]
    metadata = plugin_metadata(plugin, {
        'version': version,
        'targetAbi': target_abi(),
        'timestamp': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
        'changelog': f'Local development build {informational}',
    })
    output.mkdir(parents=True, exist_ok=True)
    for name, source in files.items():
        shutil.copyfile(source, output / name)
    (output / 'meta.json').write_text(json.dumps(metadata, indent=2) + '\n')


def format_changelog(notes):
    return re.sub(r'\A(?:\s*<!--.*?-->\s*)+', '', notes, flags=re.DOTALL).strip()


def package(template, publish, output, tag, repository, notes):
    version = version_from_tag(tag)
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Repository must have the form owner/name')
    files = distribution_files(publish)
    manifest = json.loads(template.read_text())
    plugin = manifest[0]
    # Never publish a template placeholder as a broken artwork URL.
    if plugin.get('imageUrl') == 'tbd':
        del plugin['imageUrl']
    release = {
        'version': version,
        'targetAbi': target_abi(),
        'changelog': format_changelog(notes),
        'timestamp': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
    }
    plugin['versions'] = [release]
    metadata = plugin_metadata(plugin, release)
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f'tasktimeline_{version}.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
        for name, source in files.items():
            bundle.write(source, name)
        bundle.writestr('meta.json', json.dumps(metadata, indent=2) + '\n')
    data = archive.read_bytes()
    release['checksum'] = hashlib.md5(data).hexdigest()  # Jellyfin feed format.
    release['sourceUrl'] = f'https://github.com/{repository}/releases/download/{tag}/{archive.name}'
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (output / f'{archive.name}.sha256').write_text(f'{hashlib.sha256(data).hexdigest()}  {archive.name}\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('version', 'package', 'local'))
    parser.add_argument('--tag')
    parser.add_argument('--repository')
    parser.add_argument('--publish-dir', type=Path, help='SDK output directory for local; published DLL input for package')
    parser.add_argument('--output', type=Path, default=Path('dist'))
    parser.add_argument('--notes-file', type=Path)
    args = parser.parse_args()
    if args.command == 'local':
        version, informational = dev_version(ROOT)
        publish = args.publish_dir or ROOT / 'artifacts/publish'
        publish_plugin(publish, version, informational)
        local_package(ROOT / 'manifest.json', publish, args.output, version, informational)
        print(f'Local build {version} ({informational}) written to {args.output}')
        return
    if not args.tag:
        parser.error(f'{args.command} requires --tag')
    if args.command == 'version':
        print(version_from_tag(args.tag))
        return
    if not all((args.repository, args.publish_dir, args.notes_file)):
        parser.error('package requires --repository, --publish-dir, and --notes-file')
    package(ROOT / 'manifest.json', args.publish_dir,
            args.output, args.tag, args.repository, args.notes_file.read_text())


if __name__ == '__main__':
    main()
