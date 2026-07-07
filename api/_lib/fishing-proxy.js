"use strict";

const SHORT_FORECAST_ENDPOINT = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst";
const MID_LAND_FORECAST_ENDPOINT = "https://apis.data.go.kr/1360000/MidFcstInfoService/getMidLandFcst";
const MID_TEMPERATURE_ENDPOINT = "https://apis.data.go.kr/1360000/MidFcstInfoService/getMidTa";
const RISE_SET_ENDPOINT = "https://apis.data.go.kr/B090041/openapi/service/RiseSetInfoService/getAreaRiseSetInfo";
const NAVER_GEOCODE_ENDPOINT = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";
const NAVER_STATIC_MAP_ENDPOINT = "https://maps.apigw.ntruss.com/map-static/v2/raster";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const LOCATION_PRESETS = [
  {
    id: "seoul",
    label: "서울",
    keywords: ["서울", "잠실", "한강", "여의도", "노량진"],
    latitude: 37.5665,
    longitude: 126.978,
    riseSetLocation: "서울",
    midLandRegId: "11B00000",
    midTempRegId: "11B10101"
  },
  {
    id: "taean",
    label: "태안",
    keywords: ["태안", "구매항", "안면도", "신진도", "만리포", "몽산포", "백사장", "서산", "보령"],
    latitude: 36.7457,
    longitude: 126.2982,
    riseSetLocation: "태안",
    midLandRegId: "11C20000",
    midTempRegId: "11C20401"
  }
];

function sendJson(response, statusCode, payload, extraHeaders) {
  if (extraHeaders) {
    Object.entries(extraHeaders).forEach(([key, value]) => {
      response.setHeader(key, value);
    });
  }

  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function readServiceKey() {
  return String(
    process.env.WEATHER_API_SERVICE_KEY
    || process.env.PUBLIC_DATA_SERVICE_KEY
    || process.env.DATA_GO_KR_SERVICE_KEY
    || ""
  ).trim();
}

function readNaverCredentials() {
  return {
    clientId: String(process.env.NAVER_MAPS_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.NAVER_MAPS_CLIENT_SECRET || "").trim()
  };
}

async function fetchJson(url, options) {
  const response = await fetchWithTimeout(url, options);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`외부 API 요청 실패 (${response.status})`);
  }

  return payload;
}

async function fetchText(url, options) {
  const response = await fetchWithTimeout(url, options);
  const payload = await response.text();

  if (!response.ok) {
    throw new Error(`외부 API 요청 실패 (${response.status})`);
  }

  return payload;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function buildUrl(baseUrl, params) {
  const url = new URL(baseUrl);

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

function findLocationPreset(locationName) {
  const normalized = String(locationName || "").trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  return LOCATION_PRESETS.find((preset) => (
    preset.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))
  )) || null;
}

function findNearestPreset(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const matches = LOCATION_PRESETS
    .map((preset) => ({
      preset,
      distance: calculateDistanceKm(latitude, longitude, preset.latitude, preset.longitude)
    }))
    .sort((left, right) => left.distance - right.distance);

  return matches[0]?.distance <= 140 ? matches[0].preset : null;
}

async function resolveLocation(options) {
  const locationName = String(options.locationName || "").trim();
  const preset = findLocationPreset(locationName);
  const directLatitude = toNullableNumber(options.lat);
  const directLongitude = toNullableNumber(options.lng);

  let latitude = directLatitude;
  let longitude = directLongitude;
  let resolutionMode = Number.isFinite(directLatitude) && Number.isFinite(directLongitude)
    ? "client-coordinates"
    : "unresolved";

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    const geocoded = await geocodeWithNaver(locationName);

    if (geocoded) {
      latitude = geocoded.latitude;
      longitude = geocoded.longitude;
      resolutionMode = "naver-geocode";
    }
  }

  if ((!Number.isFinite(latitude) || !Number.isFinite(longitude)) && preset) {
    latitude = preset.latitude;
    longitude = preset.longitude;
    resolutionMode = "keyword-preset";
  }

  const nearestPreset = preset || findNearestPreset(latitude, longitude);
  const grid = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? convertLatLngToGrid(latitude, longitude)
    : null;

  return {
    label: nearestPreset?.label || simplifyLocationName(locationName),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    nx: grid?.nx ?? null,
    ny: grid?.ny ?? null,
    riseSetLocation: nearestPreset?.riseSetLocation || simplifyLocationName(locationName),
    midLandRegId: nearestPreset?.midLandRegId || null,
    midTempRegId: nearestPreset?.midTempRegId || null,
    matchedPresetId: nearestPreset?.id || null,
    resolutionMode
  };
}

