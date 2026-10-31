import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
from unittest.mock import patch
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'packaging/release.py'


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), 'Release packaging script must exist')
        spec = importlib.util.spec_from_file_location('release', SCRIPT)
        self.release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.release)

    def test_tag_versions(self):
        self.assertEqual('1.2.3.0', self.release.version_from_tag('v1.2.3'))
        for tag in ('v0.0.0', '1.2.3', 'v1.2', 'v1.2.3-beta', 'v01.2.3', 'v65536.1.0'):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                self.release.version_from_tag(tag)

    def test_installable_package_and_unchanged_template(self):
        template = (ROOT / 'manifest.json').read_bytes()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            publish = root / 'publish'
            publish.mkdir()
            dll = 'Jellyfin.Plugin.TaskTimeline.dll'
            (publish / dll).write_bytes(b'plugin assembly fixture')
            (publish / 'Jellyfin.Controller.dll').write_bytes(b'host dependency')
            output = root / 'out'
            empty_template = root / 'manifest.json'
            plugin = json.loads(template)
            plugin[0]['versions'] = []
            empty_template.write_text(json.dumps(plugin))
            self.release.package(empty_template, publish, output,
                                 'v1.2.3', 'traejiik/jellyfin-tasktimeline',
                                 '<!-- Release notes generated using .github/release.yml -->\n\n## Features\n\n* First release')
            manifest = json.loads((output / 'manifest.json').read_text())
            entry = manifest[0]['versions'][0]
            self.assertEqual('1.2.3.0', entry['version'])
            self.assertEqual('12.2.0.0', entry['targetAbi'])
            self.assertEqual('## Features\n\n* First release', entry['changelog'])
            archive = output / 'tasktimeline_1.2.3.0.zip'
            self.assertEqual(hashlib.md5(archive.read_bytes()).hexdigest(), entry['checksum'])
            self.assertTrue(entry['sourceUrl'].endswith('/v1.2.3/tasktimeline_1.2.3.0.zip'))
            self.assertEqual(json.loads(template)[0]['imageUrl'], manifest[0]['imageUrl'])
            self.assertTrue(manifest[0]['imageUrl'].endswith('/docs/assets/branding/tasktimeline-horizontal.svg'))
            with zipfile.ZipFile(archive) as bundle:
                self.assertEqual({dll, 'meta.json', 'LICENSE.md', 'tasktimeline-horizontal.svg'}, set(bundle.namelist()))
                self.assertEqual((ROOT / 'LICENSE.md').read_bytes(), bundle.read('LICENSE.md'))
                metadata = json.loads(bundle.read('meta.json'))
                self.assertEqual(manifest[0]['guid'], metadata['guid'])
                self.assertEqual(entry['changelog'], metadata['changelog'])
                self.assertEqual('1.2.3.0', metadata['version'])
                self.assertEqual([dll], metadata['assemblies'])
                self.assertEqual('tasktimeline-horizontal.svg', metadata['imagePath'])
                self.assertEqual((ROOT / 'docs/assets/branding/tasktimeline-horizontal.svg').read_bytes(), bundle.read(metadata['imagePath']))
        self.assertEqual(template, (ROOT / 'manifest.json').read_bytes())

    def test_local_install_folder_uses_the_compiled_git_version_and_artwork(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            publish = root / 'publish'
            publish.mkdir()
            dll = 'Jellyfin.Plugin.TaskTimeline.dll'
            (publish / dll).write_bytes(b'local plugin fixture')
            output = root / 'install'
            self.release.local_package(ROOT / 'manifest.json', publish, output, '1.2.3.4', '1.2.3+4.gabcdef.dirty')
            self.assertEqual({dll, 'meta.json', 'LICENSE.md', 'tasktimeline-horizontal.svg'},
                             {item.name for item in output.iterdir()})
            metadata = json.loads((output / 'meta.json').read_text())
            self.assertEqual('1.2.3.4', metadata['version'])
            self.assertIn('1.2.3+4.gabcdef.dirty', metadata['changelog'])
            self.assertEqual('12.2.0.0', metadata['targetAbi'])
            self.assertEqual([dll], metadata['assemblies'])
            self.assertEqual('tasktimeline-horizontal.svg', metadata['imagePath'])
            self.assertEqual((ROOT / 'docs/assets/branding/tasktimeline-horizontal.svg').read_bytes(),
                             (output / metadata['imagePath']).read_bytes())

    def test_describe_versions_include_distance_and_dirty_information(self):
        self.assertEqual(('1.2.3.0', '1.2.3+0.gabcdef'), self.release.parse_describe('v1.2.3-0-gabcdef'))
        self.assertEqual(('1.2.3.7', '1.2.3+7.gabcdef.dirty'),
                         self.release.parse_describe('v1.2.3-7-gabcdef-dirty'))
        for value in ['v1.2-0-gabcdef', 'v1.2.3-beta-2-gabcdef', 'v1.2.3-65535-gabcdef']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.release.parse_describe(value)

    def test_git_version_follows_real_tags_and_unreleased_commits(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                return subprocess.run(['git', '-C', str(root), *args], check=True,
                                      capture_output=True, text=True).stdout.strip()
            git('init', '-b', 'feat/version-fixture')
            git('config', 'user.name', 'Version fixture')
            git('config', 'user.email', 'version@example.invalid')
            git('config', 'commit.gpgsign', 'false')
            source = root / 'source.txt'
            source.write_text('initial')
            git('add', 'source.txt'); git('commit', '-m', 'Add fixture')
            self.assertEqual('0.0.0.1', self.release.dev_version(root)[0])
            git('tag', 'v1.2.3')
            self.assertEqual('1.2.3.0', self.release.dev_version(root)[0])
            source.write_text('next')
            git('commit', '-am', 'Change fixture')
            git('tag', 'v2.0.0-beta')
            version, informational = self.release.dev_version(root)
            self.assertEqual('1.2.3.1', version)
            self.assertIn(git('rev-parse', '--short', 'HEAD'), informational)
            source.write_text('dirty')
            self.assertTrue(self.release.dev_version(root)[1].endswith('.dirty'))
            shallow = root / 'shallow'
            subprocess.run(['git', 'clone', '--depth', '1', root.as_uri(), str(shallow)],
                           check=True, capture_output=True, text=True)
            with self.assertRaisesRegex(ValueError, 'unshallow'):
                self.release.dev_version(shallow)

    def test_source_archive_version_is_explicitly_unknown(self):
        with tempfile.TemporaryDirectory() as temporary:
            self.assertEqual(('0.0.0.0', '0.0.0+unknown'), self.release.dev_version(Path(temporary)))

    def test_sdk_publish_receives_all_version_properties(self):
        with patch.object(self.release.subprocess, 'run') as run:
            self.release.publish_plugin(Path('output'), '1.2.3.4', '1.2.3+4.gabcdef')
            command = run.call_args.args[0]
            for field in ['Version', 'AssemblyVersion', 'FileVersion']:
                self.assertIn(f'-p:{field}=1.2.3.4', command)
            self.assertIn('-p:InformationalVersion=1.2.3+4.gabcdef', command)
            self.assertIn('-p:IncludeSourceRevisionInInformationalVersion=false', command)
            self.assertTrue(run.call_args.kwargs['check'])

    def test_changelog_removes_only_leading_generator_comments(self):
        cases = [
            ('<!-- generated -->\n\n## Fixes\n\n* Keep **Markdown**', '## Fixes\n\n* Keep **Markdown**'),
            ('  <!-- first\ncomment -->\n<!-- second -->\nNotes', 'Notes'),
            ('  Plain notes\n', 'Plain notes'),
            ('```html\n<!-- example -->\n```', '```html\n<!-- example -->\n```'),
            ('<!-- generated -->', ''),
        ]
        for notes, expected in cases:
            with self.subTest(notes=notes):
                self.assertEqual(expected, self.release.format_changelog(notes))

    def test_missing_assembly_does_not_create_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaises(FileNotFoundError):
                self.release.package(ROOT / 'manifest.json', root, root / 'out',
                                     'v1.0.0', 'traejiik/jellyfin-tasktimeline', 'Release')
            self.assertFalse((root / 'out').exists())


if __name__ == '__main__':
    unittest.main()
