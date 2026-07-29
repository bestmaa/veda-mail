# Open-source distribution and network use

Veda Mail is licensed under GNU AGPL-3.0-or-later. This page is a practical
project guide, not legal advice; the [LICENSE](../LICENSE) controls.

## Permissions

Subject to the license, you may:

- Run Veda Mail privately or publicly
- Use it commercially
- Study and modify the source
- Redistribute original or modified copies
- White-label your own deployed organization interface

## Source obligations

Preserve applicable copyright and license notices. When you convey copies,
provide the corresponding source and license information as required by the
GNU AGPL.

Section 13 also applies to modified versions used over a network: users
interacting with the modified program must be offered an opportunity to receive
the corresponding source for the version actually running.

The setup/admin **public repository URL** supports that notice:

- An unmodified official deployment may link to
  `https://github.com/bestmaa/veda-mail`.
- A modified network deployment should link to a public source location that
  contains the corresponding modified source, build/install information, and
  license notices.
- Do not point only to upstream when the running service contains your own
  changes that are part of the corresponding source.

Do not use branding settings to hide or misrepresent applicable source and
license information.

## Trademarks

The GNU AGPL licenses code, not the Veda Mail or Veda Concepts marks. Operators
may configure their own organization/product identity in a deployment. Public
modified distributions must avoid confusing users about their source or
official status. See [TRADEMARKS.md](../TRADEMARKS.md).

## Third-party components

Dependencies keep their own copyright and license terms. Review the production
dependency tree and preserve notices required by those licenses when
redistributing images or bundles.

The default Compose topology references an official ClamAV image as a separate
GPL-2.0 sidecar. Preserve its notices and provide the corresponding ClamAV
source when distribution rules require it. Veda Mail's `file-type` dependency
is MIT-licensed. Exact versions and integrity data remain locked in
`package-lock.json` and `compose.yaml`.