async function geocodeWithNaver(query) {
  const credentials = readNaverCredentials();

  if (!credentials.clientId || !credentials.clientSecret || !query) {
    return null;
  }

  const url = buildUrl(NAVER_GEOCODE_ENDPOINT, { query });
  const payload = await fetchJson(url, {
    headers: {
      Accept: "application/json",
      "x-ncp-apigw-api-key-id": credentials.clientId,
      "x-ncp-apigw-api-key": credentials.clientSecret
    }
  });

  const firstAddress = Array.isArray(payload.addresses) ? payload.addresses[0] : null;
  const latitude = toNullableNumber(firstAddress?.y);
  const longitude = toNullableNumber(firstAddress?.x);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
    roadAddress: String(firstAddress?.roadAddress || ""),
    jibunAddress: String(firstAddress?.jibunAddress || "")
  };
}

async function fetchShortTermForecast(context) {
  if (!Number.isFinite(context.resolvedLocation.nx) || !Number.isFinite(context.resolvedLocation.ny)) {
    return null;
  }

  const baseDateTime = getShortTermBaseDateTime();
  const url = buildUrl(SHORT_FORECAST_ENDPOINT, {
    serviceKey: context.serviceKey,
    pageNo: 1,
    numOfRows: 1000,
    dataType: "JSON",
    base_date: baseDateTime.baseDate,
    base_time: baseDateTime.baseTime,
    nx: context.resolvedLocation.nx,
    ny: context.resolvedLocation.ny
  });

  const payload = await fetchJson(url);
  const items = payload?.response?.body?.items?.item;

  if (!Array.isArray(items) || !items.length) {
    return null;
  }

  const slot = pickShortForecastSlot(items, context.targetDate, context.targetTime);

  if (!slot) {
    return null;
  }

  const minTemperature = getDailyForecastValue(items, context.targetDate, "TMN");
  const maxTemperature = getDailyForecastValue(items, context.targetDate, "TMX");
  const skyCode = toNullableNumber(slot.SKY);
  const ptyCode = toNullableNumber(slot.PTY);
  const windDegree = toNullableNumber(slot.VEC);
  const windSpeed = toNullableNumber(slot.WSD);

  return {
    source: "short-term",
    sourceLabel: "단기예보 API",
    temperature: toNullableNumber(slot.TMP),
    minTemperature,
    maxTemperature,
    condition: mapSkyCondition(skyCode, ptyCode),
    precipitationProbability: toNullableNumber(slot.POP),
    windSpeed,
    windDirection: toKoreanDirection(windDegree),
    humidity: toNullableNumber(slot.REH),
    description: `${baseDateTime.baseDate} ${formatClock(baseDateTime.baseTime)} 발표 단기예보 기준입니다.`,
    notes: [],
    usesEstimatedWind: false
  };
}

