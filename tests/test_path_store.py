"""Contract tests for `runtime/path_store.py`.

The point of the module is not "rejects bad input" -- it is that a returned
path is assembled from the trusted base plus names the file system reported,
so the caller's own string never becomes a path component. The first two tests
pin exactly that invariant (it is what static analysis is asking for, and the
first thing a well-meaning refactor would lose); the rest pin the behaviour a
console user sees.
"""
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime.path_store import (  # noqa: E402
    PathNotInStore,
    PathOutsideStore,
    PathStore,
    home_store,
)


def _key(path):
    return os.path.normcase(os.path.normpath(path))


class PathStoreTest(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="path-store-")
        self.addCleanup(shutil.rmtree, self.base, True)
        self.store = PathStore(self.base)
        os.makedirs(os.path.join(self.base, "exports", "run-1"))

    def test_the_listing_is_the_authority_not_the_request(self):
        # `exports/` really is on disk, so a resolver that used the requested
        # string as a path component would return it happily. This one cannot:
        # with the listing reporting nothing, there is no entry to descend into
        # and no component to join. That asymmetry is the whole guarantee.
        with patch("runtime.path_store.os.listdir", return_value=[]):
            with self.assertRaises(PathNotInStore):
                self.store.resolve(os.path.join(self.base, "exports"))

    def test_the_joined_component_is_the_listed_entry(self):
        seen = []
        real_listdir = os.listdir

        def recording_listdir(path):
            entries = real_listdir(path)
            seen.append((path, list(entries)))
            return entries

        with patch("runtime.path_store.os.listdir", side_effect=recording_listdir):
            resolved = self.store.resolve(os.path.join(self.base, "exports", "run-1"))

        # One listing per level, and each level's chosen component is a name
        # that listing reported.
        self.assertEqual([_key(path) for path, _ in seen],
                         [_key(self.base), _key(os.path.join(self.base, "exports"))])
        self.assertIn("exports", seen[0][1])
        self.assertIn("run-1", seen[1][1])
        self.assertEqual(_key(resolved), _key(os.path.join(self.base, "exports", "run-1")))

    def test_absolute_path_under_the_base_resolves(self):
        wanted = os.path.join(self.base, "exports", "run-1")
        self.assertEqual(_key(self.store.resolve(wanted)), _key(wanted))

    def test_relative_path_resolves_against_the_working_directory(self):
        previous = os.getcwd()
        os.chdir(self.base)
        try:
            self.assertEqual(
                _key(self.store.resolve(os.path.join("exports", "run-1"))),
                _key(os.path.join(self.base, "exports", "run-1")),
            )
        finally:
            os.chdir(previous)

    def test_the_base_itself_resolves_to_the_base(self):
        self.assertEqual(_key(self.store.resolve(self.base)), _key(self.base))

    def test_parent_traversal_is_refused(self):
        with self.assertRaises(PathOutsideStore):
            self.store.resolve(os.path.join(self.base, "exports", "..", "..", "elsewhere"))

    def test_a_path_outside_the_base_is_refused(self):
        outside = tempfile.mkdtemp(prefix="path-store-outside-")
        self.addCleanup(shutil.rmtree, outside, True)
        with self.assertRaises(PathOutsideStore) as caught:
            self.store.resolve(outside)
        # The message has to tell a console user where the input may live.
        self.assertIn(self.base, str(caught.exception))

    def test_a_missing_entry_is_refused_as_not_in_the_store(self):
        with self.assertRaises(PathNotInStore):
            self.store.resolve(os.path.join(self.base, "exports", "no-such-run"))

    def test_a_file_in_the_middle_of_the_chain_is_refused(self):
        with open(os.path.join(self.base, "a-file"), "w", encoding="utf-8") as handle:
            handle.write("x")
        with self.assertRaises(PathNotInStore):
            self.store.resolve(os.path.join(self.base, "a-file", "deeper"))

    def test_a_symlink_out_of_the_base_is_not_followed(self):
        outside = tempfile.mkdtemp(prefix="path-store-linked-")
        self.addCleanup(shutil.rmtree, outside, True)
        link = os.path.join(self.base, "escape")
        try:
            os.symlink(outside, link, target_is_directory=True)
        except (OSError, AttributeError, NotImplementedError) as exc:
            self.skipTest(f"cannot create a directory symlink here: {exc}")
        # The name IS in the listing, so the descent accepts it; only the
        # real-path check catches where it actually leads.
        with self.assertRaises(PathOutsideStore):
            self.store.resolve(link)

    def test_home_store_is_rooted_at_the_home_directory(self):
        self.assertEqual(_key(home_store().base), _key(os.path.expanduser("~")))


if __name__ == "__main__":
    unittest.main()
