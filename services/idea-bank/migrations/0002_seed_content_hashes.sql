-- Keep bundled starter ideas in the same canonical-hash scheme as community submissions.
-- This lets a shared or auto-shared starter idea increment its existing signal count,
-- rather than creating a second entry with identical title/summary/category.
UPDATE ideas SET content_hash = '400db2a62f4ff38800abb3078815c92207584c453f5a42e796d3f3d7545149c5'
WHERE id = 'seed-accessibility-audit' AND content_hash = 'seed-accessibility-audit-v1';

UPDATE ideas SET content_hash = '24039c91c589afce843219abc060e764342c3236ffd071978807ce13a2c3db79'
WHERE id = 'seed-open-source-revival' AND content_hash = 'seed-open-source-revival-v1';

UPDATE ideas SET content_hash = '97e8a1449e6b11df6205189b51d6118e0eccf5e026d515037cadde71c6727a8a'
WHERE id = 'seed-game-localization' AND content_hash = 'seed-game-localization-v1';

UPDATE ideas SET content_hash = '542e090c76c95c9bffb7b678b04c191c62c36c01df3091d16b61ef1212ed4eb5'
WHERE id = 'seed-docs-navigator' AND content_hash = 'seed-docs-navigator-v1';

UPDATE ideas SET content_hash = '2f81918bbc93131618f6eb69f2605573307d2c7f08cfe28a4993871a8c834d5b'
WHERE id = 'seed-science-reproducibility' AND content_hash = 'seed-science-reproducibility-v1';

UPDATE ideas SET content_hash = '1e185a8faa7f0fff37f480ee42f94114d1c48315e7393b34d362785bdaf947fb'
WHERE id = 'seed-local-energy' AND content_hash = 'seed-local-energy-v1';

UPDATE ideas SET content_hash = '15073ee4c4a8e0833a0a581367b6c661310e17e144a540ea8d9a5ca23074824b'
WHERE id = 'seed-note-garden' AND content_hash = 'seed-note-garden-v1';

UPDATE ideas SET content_hash = '37442437d035d1615478703b80108c0399de0b98ceb466d2e6755b36c791affb'
WHERE id = 'seed-agent-audit' AND content_hash = 'seed-agent-audit-v1';
