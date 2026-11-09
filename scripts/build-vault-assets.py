"""Build local Armory icons from a supplied Vault Hunters JAR.

Developer-only tool: Python 3, Pillow and NumPy. The running dashboard needs
only Node.js; the generated PNGs and catalog are shipped with the project.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import re
import struct
from pathlib import Path
from zipfile import ZipFile

import numpy as np
from PIL import Image


def key(value):
    return re.sub(r"[^a-z0-9]", "", str(value).split(":")[-1].lower())


def class_strings(data):
    """Read literal strings from the class constant pool, without Java tools."""
    pos = 8
    count = struct.unpack_from(">H", data, pos)[0]
    pos += 2
    pool = [None] * count
    index = 1
    while index < count:
        tag = data[pos]
        pos += 1
        if tag == 1:
            length = struct.unpack_from(">H", data, pos)[0]
            pos += 2
            pool[index] = (tag, data[pos:pos + length].decode("utf-8", "replace"))
            pos += length
        elif tag in (3, 4):
            pos += 4
        elif tag in (5, 6):
            pos += 8
            index += 1
        elif tag in (7, 8, 16, 19, 20):
            pool[index] = (tag, struct.unpack_from(">H", data, pos)[0])
            pos += 2
        elif tag in (9, 10, 11, 12, 17, 18):
            pos += 4
        elif tag == 15:
            pos += 3
        else:
            raise ValueError(f"Unknown constant-pool tag {tag}")
        index += 1
    return [pool[row[1]][1] for row in pool if row and row[0] == 8]


def rotation(axis, degrees):
    angle = math.radians(degrees)
    c, s = math.cos(angle), math.sin(angle)
    if axis == "x":
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=float)
    if axis == "y":
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=float)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=float)


class Assets:
    def __init__(self, jar, output):
        self.jar = jar
        self.names = set(jar.namelist())
        self.output = output
        self.models = {}
        self.textures = {}
        self.failures = []

    def image(self, resource):
        namespace, path = resource.split(":", 1) if ":" in resource else ("minecraft", resource)
        name = f"assets/{namespace}/textures/{path}.png"
        if name not in self.textures:
            image = Image.open(io.BytesIO(self.jar.read(name))).convert("RGBA")
            meta_name = name + ".mcmeta"
            if meta_name in self.names:
                animation = json.loads(self.jar.read(meta_name)).get("animation", {})
                width = animation.get("width", image.width)
                height = animation.get("height", width)
                frame = (animation.get("frames") or [0])[0]
                index = frame.get("index", 0) if isinstance(frame, dict) else frame
                columns = max(1, image.width // width)
                left, top = (index % columns) * width, (index // columns) * height
                image = image.crop((left, top, left + width, top + height))
            self.textures[name] = image
        return self.textures[name].copy()

    def model(self, resource, stack=()):
        if resource in self.models:
            return self.models[resource]
        if resource in stack:
            raise ValueError("Cyclic model parent")
        namespace, path = resource.split(":", 1) if ":" in resource else ("minecraft", resource)
        name = f"assets/{namespace}/models/{path}.json"
        child = json.loads(self.jar.read(name))
        parent_name = child.get("parent")
        parent = {}
        if parent_name:
            parent_resource = parent_name if ":" in parent_name else "minecraft:" + parent_name
            if parent_resource == "minecraft:block/block":
                parent = {"gui_light":"side", "display":{"gui":{"rotation":[30,225,0],"scale":[0.625,0.625,0.625]}}}
            elif parent_resource not in {"minecraft:item/generated", "minecraft:item/handheld", "minecraft:builtin/generated", "minecraft:builtin/entity"}:
                parent = self.model(parent_resource, stack + (resource,))
        combined = {**parent, **child}
        combined["textures"] = {**parent.get("textures", {}), **child.get("textures", {})}
        combined["display"] = {**parent.get("display", {}), **child.get("display", {})}
        self.models[resource] = combined
        return combined

    def texture(self, ref, model):
        seen = set()
        while ref.startswith("#"):
            if ref in seen:
                raise ValueError("Cyclic texture reference")
            seen.add(ref)
            ref = model["textures"][ref[1:]]
        return self.image(ref)

    def flat(self, model):
        layers = sorted((name for name in model.get("textures", {}) if re.fullmatch(r"layer\d+", name)), key=lambda name: int(name[5:]))
        if not layers:
            return None
        images = [self.texture("#" + name, model) for name in layers]
        size = images[0].size
        result = Image.new("RGBA", size)
        for image in images:
            result.alpha_composite(image.resize(size, Image.Resampling.NEAREST))
        return result

    def render(self, model, size=96):
        if not model.get("elements"):
            return self.flat(model)
        gui = model.get("display", {}).get("gui", {})
        angles = gui.get("rotation", [0, 0, 0])
        matrix = rotation("x", angles[0]) @ rotation("y", angles[1]) @ rotation("z", angles[2])
        scale = np.array(gui.get("scale", [1, 1, 1]), dtype=float)
        translation = np.array(gui.get("translation", [0, 0, 0]), dtype=float)
        normals = {"north": [0, 0, -1], "south": [0, 0, 1], "east": [1, 0, 0], "west": [-1, 0, 0], "up": [0, 1, 0], "down": [0, -1, 0]}
        light = np.array([-0.3, 0.65, 0.7])
        light /= np.linalg.norm(light)
        faces = []
        for element in model["elements"]:
            x0, y0, z0 = element["from"]
            x1, y1, z1 = element["to"]
            quads = {
                "north": [[x1,y1,z0],[x0,y1,z0],[x0,y0,z0],[x1,y0,z0]],
                "south": [[x0,y1,z1],[x1,y1,z1],[x1,y0,z1],[x0,y0,z1]],
                "east": [[x1,y1,z1],[x1,y1,z0],[x1,y0,z0],[x1,y0,z1]],
                "west": [[x0,y1,z0],[x0,y1,z1],[x0,y0,z1],[x0,y0,z0]],
                "up": [[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]],
                "down": [[x0,y0,z1],[x1,y0,z1],[x1,y0,z0],[x0,y0,z0]],
            }
            element_rotation = element.get("rotation", {})
            local_matrix = rotation(element_rotation.get("axis", "y"), element_rotation.get("angle", 0))
            origin = np.array(element_rotation.get("origin", [8,8,8]))
            for side, face in element.get("faces", {}).items():
                if side not in quads or "texture" not in face:
                    continue
                vertices = np.array(quads[side], dtype=float)
                vertices = (vertices - origin) @ local_matrix.T
                if element_rotation.get("rescale"):
                    rescale = np.full(3, 1 / max(0.01, math.cos(math.radians(element_rotation.get("angle", 0)))))
                    rescale["xyz".index(element_rotation.get("axis", "y"))] = 1
                    vertices *= rescale
                vertices += origin
                vertices = ((vertices - 8) * scale) @ matrix.T + translation
                uv = face.get("uv", [0,0,16,16])
                coords = np.array([[uv[0],uv[1]],[uv[2],uv[1]],[uv[2],uv[3]],[uv[0],uv[3]]], dtype=float)
                coords = np.roll(coords, -(int(face.get("rotation", 0)) // 90), axis=0)
                normal = matrix @ local_matrix @ np.array(normals[side])
                shade = 1 if model.get("gui_light") == "front" or element.get("shade") is False else 0.65 + 0.35 * max(0, np.dot(normal, light))
                texture = np.asarray(self.texture(face["texture"], model)).copy()
                faces.append((vertices, coords, texture, shade))
        if not faces:
            return None
        extent = max(float(np.abs(vertices[:,:2]).max()) for vertices, *_ in faces)
        fit = min(1, 7.5 / max(extent, 0.01))
        result = np.zeros((size, size, 4), dtype=np.uint8)
        depth = np.full((size, size), -np.inf)
        for vertices, coords, texture, shade in sorted(faces, key=lambda face: face[0][:,2].mean()):
            points = vertices.copy() * fit
            points[:,0] = size / 2 + points[:,0] * size / 16
            points[:,1] = size / 2 - points[:,1] * size / 16
            for indices in [(0,1,2),(0,2,3)]:
                triangle = points[list(indices)]
                uv = coords[list(indices)]
                left, top = np.maximum(np.floor(triangle[:,:2].min(axis=0)).astype(int), 0)
                right, bottom = np.minimum(np.ceil(triangle[:,:2].max(axis=0)).astype(int), size - 1)
                if right < left or bottom < top:
                    continue
                a, b, c = triangle
                denom = (b[1]-c[1])*(a[0]-c[0]) + (c[0]-b[0])*(a[1]-c[1])
                if abs(denom) < 1e-8:
                    continue
                yy, xx = np.mgrid[top:bottom+1,left:right+1]
                px, py = xx + 0.5, yy + 0.5
                wa = ((b[1]-c[1])*(px-c[0]) + (c[0]-b[0])*(py-c[1])) / denom
                wb = ((c[1]-a[1])*(px-c[0]) + (a[0]-c[0])*(py-c[1])) / denom
                wc = 1 - wa - wb
                z = wa*a[2] + wb*b[2] + wc*c[2]
                tx = np.clip(np.floor((wa*uv[0,0]+wb*uv[1,0]+wc*uv[2,0])/16*texture.shape[1]).astype(int), 0, texture.shape[1]-1)
                ty = np.clip(np.floor((wa*uv[0,1]+wb*uv[1,1]+wc*uv[2,1])/16*texture.shape[0]).astype(int), 0, texture.shape[0]-1)
                colors = texture[ty,tx].copy()
                mask = (wa >= -1e-5) & (wb >= -1e-5) & (wc >= -1e-5) & (colors[:,:,3] > 10) & (z >= depth[yy,xx]-1e-5)
                colors[:,:,:3] = np.clip(colors[:,:,:3].astype(float)*shade, 0, 255).astype(np.uint8)
                # Alpha-composite visible transparent decorations and glass.
                foreground = colors[mask].astype(float) / 255
                background = result[yy[mask],xx[mask]].astype(float) / 255
                alpha = foreground[:,3:4] + background[:,3:4]*(1-foreground[:,3:4])
                rgb = (foreground[:,:3]*foreground[:,3:4] + background[:,:3]*background[:,3:4]*(1-foreground[:,3:4])) / np.maximum(alpha, 1e-8)
                result[yy[mask],xx[mask]] = np.clip(np.concatenate([rgb,alpha],axis=1)*255, 0, 255).astype(np.uint8)
                depth[yy[mask],xx[mask]] = z[mask]
        return Image.fromarray(result)

    def save(self, image, relative):
        if image is None or image.getbbox() is None:
            return None
        path = self.output / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path, optimize=True)
        return "/assets/vault/" + relative.as_posix()


# Remastered power IDs paired with the original Prestige illustrations.
# GUI coordinates/styles remain instance config; these aliases only select icons.
PRESTIGE_ICONS = {'ShadowCloakPower': 'the_shadow', 'BountyCooldownReduction': 'no_bounty_cooldown', 'FallImmunity': 'the_elvish', 'AetherSparkTrinket': 'the_spark', 'KineticImmunity': 'no_kinetic_damage', 'Shielded': 'shielded', 'PickupRange': 'magnet_range', 'BlackMarketRerolls': 'blackmarket', 'EnderAnchorPower': 'the_anchor', 'ChainMiner': 'chain_miner', 'NoVoidUses': 'no_voidstone_use', 'CrateTier': 'bountiful_crates', 'ChampionsDamage': 'champion', 'TripleJump': 'triple_jump', 'GluttonyPower': 'the_gluttony', 'SuperCrystals': 'super_crystals', 'NoCharmsUses': 'no_charm_use', 'StepUpPower': 'the_frog', 'CatDodge': 'the_cat', 'TreasureHunterPower': 'treasure', 'RegenerationPower': 'the_petal', 'BlackMarketer': 'black_marketer', 'TemporalShardChance': 'temporal', 'TheCarapace': 'the_carapace', 'NoTrinketUses': 'no_trinket_use', 'CommanderPower': 'commander', 'MovementSpeedMultiplier': 'swiftness_amplified', 'ToolDurabilityPower': 'no_tools_durability', 'OriginalWardPower': 'ward', 'ElytraWings': 'the_wings', 'GearDurabilityPower': 'no_gear_durability', 'Fruity': 'fruity', 'MasterfulPower': 'masterful', 'BerserkPower': 'berserk'}

def build_prestige_icons(jar, output, catalog):
    catalog["prestige"] = {}
    prefix = "assets/the_vault/textures/gui/prestige/"
    for name in sorted(jar.namelist()):
        if name.startswith(prefix) and name.endswith(".png"):
            stem = Path(name).stem
            destination = output / "icons" / "prestige" / (stem + ".png")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(jar.read(name))
            catalog["prestige"][key(stem)] = "/assets/vault/icons/prestige/" + stem + ".png"
    for power, stem in PRESTIGE_ICONS.items():
        if key(stem) in catalog["prestige"]:
            catalog["prestige"][key(power)] = catalog["prestige"][key(stem)]


def build(jar_path, output):
    catalog = {"version": "20.0.3-remastered.6872", "sourceSha256": hashlib.sha256(jar_path.read_bytes()).hexdigest(), "abilities": {}, "skills": {}, "research": {}, "models": {}, "items": {}, "tools": {}, "ui": {}}
    with ZipFile(jar_path) as jar:
        build_prestige_icons(jar, output, catalog)
        assets = Assets(jar, output)
        for group, folder in [("abilities","abilities"),("skills","skills"),("research","researches")]:
            prefix = f"assets/the_vault/textures/gui/{folder}/"
            for name in sorted(assets.names):
                if not name.startswith(prefix) or not name.endswith(".png"):
                    continue
                stem = Path(name).stem
                if stem.startswith(("overlay_", "node_")):
                    continue
                destination = output / "icons" / group / (stem + ".png")
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(jar.read(name))
                catalog[group][key(stem)] = "/assets/vault/icons/" + group + "/" + stem + ".png"
        # Native GUI defaults bind specialization IDs to texture paths.
        for name in sorted(assets.names):
            if not name.startswith("iskallia/vault/config/AbilitiesGUIConfig$") or not name.endswith(".class"):
                continue
            values = class_strings(jar.read(name))
            for index, value in enumerate(values):
                if not value.startswith("gui/abilities/") or index == 0:
                    continue
                url = catalog["abilities"].get(key(value.split("/")[-1]))
                if url and not values[index-1].startswith("gui/"):
                    catalog["abilities"][key(values[index-1])] = url
        # Remastered IDs/display names and the original texture spellings.
        for source, target in {"Empower_Slowness_Aura":"empower_entropy", "Entropic Bind":"empower_entropy", "Mana_Shield_Retribution":"shield_bash_retribution", "Chain_Lightning":"lightning_strike", "Chain_Lightning_Charged_Bolts":"charged_bolts", "Grenade":"chaos_cube"}.items():
            if key(target) in catalog["abilities"]:
                catalog["abilities"][key(source)] = catalog["abilities"][key(target)]
        for source, target in {"Axe_Specialisation":"axe_spec", "Sword_Specialisation":"sword_spec", "Lightning_Stun":"lightning_stunned", "Intelligence_II":"intelligence", "Might_II":"strength"}.items():
            if key(target) in catalog["skills"]:
                catalog["skills"][key(source)] = catalog["skills"][key(target)]
        catalog["research"][key("Potions")] = catalog["research"][key("potion")]
        for name in sorted(assets.names):
            if not name.startswith("assets/the_vault/textures/item/tool/") or not name.endswith("/head.png"):
                continue
            tool_type = name.split("/")[-2]
            handle_name = name.removesuffix("head.png") + "handle.png"
            if handle_name not in assets.names:
                continue
            head = assets.image("the_vault:item/tool/" + tool_type + "/head")
            handle = assets.image("the_vault:item/tool/" + tool_type + "/handle")
            icon = Image.new("RGBA", head.size)
            icon.alpha_composite(handle.resize(head.size, Image.Resampling.NEAREST))
            icon.alpha_composite(head)
            catalog["tools"][key(tool_type)] = assets.save(icon,Path("tools") / (tool_type + ".png"))
        for domain, stem in {"abilities":"tab_icon_abilities", "talents":"tab_icon_talents", "expertise":"tab_icon_expertises", "research":"tab_icon_researches", "prestige":"tab_icon_prestige_powers"}.items():
            name = f"assets/the_vault/textures/gui/screen/{stem}.png"
            if name in assets.names:
                destination = output / "icons" / "ui" / (stem + ".png")
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(jar.read(name))
                catalog["ui"][domain] = "/assets/vault/icons/ui/" + stem + ".png"
        prefix = "assets/the_vault/models/item/"
        model_names = [name for name in sorted(assets.names) if name.startswith(prefix) and name.endswith(".json")]
        for index, name in enumerate(model_names):
            relative = name[len(prefix):-5]
            try:
                resource = "the_vault:item/" + relative
                model = assets.model(resource)
                image = assets.render(model)
                url = assets.save(image, Path("items") / (relative + ".png"))
                if url:
                    catalog["models"]["the_vault:" + relative] = url
                    catalog["models"][resource] = url
                    if "/" not in relative:
                        catalog["items"]["the_vault:" + relative] = url
            except (KeyError, ValueError, TypeError) as error:
                assets.failures.append({"model": relative, "reason": str(error)})
            if index and index % 500 == 0:
                print(json.dumps({"processedModels": index, "totalModels": len(model_names)}), flush=True)
        # Dynamic armor/magnet models often use sprites without a JSON model.
        prefix = "assets/the_vault/textures/item/gear/"
        stems = sorted({name[len(prefix):-4].removesuffix("_overlay") for name in assets.names if name.startswith(prefix) and name.endswith(".png") and not re.search(r"armor_layer[12]", name)})
        for stem in stems:
            model_id = "the_vault:gear/" + stem
            if model_id in catalog["models"]:
                continue
            base, overlay = prefix + stem + ".png", prefix + stem + "_overlay.png"
            images = [assets.image("the_vault:item/gear/" + stem + suffix) for suffix, name in [("", base),("_overlay",overlay)] if name in assets.names]
            # A large UV atlas is not a finished inventory icon.
            if not images or any(image.width > 32 or image.height > 32 for image in images):
                continue
            result = Image.new("RGBA", images[0].size)
            for image in images:
                result.alpha_composite(image.resize(result.size, Image.Resampling.NEAREST))
            url = assets.save(result, Path("sprites") / (stem + ".png"))
            if url:
                catalog["models"][model_id] = url
        (output / "catalog.js").write_text("window.VH_ASSET_CATALOG = " + json.dumps(catalog, separators=(",",":")) + ";\n")
        report = {"sourceJar": jar_path.name, "sourceSha256": catalog["sourceSha256"], "counts": {name: len(catalog[name]) for name in ["abilities","skills","research","prestige","models","items","tools","ui"]}, "unrenderedModels": assets.failures}
        (output / "build-report.json").write_text(json.dumps(report, indent=2))
        (output / "README.txt").write_text("Original icons, textures and models from Vault Hunters Third Edition Remastered 20.0.3.\nCredits remain with the mod's authors.\nThe Armory ships local icons and inventory thumbnails generated from those resources.\n3D thumbnails use the JSON model, textures and GUI transform; game shaders and enchantment effects are not simulated.\nRegenerate with scripts/build-vault-assets.py and the original supplied JAR.\n")
        print(json.dumps({"done": True, "counts": report["counts"], "unrenderedModels": len(assets.failures)}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("jar", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent.parent / "public/assets/vault")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    build(args.jar, args.output)
