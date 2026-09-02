#!/usr/bin/env python3
"""Resolve a caller-supplied path without ever handing that string to the OS.

Why this module exists
----------------------
Every Python entry point in this repository takes a path from its command line
-- `cost_counter.py <export-dir>`, `mcp_client.py --args-file ...`,
`installer/install.py`. The usual defence is to check the path and then use it,
but a check is not a transformation: the value that reaches `open()` /
`os.listdir()` / `glob.glob()` is still the caller's own string, so a `..`
segment, a symlink or an absolute path from a caller that did not mean well is
still what the file system acts on. Static analysis says so directly
(SonarCloud `pythonsecurity:S8707`, `pythonsecurity:S2083`), and adding more
boolean guards in front of the call does not change the answer -- taint follows
the data, not the control flow.

`PathStore` inverts the direction. The caller's string never becomes a path
component. It is split into plain names, and each name is used only as an
*equality key* against `os.listdir()` of the directory reached so far; the
component that actually gets joined is the value the listing handed back. Every
path this module returns is therefore assembled from the trusted base plus
names the file system itself reported. `..`, an absolute escape and a foreign
drive letter are not rejected so much as inexpressible: you can only descend
into an entry that is really there.

What the guarantee is, and is not
---------------------------------
`home_store()` -- the default for CLI entry points -- is rooted at the user's
home directory. That keeps a tool from reading system directories, other
drives or another account's files. It deliberately does NOT wall off anything
*inside* the home directory (`~/.ssh` included); a narrower base is the right
call for a tool whose inputs live in one known folder, and `PathStore` takes
any base for exactly that reason.

Symlinks get a second, belt-and-braces check: after each descent the resolved
real path must still sit inside the base, so a symlinked entry cannot walk the
caller out of the store.

What it does NOT close is a time-of-check-to-time-of-use (TOCTOU) window: the
directory listing and the subsequent real-path check are two separate system
calls, so a symlink swapped in between them could be followed before the check
runs. Shutting that window needs kernel support (opening each component with
``O_NOFOLLOW`` / ``openat``) that is not portably reachable from userspace
Python, so a caller defending against a hostile process writing concurrently
into the same base cannot rely on this module alone.
"""
from __future__ import annotations

import os


class PathStoreError(ValueError):
    """Base class: the requested path cannot be served from this store."""


class PathOutsideStore(PathStoreError):
    """The request names something that does not live under the store's base."""


class PathNotInStore(PathStoreError):
    """The request names a path under the base that does not exist there."""


def _key(path: str) -> str:
    """Comparison form of a path: normalized separators, platform-normal case."""
    return os.path.normcase(os.path.normpath(path))


