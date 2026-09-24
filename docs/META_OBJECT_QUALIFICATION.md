# Inventory meta-object qualification — 2.0.5

The native type IDs, weapon subtype IDs, icon arithmetic and positional Tag
layouts were checked against the read-only StarMade-Open revision
`e5a3b49d86943c4d618cea6512e28fa0b95901df`. The relevant game sources
are `MetaObjectManager`, the eight nonweapon `MetaObject` subclasses, the nine
`weapon` subclasses, `Weapon.getExtraBuildIconIndex()` and
`InventoryIconsNew`. No Java source or binary is copied into this repository.

The mirrored `test/objects/components/MetaObjectDetails.test.ts` suite exercises
every native weapon subtype and all eight other type families, including
versioned recipes. It validates boundary values, partial and wrong-type Tags,
non-finite floats, mod types, unknown subtypes, absent payloads and bounded
logbook text. The real `ENTITY_PLAYERSTATE_InitSysRev.ent` sample supplies
weapons 1–4, helmet, flashlight, logbook and blueprint. The tests compare
payload Tags before and after projection and verify the complete player entity
still serializes byte-for-byte.
The installed `/srv/StarMade/server-database/world0/ENTITY_PLAYERSTATE_InitSysRev.ent`
was also read without modification: its seven special items (weapons 1–4,
helmet, flashlight and logbook) all project as `ready`, and the full entity
rewrites byte-for-byte.

The release gate is `npm run coverage:check`, which enforces 100% lines and
branches per source file with zero skips. `source:check`, `docs:check`,
`test:package` and `test:interop` check publication boundaries, documentation,
the installed package and independent game-format compatibility.