async function fetchMidTermForecast(context) {
  if (!context.resolvedLocation.midLandRegId || !context.resolvedLocation.midTempRegId) {
    return null;
  }

  const issueTime = getMidTermIssueTime();
  const dayOffset = getDayOffset(context.targetDate, issueTime.baseDate);

  if (dayOffset < 4 || dayOffset > 10) {
    return null;
  }

  const [landPayload, temperaturePayload] = await Promise.all([
    fetchJson(buildUrl(MID_LAND_FORECAST_ENDPOINT, {
      serviceKey: context.serviceKey,
      pageNo: 1,
      numOfRows: 10,
      dataType: "JSON",
      regId: context.resolvedLocation.midLandRegId,
      tmFc: issueTime.tmFc
    })),
    fetchJson(buildUrl(MID_TEMPERATURE_ENDPOINT, {
      serviceKey: context.serviceKey,
      pageNo: 1,
      numOfRows: 10,
      dataType: "JSON",
      regId: context.resolvedLocation.midTempRegId,
      tmFc: issueTime.tmFc
    }))
  ]);

  const landItem = landPayload?.response?.body?.items?.item?.[0];
  const temperatureItem = temperaturePayload?.response?.body?.items?.item?.[0];

  if (!landItem || !temperatureItem) {
    return null;
  }

  const isMorning = toClockNumber(context.targetTime) < 1200;
  const conditionField = dayOffset <= 7
    ? `wf${dayOffset}${isMorning ? "Am" : "Pm"}`
    : `wf${dayOffset}`;
  const rainField = dayOffset <= 7
    ? `rnSt${dayOffset}${isMorning ? "Am" : "Pm"}`
    : `rnSt${dayOffset}`;

  const minTemperature = toNullableNumber(temperatureItem[`taMin${dayOffset}`]);
  const maxTemperature = toNullableNumber(temperatureItem[`taMax${dayOffset}`]);
  const precipitationProbability = toNullableNumber(landItem[rainField]);
  const condition = String(landItem[conditionField] || landItem[`wf${dayOffset}`] || "흐림");
  const estimatedWind = estimateMidTermWind(condition, precipitationProbability);

  return {
    source: "mid-term",
    sourceLabel: "중기예보 API",
    temperature: estimateTemperature(minTemperature, maxTemperature, context.targetTime),
    minTemperature,
    maxTemperature,
    condition,
    precipitationProbability,
    windSpeed: estimatedWind.speed,
    windDirection: estimatedWind.direction,
    humidity: null,
    description: `${issueTime.baseDate} ${formatClock(issueTime.baseTime)} 발표 중기예보 기준입니다.`,
    notes: ["중기예보 서비스는 풍속·풍향을 제공하지 않아 보조 추정값을 함께 사용했습니다."],
    usesEstimatedWind: true
  };
}

async function fetchRiseSetInfo(context) {
  if (!context.resolvedLocation.riseSetLocation) {
    return null;
  }

  const xml = await fetchText(buildUrl(RISE_SET_ENDPOINT, {
    serviceKey: context.serviceKey,
    locdate: context.targetDate,
    location: context.resolvedLocation.riseSetLocation
  }));

  return {
    sunrise: extractXmlTag(xml, "sunrise"),
    sunset: extractXmlTag(xml, "sunset")
  };
}

function extractXmlTag(xml, tagName) {
  const match = new RegExp(`<${tagName}>([^<]+)</${tagName}>`).exec(xml);
  return match ? normalizeClockDigits(match[1]) : "";
}

function pickShortForecastSlot(items, targetDate, targetTime) {
  const desired = toClockMinutes(targetTime || "0500");
  const slots = new Map();

  items.forEach((item) => {
    if (String(item.fcstDate) !== targetDate) {
      return;
    }

    const slotKey = String(item.fcstTime);
    const currentSlot = slots.get(slotKey) || {};
    currentSlot[item.category] = item.fcstValue;
    slots.set(slotKey, currentSlot);
  });

  const entries = [...slots.entries()];

  if (!entries.length) {
    return null;
  }

  entries.sort((left, right) => {
    const leftValue = toClockMinutes(left[0]);
    const rightValue = toClockMinutes(right[0]);
    const diff = Math.abs(leftValue - desired) - Math.abs(rightValue - desired);

    if (diff !== 0) {
      return diff;
    }

    return leftValue - rightValue;
  });

  return entries[0][1];
}

