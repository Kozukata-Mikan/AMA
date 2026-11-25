import {readWeaponProfile, readWeaponTargetScope} from "./weapon-profile-runtime.js?v=settlement-audit-1";
import {getMaximumCannonHitCredits} from "./cannon-damage-runtime.js?v=air-training-1";
import {resolveNumericDamage} from "./numeric-damage-runtime.js";
import {parseDamageRule} from "./weapon-damage-rule.js";

export function maximumHullDamage(profile) {
  const rule = parseDamageRule(profile);
  if (rule.kind === "equipment") return 0;

  const inertial = profile.guidance === "inertial";
  if (rule.kind === "cannon") {
    const credits = getMaximumCannonHitCredits(profile.penetration, inertial ? "F" : "F--");
    // Cannon credits retain partial damage between attacks (three credits per HP).
    return credits * profile.fullAmmoCost / 3;
  }
  return resolveNumericDamage({
    powerRule: profile.powerRule,
    hitCount: profile.fullAmmoCost,
    penetration: profile.penetration,
    armor: "F--",
    inertial,
    strength: 0,
    strengthRemaining: 0
  }).hpDamage;
}

/** Pick a range without probing targets, running combat simulation or rolling dice. */
export function getAutonomousEngagementRange(unit, turnNumber, damageByProfile) {
  const equipmentById = new Map(unit.snapshot.equipmentSnapshots.map(item => [item.id, item]));
  let bestDamage = 0;
  let bestRange = null;

  for (const group of unit.equipmentState.groups) {
    if (group.damaged || group.destroyed || group.lastUsedTurn >= turnNumber || group.remainingAmmo <= 0) continue;
    const equipment = equipmentById.get(group.equipmentId);
    if (equipment?.kind !== "weapon") continue;

    const profile = readWeaponProfile(equipment, group);
    if (profile.issues.length || profile.large || profile.range <= 0 || group.remainingAmmo < profile.fullAmmoCost) continue;

    // Cache only equipment characteristics during this movement pass. Live ammo,
    // damage and use are checked per group before consulting the cache.
    const key = JSON.stringify([
      profile.powerRule, profile.penetration, profile.guidance,
      profile.fullAmmoCost, profile.targetScope
    ]);
    if (!damageByProfile.has(key)) {
      let damage = 0;
      try {
        readWeaponTargetScope(profile.targetScope);
        damage = maximumHullDamage(profile);
      } catch {
        // A weapon with no supported damage estimate cannot guide movement.
        // Formal attack validation handles unsupported rules as before.
      }
      damageByProfile.set(key, damage);
    }
    const damage = damageByProfile.get(key);
    if (damage > bestDamage || (damage > 0 && damage === bestDamage && profile.range > bestRange)) {
      bestDamage = damage;
      bestRange = profile.range;
    }
  }

  return bestRange === null ? null : bestRange / 2;
}
