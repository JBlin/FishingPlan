"use strict";

const {
  NAVER_GEOCODE_ENDPOINT,
  buildUrl,
  fetchJson,
  readNaverCredentials,
  resolveLocation,
  sendJson
} = require("../_lib/fishing-proxy");

function hasValidCoordinates(location) {
  return Number.isFinite(location?.latitude) && Number.isFinite(location?.longitude);
}

function createFallbackPayload(query, resolvedLocation) {
  const addressLabel = resolvedLocation.label || query;

  return {
    status: "OK",
    meta: {
      totalCount: 1,
      count: 1
    },
    addresses: [
      {
        roadAddress: addressLabel,
        jibunAddress: addressLabel,
        x: String(resolvedLocation.longitude),
        y: String(resolvedLocation.latitude)
      }
    ],
    errorMessage: ""
  };
}

module.exports = async (request, response) => {
  response.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=86400");

  if (request.method !== "GET") {
    sendJson(response, 405, {
      ok: false,
      message: "GET 요청만 지원합니다."
    });
    return;
  }

  const credentials = readNaverCredentials();
  const query = String(request.query.query || "").trim();

  if (!query) {
    sendJson(response, 400, {
      ok: false,
      message: "query 파라미터가 필요합니다."
    });
    return;
  }

  const resolvedLocation = await resolveLocation({ locationName: query });

  try {
    if (!credentials.clientId || !credentials.clientSecret) {
      if (hasValidCoordinates(resolvedLocation)) {
        sendJson(response, 200, createFallbackPayload(query, resolvedLocation));
        return;
      }

      sendJson(response, 503, {
        ok: false,
        message: "NAVER_MAPS_CLIENT_ID 또는 NAVER_MAPS_CLIENT_SECRET 환경변수가 없습니다."
      });
      return;
    }

    const payload = await fetchJson(buildUrl(NAVER_GEOCODE_ENDPOINT, { query }), {
      headers: {
        Accept: "application/json",
        "x-ncp-apigw-api-key-id": credentials.clientId,
        "x-ncp-apigw-api-key": credentials.clientSecret
      }
    });

    const addresses = Array.isArray(payload.addresses) ? payload.addresses : [];

    if (!addresses.length && hasValidCoordinates(resolvedLocation)) {
      sendJson(response, 200, createFallbackPayload(query, resolvedLocation));
      return;
    }

    sendJson(response, 200, payload);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error?.message || "네이버 지오코드 요청 중 오류가 발생했습니다."
    });
  }
};