function getDailyForecastValue(items, targetDate, category) {
  const match = items.find((item) => (
    String(item.fcstDate) === targetDate
    && String(item.category) === category
  ));

  return toNullableNumber(match?.fcstValue);
}

function getShortTermBaseDateTime() {
  const now = getKstParts();
  const currentMinutes = (now.hour * 60) + now.minute - 10;
  const baseTimes = ["0200", "0500", "0800", "1100", "1400", "1700", "2000", "2300"];
  const minutes = baseTimes.map(toClockMinutes);
  const index = [...minutes].reverse().findIndex((value) => currentMinutes >= value);

  if (index !== -1) {
    const baseTime = baseTimes[baseTimes.length - 1 - index];
    return {
      baseDate: formatYmd(now.year, now.month, now.day),
      baseTime
    };
  }

  const previousDay = shiftYmd(formatYmd(now.year, now.month, now.day), -1);

  return {
    baseDate: previousDay,
    baseTime: "2300"
  };
}

function getMidTermIssueTime() {
  const now = getKstParts();
  const today = formatYmd(now.year, now.month, now.day);

  if (now.hour < 6) {
    return {
      baseDate: shiftYmd(today, -1),
      baseTime: "1800",
      tmFc: `${shiftYmd(today, -1)}1800`
    };
  }

  if (now.hour < 18) {
    return {
      baseDate: today,
      baseTime: "0600",
      tmFc: `${today}0600`
    };
  }

  return {
    baseDate: today,
    baseTime: "1800",
    tmFc: `${today}1800`
  };
}

function getDayOffset(targetYmd, baseYmd) {
  const target = parseYmd(targetYmd);
  const base = parseYmd(baseYmd);
  return Math.round((target.getTime() - base.getTime()) / ONE_DAY_MS);
}

function estimateTemperature(minTemperature, maxTemperature, timeString) {
  if (!Number.isFinite(minTemperature) && !Number.isFinite(maxTemperature)) {
    return null;
  }

  if (!Number.isFinite(minTemperature)) {
    return maxTemperature;
  }

  if (!Number.isFinite(maxTemperature)) {
    return minTemperature;
  }

  const timeValue = toClockMinutes(timeString || "1200");

  if (timeValue < 10 * 60) {
    return Number((((minTemperature * 2) + maxTemperature) / 3).toFixed(1));
  }

  if (timeValue < 17 * 60) {
    return Number(((minTemperature + (maxTemperature * 2)) / 3).toFixed(1));
  }

  return Number((((minTemperature + maxTemperature) / 2)).toFixed(1));
}

function estimateMidTermWind(condition, precipitationProbability) {
  const rain = Number.isFinite(precipitationProbability) ? precipitationProbability : 30;
  let speed = 3.8;

  if (condition.includes("비") || rain >= 60) {
    speed = 6.2;
  } else if (condition.includes("흐림") || rain >= 40) {
    speed = 4.8;
  }

  return {
    speed: Number(speed.toFixed(1)),
    direction: "변동"
  };
}

function mapSkyCondition(skyCode, ptyCode) {
  if (ptyCode === 1 || ptyCode === 4 || ptyCode === 5) {
    return "비";
  }

  if (ptyCode === 2 || ptyCode === 6) {
    return "비/눈";
  }

  if (ptyCode === 3 || ptyCode === 7) {
    return "눈";
  }

  if (skyCode === 1) {
    return "맑음";
  }

  if (skyCode === 3) {
    return "구름 많음";
  }

  if (skyCode === 4) {
    return "흐림";
  }

  return "예보 확인 중";
}

function toKoreanDirection(degree) {
  if (!Number.isFinite(degree)) {
    return "변동";
  }

  const directions = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
  const index = Math.round(degree / 45) % directions.length;
  return directions[index];
}

