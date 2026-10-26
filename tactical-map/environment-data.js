// ===== 场景环境数据 =====
// 时间为沙盘时间，不跟随电脑时钟，也不自动推进。

export const WEATHER_GROUPS = [
  {
    level: "white",
    label: "白色天候",
    color: "#f1f5f9",
    options: [
      ["clear", "晴れ"]
    ]
  },
  {
    level: "blue",
    label: "青色天候",
    color: "#70b7ff",
    options: [
      ["cloudy", "曇り"],
      ["light-rain", "小雨"],
      ["light-snow", "小雪"]
    ]
  },
  {
    level: "yellow",
    label: "黄色天候",
    color: "#f6d65b",
    options: [
      ["fog", "霧"],
      ["thunderstorm", "雷雨"],
      ["heavy-rain", "大雨"],
      ["heavy-snow", "大雪"],
      ["high-temperature", "高温"],
      ["icing", "結氷"]
    ]
  },
  {
    level: "orange",
    label: "橙色天候",
    color: "#ffa15c",
    options: [
      ["dense-fog", "濃霧"],
      ["torrential-rain", "暴雨"],
      ["blizzard", "暴雪"],
      ["sea-tide", "海潮"]
    ]
  },
  {
    level: "red",
    label: "赤色天候",
    color: "#ff7070",
    options: [
      ["typhoon", "台風"]
    ]
  }
];

const WEATHER_BY_ID = new Map();

for (const group of WEATHER_GROUPS) {
  for (const [id, label] of group.options) {
    WEATHER_BY_ID.set(id, {
      id,
      label,
      level: group.level,
      levelLabel: group.label,
      color: group.color
    });
  }
}

export function createDefaultEnvironment() {
  return {
    time: "12:00",
    weather: "clear"
  };
}

export function normalizeEnvironment(value) {
  // 旧存档没有环境字段时，补充默认环境。
  if (value === undefined) {
    return createDefaultEnvironment();
  }

  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("環境設定の書式が不正です。");
  }

  const time = value.time;
  const weather = value.weather;

  if (
    typeof time !== "string" ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
  ) {
    throw new Error("時刻は 00:00～23:59 の形式で指定してください。");
  }

  if (
    typeof weather !== "string" ||
    !WEATHER_BY_ID.has(weather)
  ) {
    throw new Error("対応していない天候です。");
  }

  return { time, weather };
}

export function getTimePeriod(time) {
  // 调用同一校验逻辑，避免非法时刻被错误归类。
  normalizeEnvironment({ time, weather: "clear" });

  const [hour, minute] = time.split(":").map(Number);
  const minutes = hour * 60 + minute;

  if (minutes >= 240 && minutes <= 329) {
    return { id: "dawn", label: "黎明" };
  }

  if (minutes >= 330 && minutes <= 1140) {
    return { id: "day", label: "白昼" };
  }

  if (minutes >= 1141 && minutes <= 1230) {
    return { id: "dusk", label: "黄昏" };
  }

  return { id: "night", label: "黒夜" };
}

export function getWeatherInfo(weatherId) {
  const result = WEATHER_BY_ID.get(weatherId);

  if (!result) {
    throw new Error("対応していない天候です。");
  }

  return { ...result };
}
