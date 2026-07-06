"use strict";

const {
  NAVER_STATIC_MAP_ENDPOINT,
  buildUrl,
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

  try {
    const upstreamResponse = await fetch(buildUrl(NAVER_STATIC_MAP_ENDPOINT, request.query), {
      headers: {
        "x-ncp-apigw-api-key-id": credentials.clientId,
        "x-ncp-apigw-api-key": credentials.clientSecret
      }
    });

    if (!upstreamResponse.ok) {
      throw new Error(`네이버 Static Map 요청 실패 (${upstreamResponse.status})`);
    }

    const contentType = upstreamResponse.headers.get("content-type") || "image/png";
    const imageBuffer = Buffer.from(await upstreamResponse.arrayBuffer());

    response.statusCode = 200;
    response.setHeader("Content-Type", contentType);
    response.end(imageBuffer);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error?.message || "네이버 정적 지도 요청 중 오류가 발생했습니다."
    });
  }
};