function convertLatLngToGrid(latitude, longitude) {
  const DEGRAD = Math.PI / 180;
  const RE = 6371.00877;
  const GRID = 5.0;
  const SLAT1 = 30.0;
  const SLAT2 = 60.0;
  const OLON = 126.0;
  const OLAT = 38.0;
  const XO = 43;
  const YO = 136;

  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn = Math.tan((Math.PI * 0.25) + (slat2 * 0.5)) / Math.tan((Math.PI * 0.25) + (slat1 * 0.5));
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);

  let sf = Math.tan((Math.PI * 0.25) + (slat1 * 0.5));
  sf = Math.pow(sf, sn) * Math.cos(slat1) / sn;

  let ro = Math.tan((Math.PI * 0.25) + (olat * 0.5));
  ro = re * sf / Math.pow(ro, sn);

  let ra = Math.tan((Math.PI * 0.25) + ((latitude) * DEGRAD * 0.5));
  ra = re * sf / Math.pow(ra, sn);

  let theta = longitude * DEGRAD - olon;

  if (theta > Math.PI) {
    theta -= 2 * Math.PI;
  }

  if (theta < -Math.PI) {
    theta += 2 * Math.PI;
  }

  theta *= sn;

  return {
    nx: Math.floor((ra * Math.sin(theta)) + XO + 0.5),
    ny: Math.floor((ro - (ra * Math.cos(theta))) + YO + 0.5)
  };
}

function calculateDistanceKm(lat1, lng1, lat2, lng2) {
  const toRadians = (value) => value * (Math.PI / 180);
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = (
    Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRadians(lat1))
    * Math.cos(toRadians(lat2))
    * Math.sin(dLng / 2)
    * Math.sin(dLng / 2)
  );

  return 6371 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function parseYmd(ymd) {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(4, 6)) - 1;
  const day = Number(ymd.slice(6, 8));
  return new Date(Date.UTC(year, month, day));
}

function shiftYmd(ymd, offset) {
  const date = parseYmd(ymd);
  date.setUTCDate(date.getUTCDate() + offset);
  return formatYmd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function getKstParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date || new Date());

  const parsed = {};

  parts.forEach((part) => {
    if (part.type !== "literal") {
      parsed[part.type] = part.value;
    }
  });

  return {
    year: Number(parsed.year),
    month: Number(parsed.month),
    day: Number(parsed.day),
    hour: Number(parsed.hour),
    minute: Number(parsed.minute),
    second: Number(parsed.second)
  };
}

function formatYmd(year, month, day) {
  return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

function formatClock(value) {
  const digits = String(value || "").replace(/\D/g, "").padStart(4, "0");
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
}

function normalizeClockDigits(value) {
  const digits = String(value || "").replace(/\D/g, "").trim();

  if (digits.length < 3) {
    return "";
  }

  const padded = digits.padStart(4, "0");
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`;
}

function simplifyLocationName(locationName) {
  const trimmed = String(locationName || "").trim();

  if (!trimmed) {
    return "";
  }

  return trimmed
    .split(/[ ,]/)
    .find(Boolean)
    ?.replace(/(항|포|선착장)$/g, "")
    || trimmed;
}

function toClockNumber(timeString) {
  return Number(String(timeString || "").replace(":", "").padStart(4, "0"));
}

function toClockMinutes(timeString) {
  const digits = String(timeString || "").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2, 4));
  return (hours * 60) + minutes;
}

function toNullableNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

module.exports = {
  NAVER_GEOCODE_ENDPOINT,
  NAVER_STATIC_MAP_ENDPOINT,
  buildUrl,
  fetchJson,
  fetchText,
  geocodeWithNaver,
  readNaverCredentials,
  readServiceKey,
  resolveLocation,
  fetchShortTermForecast,
  fetchMidTermForecast,
  fetchRiseSetInfo,
  sendJson
};
