import {tryReadEquipmentPower} from "./equipment-damage-runtime.js";
import {readNumericPower} from "./numeric-damage-runtime.js?v=car-return-1";

export function parseDamageRule(profile) {
  if (/^(舰炮规则|艦砲規則|艦炮規則|艦砲ルール)$/.test(
    profile.powerRule.trim()
  )) {
    return { kind: "cannon", underwater: false };
  }

  const equipment = tryReadEquipmentPower(
    profile.powerRule
  );

  if (equipment) {
    return {
      kind: "equipment",
      underwater: false,
      power: equipment.power
    };
  }

  const parsed = readNumericPower(profile.powerRule);

  return {
    kind: parsed.underwater ? "underwater" : "numeric",
    underwater: parsed.underwater,
    power: parsed.power
  };
}
