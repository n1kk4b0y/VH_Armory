const nbt = require("prismarine-nbt");

/**
 * Lê NBT do Minecraft.
 *
 * prismarine-nbt 2.x já aceita NBT comprimido com GZIP, então não precisamos
 * descompactar playerdata/*.dat manualmente.
 */
async function parse(buffer) {
  if (!buffer || !buffer.length) return null;

  // A API Promise retorna { parsed, type, metadata }.
  // A API callback retorna diretamente o compound NBT, o que é diferente.
  const result = await nbt.parse(buffer);
  const parsed = result?.parsed ?? result;

  if (!parsed) {
    throw new Error("O parser NBT não retornou dados válidos.");
  }

  return nbt.simplify(parsed);
}

function walk(value, visitor, path = []) {
  visitor(value, path);
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, visitor, path.concat(i)));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      walk(child, visitor, path.concat(key));
    }
  }
}

function findAll(value, predicate) {
  const hits = [];
  walk(value, (node, path) => {
    if (predicate(node, path)) hits.push({ node, path });
  });
  return hits;
}

module.exports = { parse, walk, findAll };
