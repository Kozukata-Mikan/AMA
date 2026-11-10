import {
  ensureUnitCombatRuntime
} from "./equipment-runtime.js";

export function createAmmoRegistrationFeatures(getState, commit) {
  function registerMissingAmmo(request, expectedRevision) {
    const state = getState();

    if (expectedRevision !== state.revision) {
      throw new Error("状態が変更されています。再度保存してください。");
    }

    if (
      !request ||
      typeof request.equipmentId !== "string" ||
      !request.equipmentId.trim() ||
      typeof request.unitId !== "string" ||
      !Number.isSafeInteger(request.ammo) ||
      request.ammo < 0 ||
      typeof request.note !== "string" ||
      !request.note.trim()
    ) {
      throw new Error(
        "装備ID、0以上の整数の弾数、登録根拠を入力してください。"
      );
    }

    const equipmentId = request.equipmentId.trim();
    const unitId = request.unitId.trim();
    const ammo = request.ammo;
    const note = request.note.trim();

    if (note.length > 500) {
      throw new Error("登録根拠は500文字以内にしてください。");
    }

    commit(candidate => {
      if (
        !["start", "movement", "pas"].includes(candidate.turn.phaseId) &&
        !/^order-[1-5]$/.test(candidate.turn.phaseId)
      ) {
        throw new Error("この段階では弾薬資料を補完できません。");
      }

      if (candidate.attackRuntime.commands.length !== 0) {
        throw new Error(
          "攻撃計画を取り消してから弾薬資料を補完してください。"
        );
      }

      const targets = [];

      for (const unit of candidate.instances) {
        if (unitId && unit.instanceId !== unitId) continue;

        ensureUnitCombatRuntime(unit);

        const source = unit.snapshot.equipmentSnapshots.find(
          item => item.id === equipmentId
        );

        if (!source || source.kind !== "weapon") continue;

        // 本入口只补缺失值，不重设已有初始弹药。
        if (source.ammo !== null && source.ammo !== undefined) {
          continue;
        }

        for (const group of unit.equipmentState.groups) {
          if (group.equipmentId !== equipmentId) continue;
          if (group.ammoRegistration !== undefined) continue;

          if (
            group.initialAmmo !== null ||
            group.remainingAmmo !== null ||
            group.lastUsedTurn !== null
          ) {
            throw new Error(
              "使用済み、または既存弾薬のある装備は補完できません。" +
              "過去の消費弾数は推測しません。"
            );
          }

          targets.push({ unit, group });
        }
      }

      if (targets.length === 0) {
        throw new Error(
          "指定範囲に補完可能な未登録の武器装備がありません。"
        );
      }

      // 全対象の検査完了後に候補副本だけを更新。
      const registeredAt = new Date().toISOString();

      for (const { group } of targets) {
        group.ammoRegistration = {
          version: 1,
          ammo,
          turnNumber: candidate.turn.number,
          phaseId: candidate.turn.phaseId,
          revisionBefore: candidate.revision,
          registeredAt,
          note
        };

        group.remainingAmmo = ammo;
      }

      for (const unit of new Set(targets.map(item => item.unit))) {
        ensureUnitCombatRuntime(unit);
      }
    });

    // 外方装備の件数・性能・残弾は返さない。
    return {
      revision: getState().revision,
      message: "指定範囲の未登録弾薬資料を保存しました。"
    };
  }

  function mountPanel() {
    const previous = document.getElementById(
      "simulation-ammo-registration"
    );

    previous?.remove();

    const panel = document.createElement("details");
    panel.id = "simulation-ammo-registration";
    panel.style.cssText = [
      "position:fixed",
      "right:12px",
      "bottom:12px",
      "z-index:10000",
      "max-width:360px",
      "max-height:75vh",
      "overflow:auto",
      "padding:12px",
      "background:#fff",
      "color:#222",
      "border:1px solid #888",
      "border-radius:8px",
      "box-shadow:0 3px 14px #0003"
    ].join(";");

    const summary = document.createElement("summary");
    summary.textContent = "管理設定：未登録弾薬の補完";
    panel.append(summary);

    const description = document.createElement("p");
    description.textContent =
      "戦役資料に基づく初期予備弾数を登録します。" +
      "補給や既存残弾の変更には使えません。" +
      "弾数は装備組ごとの値です。";
    panel.append(description);

    const form = document.createElement("form");
    panel.append(form);

    function field(title, type, required) {
      const label = document.createElement("label");
      label.style.cssText = "display:block;margin:10px 0;";

      const caption = document.createElement("span");
      caption.textContent = title;
      label.append(caption);

      const input = document.createElement("input");
      input.type = type;
      input.required = required;
      input.style.cssText =
        "display:block;box-sizing:border-box;width:100%;margin-top:4px;";

      label.append(input);
      form.append(label);
      return input;
    }

    const equipment = field("装備ID", "text", true);
    const unit = field(
      "ユニットのインスタンスID（空欄：全陣営）",
      "text",
      false
    );
    const ammo = field("各装備組の初期予備弾数", "number", true);
    ammo.min = "0";
    ammo.step = "1";

    const note = field("登録根拠・戦役資料", "text", true);
    note.maxLength = 500;

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "確認して保存";
    form.append(submit);

    const output = document.createElement("p");
    output.setAttribute("role", "status");
    output.style.whiteSpace = "pre-wrap";
    panel.append(output);

    form.addEventListener("submit", event => {
      event.preventDefault();

      const value = ammo.value.trim();

      if (!/^\d+$/.test(value)) {
        output.textContent = "弾数は0以上の整数で入力してください。";
        return;
      }

      const number = Number(value);

      if (!Number.isSafeInteger(number)) {
        output.textContent = "弾数が入力可能な範囲を超えています。";
        return;
      }

      const approved = window.confirm(
        `装備ID：${equipment.value.trim()}\n` +
        `対象：${unit.value.trim() || "全陣営の該当装備"}\n` +
        `各組の初期予備弾数：${number}\n\n` +
        "これは戦役資料の補完です。補給ではありません。\n" +
        "登録済みの値はこの画面では変更できません。\n" +
        "保存しますか？"
      );

      if (!approved) return;

      submit.disabled = true;

      try {
        const receipt = registerMissingAmmo({
          equipmentId: equipment.value,
          unitId: unit.value,
          ammo: number,
          note: note.value
        }, getState().revision);

        output.textContent = receipt.message;
      } catch (error) {
        console.error(error);
        output.textContent =
          "保存できませんでした。\n" + error.message;
      } finally {
        submit.disabled = false;
      }
    });

    document.body.append(panel);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        mountPanel,
        { once: true }
      );
    } else {
      queueMicrotask(mountPanel);
    }
  }

  return { registerMissingAmmo };
}
