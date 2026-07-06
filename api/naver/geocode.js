"use strict";

const {
  NAVER_GEOCODE_ENDPOINT,
  buildUrl,
  fetchJson,
  readNaverCredentials,
  sendJson
} = require("../_lib/fishing-proxy");

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

  if (!credentials.clientId || !credentials.clientSecret) {
    sendJson(response, 503, {
      ok: false,
      message: "NAVER_MAPS_CLIENT_ID 또는 NAVER_MAPS_CLIENT_SECRET 환경변수가 없습니다."
    });
    return;
  }

  const query = String(request.query.query || "").trim();

  if (!query) {
    sendJson(response, 400, {
      ok: false,
      message: "query 파라미터가 필요합니다."
    });
    return;
  }

  try {
    const payload = await fetchJson(buildUrl(NAVER_GEOCODE_ENDPOINT, { query }), {
      headers: {
        Accept: "application/json",
        "x-ncp-apigw-api-key-id": credentials.clientId,
        "x-ncp-apigw-api-key": credentials.clientSecret
      }
    });

    sendJson(response, 200, payload);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error?.message || "네이버 지오코딩 요청 중 오류가 발생했습니다."
    });
  }
};
