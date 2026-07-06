"use strict";

const {
  fetchMidTermForecast,
  fetchRiseSetInfo,
  fetchShortTermForecast,
  readServiceKey,
  resolveLocation,
  sendJson
} = require("./_lib/fishing-proxy");

module.exports = async (request, response) => {
  response.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");

  if (request.method !== "GET") {
    sendJson(response, 405, {
      ok: false,
      message: "GET 요청만 지원합니다."
    });
    return;
  }

  const serviceKey = readServiceKey();

  if (!serviceKey) {
    sendJson(response, 503, {
      ok: false,
      message: "PUBLIC_DATA_SERVICE_KEY 환경변수가 없어 실제 날씨 API를 호출할 수 없습니다."
    });
    return;
  }

  const targetDate = normalizeDateQuery(request.query.date);
  const targetTime = normalizeTimeQuery(request.query.time);
  const locationName = String(request.query.locationName || "").trim();

  if (!targetDate || !targetTime || !locationName) {
    sendJson(response, 400, {
      ok: false,
      message: "date, time, locationName 파라미터가 필요합니다."
    });
    return;
  }

  try {
    const resolvedLocation = await resolveLocation({
      locationName,
      lat: request.query.lat,
      lng: request.query.lng
    });
    const context = {
      serviceKey,
      targetDate,
      targetTime,
      resolvedLocation
    };
    const notes = [];
    const riseSetResult = await fetchRiseSetInfo(context).catch(() => null);
    let forecast = await fetchShortTermForecast(context).catch((error) => {
      notes.push(`단기예보 조회 실패: ${error.message}`);
      return null;
    });

    if (!forecast) {
      forecast = await fetchMidTermForecast(context).catch((error) => {
        notes.push(`중기예보 조회 실패: ${error.message}`);
        return null;
      });
    }

    if (!forecast) {
      sendJson(response, 200, {
        ok: false,
        message: "예보 범위를 벗어났거나 지역 매핑이 부족해 실제 예보를 불러오지 못했습니다.",
        notes,
        riseSet: riseSetResult,
        resolvedLocation: toPublicLocationMeta(resolvedLocation)
      });
      return;
    }

    sendJson(response, 200, {
      ok: true,
      weather: {
        ...forecast,
        sunrise: riseSetResult?.sunrise || "",
        sunset: riseSetResult?.sunset || "",
        notes: [...forecast.notes, ...notes],
        resolvedLocation: toPublicLocationMeta(resolvedLocation)
      }
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error?.message || "날씨 정보를 가져오는 중 오류가 발생했습니다."
    });
  }
};

function normalizeDateQuery(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 8 ? digits : "";
}

function normalizeTimeQuery(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? digits.padStart(4, "0").slice(0, 4) : "";
}

function toPublicLocationMeta(location) {
  return {
    label: location.label,
    latitude: location.latitude,
    longitude: location.longitude,
    nx: location.nx,
    ny: location.ny,
    riseSetLocation: location.riseSetLocation,
    matchedPresetId: location.matchedPresetId,
    resolutionMode: location.resolutionMode
  };
}
