const STORAGE_KEY = "junqi-battle-state-v1";

export function createBattleStore(units) {
  let instances = [];
  let storageWarning = "";
  const listeners = new Set();

  function getBaseUnit(unitId) {
    return units.find(unit => unit.id === unitId);
  }

  // 現在のブラウザーに保存されたシミュレーションの復元を試みます。
  try {
    const savedText = localStorage.getItem(STORAGE_KEY);

    if (savedText) {
      const saved = JSON.parse(savedText);

      if (!Array.isArray(saved)) {
        throw new Error("保存データは配列ではありません。");
      }

      const seenIds = new Set();

      instances = saved.filter(item => {
        if (
          !item ||
          typeof item.instanceId !== "string" ||
          !item.instanceId ||
          seenIds.has(item.instanceId) ||
          typeof item.unitId !== "string"
        ) {
          return false;
        }

        const base = getBaseUnit(item.unitId);

        if (
          !base ||
          !Number.isFinite(item.currentHp) ||
          item.currentHp < 0 ||
          item.currentHp > base.maxHp
        ) {
          return false;
        }

        seenIds.add(item.instanceId);
        return true;
      }).map(item => ({
        instanceId: item.instanceId,
        unitId: item.unitId,
        currentHp: item.currentHp
      }));
    }
  } catch (error) {
    storageWarning = "ローカルデータの復元に失敗しました、今回は初期状態からシミュレーションを開始します。";
    console.warn(error);
  }

  function getAll() {
    return instances.map(item => ({ ...item }));
  }

  function notify() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(instances));
      storageWarning = "";
    } catch (error) {
      storageWarning =
        "ブラウザーでデータを保存できません。現在は使用できますが、再読み込み後にデータが失われる可能性があります。";
      console.warn(error);
    }

    for (const listener of listeners) {
      listener(getAll());
    }
  }

  function addUnit(unitId) {
    const base = getBaseUnit(unitId);

    if (!base) {
      throw new Error("該当ユニットの図鑑資料が見つかりません。");
    }

    const instance = {
      instanceId: crypto.randomUUID(),
      unitId: base.id,
      currentHp: base.maxHp
    };

    instances.push(instance);
    notify();

    return { ...instance };
  }

  function updateHp(instanceId, currentHp) {
    const instance = instances.find(
      item => item.instanceId === instanceId
    );

    if (!instance) {
      throw new Error("該当する参戦ユニットが見つかりません。");
    }

    const base = getBaseUnit(instance.unitId);

    if (
      !Number.isFinite(currentHp) ||
      currentHp < 0 ||
      currentHp > base.maxHp
    ) {
      throw new Error(`現在耐性は 0 以上 ${base.maxHp} 以下である必要があります。`);
    }

    instance.currentHp = currentHp;
    notify();
  }

  function removeUnit(instanceId) {
    instances = instances.filter(
      item => item.instanceId !== instanceId
    );

    notify();
  }

  function clear() {
    instances = [];
    notify();
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    getAll,
    addUnit,
    updateHp,
    removeUnit,
    clear,
    subscribe,
    getStorageWarning: () => storageWarning
  };
}