class PathStore:
    """A trusted base directory plus safe resolution of paths beneath it.

    ``base`` is fixed by the program, never by an argument the program was
    called with -- that is the whole point. ``resolve()`` is the only way in.
    """

    def __init__(self, base: str) -> None:
        self._base = os.path.abspath(os.path.expanduser(base))
        # The base itself may sit behind a symlink -- macOS puts temp dirs
        # under /var, which is really /private/var, and a home directory can be
        # linked too. Keep both spellings: either is a legitimate way for a
        # caller to name the store, and the real one is what the escape check
        # below has to compare against.
        self._real_base = os.path.realpath(self._base)

    @property
    def base(self) -> str:
        return self._base

    def resolve(self, requested: str) -> str:
        """The real path ``requested`` names, built only from listed entries.

        Raises ``PathOutsideStore`` when the request points outside the base
        and ``PathNotInStore`` when every component is inside it but some link
        in the chain is not actually on disk. Both carry a message meant for a
        console, naming the base so the caller can see where to move the input.
        """
        current = self._base
        for wanted in self._names_under_base(requested):
            current = self._descend(current, wanted)
        return current

    def _names_under_base(self, requested: str) -> list:
        """The requested path as plain names relative to the base.

        Pure string work -- ``abspath`` collapses ``..`` and anchors a relative
        request on the working directory without touching the file system, so
        nothing here reaches the OS. The names it returns are only ever used as
        equality keys in ``_descend``; they are never joined into a path.
        """
        absolute = os.path.abspath(os.path.expanduser(requested))
        absolute_key = _key(absolute)
        for base in (self._base, self._real_base):
            base_key = _key(base)
            if absolute_key == base_key:
                return []
            if absolute_key.startswith(base_key.rstrip(os.sep) + os.sep):
                # Slice the raw ``absolute`` by ``len(base)`` -- not by the key.
                # Both ``base`` and ``absolute`` are already abspath-normalized,
                # and normcase/normpath preserve length on a normalized path, so
                # ``len(base) == len(base_key)`` always holds. Keep this
                # length-based slice: a key-based alternative would misalign on a
                # case-insensitive volume, where the key and the raw string differ.
                relative = absolute[len(base):]
                return [n for n in relative.replace("\\", "/").split("/") if n not in ("", ".")]
        raise PathOutsideStore(
            f"path is outside the directory this tool may read\n"
            f"    requested : {absolute}\n"
            f"    allowed   : {self._base} (and anything beneath it)\n"
            f"Move the input under that directory, or point the tool at a "
            f"store rooted where the input already lives."
        )

    def _descend(self, current: str, wanted: str) -> str:
        """One step down, taking the path component from the directory listing.

        ``wanted`` is compared, never joined: the component appended to the
        path is ``entry``, which came out of ``os.listdir``. That is what keeps
        a caller-supplied string from ever reaching the file system, and it has
        the happy side effect of returning the real on-disk spelling on a
        case-insensitive volume.
        """
        try:
            entries = os.listdir(current)
        except OSError as exc:
            raise PathNotInStore(
                f"cannot list {current}: {exc.strerror or exc}"
            ) from exc

        entry = next((e for e in entries if e == wanted), None)
        if entry is None:
            # Accept a differently-cased request when exactly one entry folds
            # onto it. This leans on ``os.path.normcase``, which folds case only
            # on Windows (ntpath); on POSIX (macOS, Linux) normcase is a no-op,
            # so this branch matches nothing the exact check above did not. That
            # is deliberate: a case-insensitive *volume* on macOS still reports
            # one canonical spelling from ``os.listdir``, and honouring a
            # foreign-cased request there would need a real inode probe rather
            # than a string fold -- out of scope here. On POSIX a wrong-case
            # request is therefore refused; see the case-fold test in
            # tests/test_path_store.py, which pins both directions.
            folded = [e for e in entries if os.path.normcase(e) == os.path.normcase(wanted)]
            entry = folded[0] if len(folded) == 1 else None
        if entry is None:
            raise PathNotInStore(
                f"no entry named {wanted!r} in {current}"
            )

        stepped = os.path.join(current, entry)
        stepped_key = _key(os.path.realpath(stepped))
        base_key = _key(self._real_base)
        # Compare the way ``_names_under_base`` does: equal to the base, or under
        # it with a separator in between. A bare ``startswith`` would accept a
        # sibling whose name merely starts with the base ("/home/user2" for base
        # "/home/user") and let an escaping symlink through.
        if stepped_key != base_key and not stepped_key.startswith(base_key.rstrip(os.sep) + os.sep):
            # A symlink pointing out of the store: the name was listed, but
            # following it would leave the base after all.
            raise PathOutsideStore(
                f"{stepped} leads outside {self._base} (symbolic link); refusing to follow it"
            )
        return stepped


def home_store() -> PathStore:
    """The default store for CLI entry points: the user's home directory.

    Wide on purpose -- session exports, downloads and checkouts all live
    somewhere under the profile -- while still keeping a tool out of system
    directories, other volumes and other accounts.
    """
    return PathStore(os.path.expanduser("~"))
