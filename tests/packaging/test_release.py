import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
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
            self.release.package(ROOT / 'manifest.json', publish, output,
                                 'v1.2.3', 'traejiik/jellyfin-tasktimeline', 'First release')
            manifest = json.loads((output / 'manifest.json').read_text())
            entry = manifest[0]['versions'][0]
            self.assertEqual('1.2.3.0', entry['version'])
            self.assertEqual('12.2.0.0', entry['targetAbi'])
            archive = output / 'tasktimeline_1.2.3.0.zip'
            self.assertEqual(hashlib.md5(archive.read_bytes()).hexdigest(), entry['checksum'])
            self.assertTrue(entry['sourceUrl'].endswith('/v1.2.3/tasktimeline_1.2.3.0.zip'))
            self.assertEqual(json.loads(template)[0]['imageUrl'], manifest[0]['imageUrl'])
            with zipfile.ZipFile(archive) as bundle:
                self.assertEqual({dll, 'meta.json'}, set(bundle.namelist()))
                metadata = json.loads(bundle.read('meta.json'))
                self.assertEqual(manifest[0]['guid'], metadata['guid'])
                self.assertEqual('1.2.3.0', metadata['version'])
                self.assertEqual([dll], metadata['assemblies'])
        self.assertEqual(template, (ROOT / 'manifest.json').read_bytes())

    def test_missing_assembly_does_not_create_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaises(FileNotFoundError):
                self.release.package(ROOT / 'manifest.json', root, root / 'out',
                                     'v1.0.0', 'traejiik/jellyfin-tasktimeline', 'Release')
            self.assertFalse((root / 'out').exists())


if __name__ == '__main__':
    unittest.main()
