const STORAGE_KEYS = {
  trips: "chuljo-note-trips",
  selectedTripId: "chuljo-note-selected-trip"
};

const NAVER_MAPS_ENDPOINTS = {
  staticMap: "https://maps.apigw.ntruss.com/map-static/v2",
  directions5: "https://maps.apigw.ntruss.com/map-direction/v1",
  directions15: "https://maps.apigw.ntruss.com/map-direction-15/v1",
  geocoding: "https://maps.apigw.ntruss.com/map-geocode/v2",
  reverseGeocoding: "https://maps.apigw.ntruss.com/map-reversegeocode/v2"
};

const DEFAULT_CHECKLISTS = {
  선상: ["로드", "릴", "합사", "쇼크리더", "지그헤드", "웜", "장갑", "구명조끼", "멀미약", "아이스박스", "생수"],
  방파제: ["루어대", "릴", "지그헤드", "웜", "뜰채", "랜턴", "장갑", "물", "간식"],
  원투: ["원투대", "릴", "봉돌", "바늘", "미끼", "받침대", "의자", "아이스박스"],
  갑오징어: ["에기", "봉돌", "합사", "쇼크리더", "집게", "쿨러", "장갑"],
  기타: ["로드", "릴", "채비", "장갑", "생수"]
};

const state = {
  trips: [],
  selectedTripId: null,
  resolvingTripIds: new Set(),
  locationErrors: {}
};

const dom = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  cacheDom();
  bindStaticEvents();
  setFormDefaults();

  state.trips = loadTrips();

  if (state.trips.length === 0) {
    const sampleTrip = createSampleTrip();
    state.trips = [sampleTrip];
    state.selectedTripId = sampleTrip.id;
    saveTrips();
    saveSelectedTrip();
  } else {
    const storedSelectedTripId = loadSelectedTripId();
    const hasStoredSelection = state.trips.some((trip) => trip.id === storedSelectedTripId);

    state.selectedTripId = hasStoredSelection
      ? storedSelectedTripId
      : (getNearestTrip(state.trips)?.id || null);

    saveSelectedTrip();
  }

  renderApp();
}

function cacheDom() {
  dom.selectedTripCard = document.getElementById("selected-trip-card");
  dom.prepSummaryCard = document.getElementById("prep-summary-card");
  dom.weatherCard = document.getElementById("weather-card");
  dom.conditionCard = document.getElementById("condition-card");
  dom.tideCard = document.getElementById("tide-card");
  dom.checklistCard = document.getElementById("checklist-card");
  dom.placeCard = document.getElementById("place-card");
  dom.memoCard = document.getElementById("memo-card");
  dom.tripListCard = document.getElementById("trip-list-card");
  dom.tripForm = document.getElementById("trip-form");
  dom.tripDateInput = document.getElementById("trip-date-input");
  dom.tripTimeInput = document.getElementById("trip-time-input");
  dom.meetupTimeInput = document.getElementById("meetup-time-input");
  dom.scrollToFormButton = document.getElementById("scroll-to-form-btn");
  dom.tripFormCard = document.getElementById("trip-form-card");
}

function bindStaticEvents() {
  dom.tripForm.addEventListener("submit", addTrip);
  dom.scrollToFormButton.addEventListener("click", scrollToForm);

  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("change", handleDocumentChange);
  document.addEventListener("submit", handleDocumentSubmit);
  document.addEventListener("input", handleDocumentInput);
}

function handleDocumentClick(event) {
  const actionTarget = event.target.closest("[data-action]");

  if (!actionTarget) {
    return;
  }

  const { action, tripId, itemId, place } = actionTarget.dataset;

  if (action === "select-trip") {
    selectTrip(tripId, true);
    return;
  }

  if (action === "delete-trip") {
    deleteTrip(tripId);
    return;
  }

  if (action === "delete-checklist-item") {
    deleteChecklistItem(tripId, itemId);
    return;
  }

  if (action === "open-naver-map") {
    openNaverMap(place);
    return;
  }

  if (action === "open-kakao-map") {
    openKakaoMap(place);
    return;
  }

  if (action === "refresh-location") {
    void syncTripLocation(tripId, true);
  }
}

function handleDocumentChange(event) {
  if (!event.target.classList.contains("checklist-toggle")) {
    return;
  }

  const { tripId, itemId } = event.target.dataset;
  updateChecklistItem(tripId, itemId, event.target.checked);
}

function handleDocumentSubmit(event) {
  if (event.target.id !== "checklist-add-form") {
    return;
  }

  event.preventDefault();
  addChecklistItem(event.target);
}

function handleDocumentInput(event) {
  if (event.target.id !== "trip-log-textarea") {
    return;
  }

  updateTripLog(event.target.value);
}

function setFormDefaults() {
  const defaultDate = addDays(new Date(), 7);

  if (dom.tripDateInput && !dom.tripDateInput.value) {
    dom.tripDateInput.value = formatDateInput(defaultDate);
  }

  if (dom.tripTimeInput && !dom.tripTimeInput.value) {
    dom.tripTimeInput.value = "05:00";
  }

  if (dom.meetupTimeInput && !dom.meetupTimeInput.value) {
    dom.meetupTimeInput.value = "04:30";
  }
}

function loadTrips() {
  try {
    const rawTrips = localStorage.getItem(STORAGE_KEYS.trips);

    if (!rawTrips) {
      return [];
    }

    const parsedTrips = JSON.parse(rawTrips);

    if (!Array.isArray(parsedTrips)) {
      return [];
    }

    return parsedTrips.map(normalizeTrip);
  } catch (_error) {
    return [];
  }
}

function saveTrips() {
  try {
    localStorage.setItem(STORAGE_KEYS.trips, JSON.stringify(state.trips));
  } catch (_error) {
    // localStorage 저장이 실패해도 화면 사용은 계속 가능해야 합니다.
  }
}

function loadSelectedTripId() {
  try {
    return localStorage.getItem(STORAGE_KEYS.selectedTripId);
  } catch (_error) {
    return null;
  }
}

function saveSelectedTrip() {
  try {
    if (state.selectedTripId) {
      localStorage.setItem(STORAGE_KEYS.selectedTripId, state.selectedTripId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.selectedTripId);
    }
  } catch (_error) {
    // 선택 일정 저장 실패 시에도 앱은 계속 동작해야 합니다.
  }
}

function normalizeTrip(trip) {
  const fishingType = trip.fishingType || "선상";

  return {
    id: String(trip.id || generateId()),
    title: String(trip.title || "이름 없는 출조"),
    date: String(trip.date || formatDateInput(new Date())),
    time: String(trip.time || "05:00"),
    locationName: String(trip.locationName || ""),
    fishingType,
    targetFish: String(trip.targetFish || ""),
    meetupPlace: String(trip.meetupPlace || ""),
    meetupTime: String(trip.meetupTime || ""),
    cost: normalizeCost(trip.cost),
    memo: String(trip.memo || ""),
    tripLog: String(trip.tripLog || ""),
    checklist: Array.isArray(trip.checklist)
      ? trip.checklist.map(normalizeChecklistItem)
      : createChecklistByType(fishingType),
    locationMeta: normalizeLocationMeta(trip.locationMeta),
    createdAt: String(trip.createdAt || new Date().toISOString())
  };
}

function normalizeChecklistItem(item) {
  return {
    id: String(item.id || generateId()),
    text: String(item.text || "준비물"),
    checked: Boolean(item.checked)
  };
}

function normalizeLocationMeta(locationMeta) {
  return {
    lat: toNullableNumber(locationMeta?.lat),
    lng: toNullableNumber(locationMeta?.lng),
    roadAddress: String(locationMeta?.roadAddress || ""),
    jibunAddress: String(locationMeta?.jibunAddress || ""),
    source: String(locationMeta?.source || ""),
    updatedAt: String(locationMeta?.updatedAt || "")
  };
}

function normalizeCost(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function createSampleTrip() {
  const sampleDate = addDays(new Date(), 14);

  return {
    id: generateId(),
    title: "태안 선상 광어",
    date: formatDateInput(sampleDate),
    time: "05:00",
    locationName: "구매항",
    fishingType: "선상",
    targetFish: "광어",
    meetupPlace: "구매항",
    meetupTime: "04:30",
    cost: 80000,
    memo: "신분증 지참, 멀미약 미리 복용",
    tripLog: "",
    checklist: createChecklistByType("선상"),
    locationMeta: normalizeLocationMeta(null),
    createdAt: new Date().toISOString()
  };
}

function createChecklistByType(fishingType) {
  const items = DEFAULT_CHECKLISTS[fishingType] || DEFAULT_CHECKLISTS.기타;

  return items.map((text) => ({
    id: generateId(),
    text,
    checked: false
  }));
}

function generateId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `trip-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function renderApp() {
  const selectedTrip = getSelectedTrip();

  renderSelectedTrip(selectedTrip);
  renderPrepSummary(selectedTrip);
  renderWeatherCard(selectedTrip);
  renderConditionCard(selectedTrip);
  renderTideCard(selectedTrip);
  renderChecklist(selectedTrip);
  renderPlaceCard(selectedTrip);
  renderMemoCard(selectedTrip);
  renderTripList();

  if (selectedTrip) {
    void syncSelectedTripLocation();
  }
}

function getSelectedTrip() {
  return state.trips.find((trip) => trip.id === state.selectedTripId) || null;
}

function renderSelectedTrip(trip) {
  if (!trip) {
    dom.selectedTripCard.innerHTML = createEmptyCardMarkup(
      "선택된 출조가 없습니다",
      "새 일정을 등록하면 상단에 일정 상세와 준비 상태가 표시됩니다."
    );
    return;
  }

  const dday = calculateDday(trip.date);
  const isNearestTrip = getNearestTrip(state.trips)?.id === trip.id;

  dom.selectedTripCard.innerHTML = `
    <div class="trip-title-row">
      <div class="trip-title-block">
        <p class="section-kicker">${isNearestTrip ? "다음 출조 일정" : "선택된 출조"}</p>
        <h2>${escapeHtml(trip.title)}</h2>
        <p class="trip-subtitle">${escapeHtml(formatTripDateTime(trip.date, trip.time))}</p>
      </div>
      <div class="dday-badge ${dday.className}">${dday.label}</div>
    </div>

    <div class="chip-row">
      <span class="chip">${escapeHtml(trip.fishingType)}</span>
      <span class="chip">${escapeHtml(trip.targetFish)}</span>
      <span class="chip">${escapeHtml(trip.locationName)}</span>
      ${isNearestTrip ? '<span class="badge badge-success">가장 가까운 일정</span>' : ""}
    </div>

    <div class="detail-grid" style="margin-top: 18px;">
      <div class="detail-item">
        <span>장소</span>
        <strong>${escapeHtml(trip.locationName)}</strong>
      </div>
      <div class="detail-item">
        <span>낚시유형</span>
        <strong>${escapeHtml(trip.fishingType)}</strong>
      </div>
      <div class="detail-item">
        <span>대상어</span>
        <strong>${escapeHtml(trip.targetFish)}</strong>
      </div>
      <div class="detail-item">
        <span>집결 정보</span>
        <strong>${escapeHtml(formatMeetupInfo(trip.meetupPlace, trip.meetupTime))}</strong>
      </div>
      <div class="detail-item">
        <span>비용</span>
        <strong>${escapeHtml(formatCurrency(trip.cost))}</strong>
      </div>
      <div class="detail-item">
        <span>출조 시간</span>
        <strong>${escapeHtml(trip.time || "-")}</strong>
      </div>
    </div>

    ${trip.memo ? `
      <div class="trip-note">
        <span class="meta-label">사전 메모</span>
        <p>${escapeHtml(trip.memo)}</p>
      </div>
    ` : ""}
  `;
}

function renderPrepSummary(trip) {
  if (!trip) {
    dom.prepSummaryCard.innerHTML = createEmptyCardMarkup(
      "준비 상태 요약",
      "일정을 선택하면 준비물 진행률이 여기에 표시됩니다."
    );
    return;
  }

  const completedCount = trip.checklist.filter((item) => item.checked).length;
  const totalCount = trip.checklist.length;
  const progress = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;

  dom.prepSummaryCard.innerHTML = `
    <div class="section-title-row">
      <div>
        <p class="section-kicker">준비 상태 요약</p>
        <h2>${completedCount} / ${totalCount} 완료</h2>
      </div>
      <span class="badge">${progress}%</span>
    </div>

    <div class="stats-grid">
      <div class="stat-card highlight">
        <span>준비 완료율</span>
        <strong class="stat-number">${progress}%</strong>
      </div>
      <div class="stat-card">
        <span>남은 준비물</span>
        <strong class="stat-number">${Math.max(totalCount - completedCount, 0)}개</strong>
      </div>
    </div>

    <div class="progress-track" aria-hidden="true">
      <div class="progress-bar" style="width: ${progress}%;"></div>
    </div>
    <span class="progress-caption" style="margin-top: 10px;">
      체크리스트 기준으로 준비 진행률을 계산합니다.
    </span>
  `;
}

function renderWeatherCard(trip) {
  if (!trip) {
    dom.weatherCard.innerHTML = createEmptyCardMarkup(
      "날씨",
      "일정을 선택하면 더미 날씨 데이터를 볼 수 있습니다."
    );
    return;
  }

  const weather = getWeatherData(trip);

  dom.weatherCard.innerHTML = `
    <div class="section-title-row">
      <div>
        <p class="section-kicker">날씨</p>
        <h2>${escapeHtml(trip.locationName)} 기준</h2>
      </div>
      <span class="badge badge-muted">더미 데이터</span>
    </div>

    <div class="weather-grid">
      <div class="weather-item">
        <span>기온</span>
        <strong>${weather.temperature}°C</strong>
      </div>
      <div class="weather-item">
        <span>날씨 상태</span>
        <strong>${escapeHtml(weather.condition)}</strong>
      </div>
      <div class="weather-item">
        <span>강수확률</span>
        <strong>${weather.precipitation}%</strong>
      </div>
      <div class="weather-item">
        <span>풍속 / 풍향</span>
        <strong>${weather.windSpeed}m/s · ${escapeHtml(weather.windDirection)}</strong>
      </div>
    </div>

    <p class="helper-text">나중에 <code>getWeatherData(trip)</code>에 실제 기상 API를 연결할 수 있도록 분리해두었습니다.</p>
  `;
}

function renderConditionCard(trip) {
  if (!trip) {
    dom.conditionCard.innerHTML = createEmptyCardMarkup(
      "낚시 컨디션",
      "풍속과 강수확률을 바탕으로 컨디션 점수를 계산합니다."
    );
    return;
  }

  const weather = getWeatherData(trip);
  const condition = calculateFishingCondition(weather);

  dom.conditionCard.innerHTML = `
    <div class="section-title-row">
      <div>
        <p class="section-kicker">낚시 컨디션</p>
        <h2>${condition.label}</h2>
      </div>
      <span class="badge ${condition.badgeClass}">${condition.statusText}</span>
    </div>

    <div class="condition-layout">
      <div class="condition-score">
        <strong>${condition.score}</strong>
        <span>점수</span>
      </div>
      <div class="condition-copy">
        <h2>${condition.headline}</h2>
        <p>${condition.message}</p>
        <p class="helper-text">풍속 ${weather.windSpeed}m/s, 강수확률 ${weather.precipitation}% 기준으로 단순 계산했습니다.</p>
      </div>
    </div>
  `;
}

function renderTideCard(trip) {
  if (!trip) {
    dom.tideCard.innerHTML = createEmptyCardMarkup(
      "물때",
      "일정을 선택하면 더미 물때 정보를 볼 수 있습니다."
    );
    return;
  }

  const tide = getTideData(trip);

  dom.tideCard.innerHTML = `
    <div class="section-title-row">
      <div>
        <p class="section-kicker">물때</p>
        <h2>${escapeHtml(trip.locationName)} 조석 메모</h2>
      </div>
      <span class="badge badge-muted">더미 데이터</span>
    </div>

    <div class="tide-grid">
      <div class="tide-item">
        <span>만조 시간</span>
        <strong>${escapeHtml(tide.highTide)}</strong>
      </div>
      <div class="tide-item">
        <span>간조 시간</span>
        <strong>${escapeHtml(tide.lowTide)}</strong>
      </div>
      <div class="tide-item">
        <span>조차</span>
        <strong>${escapeHtml(tide.tidalRange)}</strong>
      </div>
      <div class="tide-item">
        <span>추천 시간대</span>
        <strong>${escapeHtml(tide.recommendedWindow)}</strong>
      </div>
    </div>

    <p class="helper-text">나중에 <code>getTideData(trip)</code>에 국립해양조사원 조석 API를 연결할 수 있습니다.</p>
  `;
}

function renderChecklist(trip) {
  if (!trip) {
    dom.checklistCard.innerHTML = createEmptyCardMarkup(
      "준비물 체크리스트",
      "일정을 선택하면 낚시 유형별 준비물을 관리할 수 있습니다."
    );
    return;
  }

  const completedCount = trip.checklist.filter((item) => item.checked).length;

  dom.checklistCard.innerHTML = `
    <div class="section-title-row">
      <div>
        <p class="section-kicker">준비물 체크리스트</p>
        <h2>${completedCount} / ${trip.checklist.length} 완료</h2>
      </div>
      <span class="badge badge-muted">${escapeHtml(trip.fishingType)} 기본 세트</span>
    </div>

    <form id="checklist-add-form" class="inline-form">
      <label class="visually-hidden" for="checklist-item-input">준비물 추가</label>
      <input
        id="checklist-item-input"
        name="checklistItem"
        type="text"
        maxlength="40"
        placeholder="직접 준비물을 추가해보세요"
        required
      >
      <button type="submit" class="secondary-button">준비물 추가</button>
    </form>

    ${trip.checklist.length ? `
      <ul class="checklist-list">
        ${trip.checklist.map((item) => `
          <li class="checklist-item ${item.checked ? "is-checked" : ""}">
            <label>
              <input
                class="checklist-toggle"
                type="checkbox"
                data-trip-id="${escapeHtmlAttribute(trip.id)}"
                data-item-id="${escapeHtmlAttribute(item.id)}"
                ${item.checked ? "checked" : ""}
              >
              <span class="checklist-text">${escapeHtml(item.text)}</span>
            </label>
            <button
              type="button"
              class="danger-button"
              data-action="delete-checklist-item"
              data-trip-id="${escapeHtmlAttribute(trip.id)}"
              data-item-id="${escapeHtmlAttribute(item.id)}"
            >
              삭제
            </button>
          </li>
        `).join("")}
      </ul>
    ` : `
      <p class="helper-text" style="margin-top: 16px;">준비물이 없습니다. 직접 항목을 추가해보세요.</p>
    `}
  `;
}

function renderPlaceCard(trip) {
  if (!trip) {
    dom.placeCard.innerHTML = createEmptyCardMarkup(
      "장소",
      "선택된 일정의 장소명으로 지도 검색 버튼이 표시됩니다."
    );
    return;
  }

  const config = getNaverMapsConfig();
  const placePreview = getPlacePreviewState(trip);
  const canRefreshLocation = hasNaverProxy() && !state.resolvingTripIds.has(trip.id);

  dom.placeCard.innerHTML = `
    <div class="section-title-row">
      <div>
        <p class="section-kicker">장소</p>
        <h2>${escapeHtml(trip.locationName)}</h2>
      </div>
      <span class="badge">${escapeHtml(trip.fishingType)}</span>
    </div>

    <div class="status-row">
      <span class="status-pill ${placePreview.statusClass}">${escapeHtml(placePreview.statusText)}</span>
      <span class="status-pill ${config.clientId ? "is-success" : "is-warning"}">
        ${config.clientId ? "Client ID 연결됨" : "Client ID 필요"}
      </span>
    </div>

    <div class="map-preview-box">
      <div class="map-preview-media">
        ${placePreview.imageSrc ? `
          <img
            src="${escapeHtmlAttribute(placePreview.imageSrc)}"
            alt="${escapeHtmlAttribute(`${trip.locationName} 정적 지도 미리보기`)}"
          >
          <span class="map-preview-pin" aria-hidden="true"></span>
        ` : `
          <div class="map-preview-placeholder">
            <strong>${escapeHtml(trip.locationName)}</strong>
            <span>${escapeHtml(placePreview.placeholderText)}</span>
            <span class="map-preview-pin" aria-hidden="true"></span>
          </div>
        `}
      </div>
      <div class="map-preview-copy">
        <h3>${escapeHtml(placePreview.title)}</h3>
        <p>${escapeHtml(placePreview.description)}</p>
      </div>
    </div>

    <div class="location-meta-grid" style="margin-top: 14px;">
      <div class="detail-item">
        <span>장소명</span>
        <strong>${escapeHtml(trip.locationName)}</strong>
      </div>
      <div class="detail-item">
        <span>출항지 또는 집결지</span>
        <strong>${escapeHtml(trip.meetupPlace || trip.locationName)}</strong>
      </div>
      <div class="detail-item">
        <span>좌표 상태</span>
        <strong>${escapeHtml(getCoordinateStatusLabel(trip))}</strong>
      </div>
      <div class="detail-item">
        <span>좌표</span>
        <strong>${escapeHtml(formatCoordinates(trip.locationMeta))}</strong>
      </div>
      ${trip.locationMeta.roadAddress ? `
        <div class="detail-item">
          <span>도로명 주소</span>
          <strong>${escapeHtml(trip.locationMeta.roadAddress)}</strong>
        </div>
      ` : ""}
      ${trip.locationMeta.jibunAddress ? `
        <div class="detail-item">
          <span>지번 주소</span>
          <strong>${escapeHtml(trip.locationMeta.jibunAddress)}</strong>
        </div>
      ` : ""}
    </div>

    <div class="location-actions">
      <button
        type="button"
        class="secondary-button"
        data-action="open-naver-map"
        data-place="${escapeHtmlAttribute(trip.locationName)}"
      >
        네이버 지도 검색
      </button>
      <button
        type="button"
        class="ghost-button"
        data-action="open-kakao-map"
        data-place="${escapeHtmlAttribute(trip.locationName)}"
      >
        카카오맵 검색
      </button>
      <button
        type="button"
        class="ghost-button"
        data-action="refresh-location"
        data-trip-id="${escapeHtmlAttribute(trip.id)}"
        ${canRefreshLocation ? "" : "disabled"}
      >
        좌표 갱신
      </button>
    </div>

    <p class="helper-text">
      네이버 Static Map, Geocoding, Reverse Geocoding, Directions 5/15 엔드포인트를 설정해두었습니다.
      보안을 위해 Client Secret은 브라우저 코드에 넣지 않았고, <code>proxyBaseUrl</code>에 서버 프록시를 연결하면
      정적 지도와 지오코딩이 자동 활성화됩니다.
    </p>
  `;
}

function renderMemoCard(trip) {
  if (!trip) {
    dom.memoCard.innerHTML = createEmptyCardMarkup(
      "출조 메모",
      "입질 시간, 채비, 웜 색상, 조과 같은 기록을 일정별로 남길 수 있습니다."
    );
    return;
  }

  dom.memoCard.innerHTML = `
    <div class="section-title-row">
      <div>
        <p class="section-kicker">출조 메모</p>
        <h2>${escapeHtml(trip.title)} 기록</h2>
      </div>
      <span class="badge badge-muted">자동 저장</span>
    </div>

    <p class="helper-text">입력한 내용은 선택된 일정에 자동으로 저장됩니다.</p>

    <textarea
      id="trip-log-textarea"
      class="memo-textarea"
      placeholder="입질 시간, 채비, 사용한 웜 색상, 조과 등을 기록해보세요."
    >${escapeHtmlTextarea(trip.tripLog)}</textarea>
  `;
}

function renderTripList() {
  const sortedTrips = getSortedTrips(state.trips);

  dom.tripListCard.innerHTML = `
    <div class="section-title-row list-title">
      <div>
        <p class="section-kicker">전체 일정 목록</p>
        <h2>${sortedTrips.length}개의 일정</h2>
        <p>가까운 날짜 순으로 정렬됩니다.</p>
      </div>
    </div>

    ${sortedTrips.length ? `
      <div class="list-stack">
        ${sortedTrips.map((trip) => {
          const dday = calculateDday(trip.date);
          const isSelected = trip.id === state.selectedTripId;

          return `
            <article class="trip-list-item ${isSelected ? "selected" : ""}">
              <button
                type="button"
                class="trip-select-button"
                data-action="select-trip"
                data-trip-id="${escapeHtmlAttribute(trip.id)}"
              >
                <div class="trip-card-top">
                  <div>
                    <span class="trip-card-title">${escapeHtml(trip.title)}</span>
                    <div class="trip-card-meta">
                      <span>${escapeHtml(formatTripDateTime(trip.date, trip.time))}</span>
                      <strong>${escapeHtml(trip.locationName)}</strong>
                    </div>
                  </div>
                  <span class="badge ${dday.badgeClass}">${dday.label}</span>
                </div>
                <div class="trip-card-chips">
                  <span class="chip">${escapeHtml(trip.targetFish)}</span>
                  <span class="chip">${escapeHtml(trip.fishingType)}</span>
                </div>
              </button>
              <div class="trip-card-actions">
                <button
                  type="button"
                  class="danger-button large-button"
                  data-action="delete-trip"
                  data-trip-id="${escapeHtmlAttribute(trip.id)}"
                >
                  일정 삭제
                </button>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    ` : `
      <div class="empty-card">
        <h2>등록된 일정이 없습니다</h2>
        <p>아래 폼에서 첫 출조 일정을 추가해보세요.</p>
      </div>
    `}
  `;
}

function addTrip(event) {
  event.preventDefault();

  const formData = new FormData(event.target);
  const fishingType = String(formData.get("fishingType") || "기타").trim();

  const newTrip = {
    id: generateId(),
    title: String(formData.get("title") || "").trim(),
    date: String(formData.get("date") || "").trim(),
    time: String(formData.get("time") || "").trim(),
    locationName: String(formData.get("locationName") || "").trim(),
    fishingType,
    targetFish: String(formData.get("targetFish") || "").trim(),
    meetupPlace: String(formData.get("meetupPlace") || "").trim(),
    meetupTime: String(formData.get("meetupTime") || "").trim(),
    cost: normalizeCost(formData.get("cost")),
    memo: String(formData.get("memo") || "").trim(),
    tripLog: "",
    checklist: createChecklistByType(fishingType),
    locationMeta: normalizeLocationMeta(null),
    createdAt: new Date().toISOString()
  };

  state.trips.push(newTrip);
  state.selectedTripId = newTrip.id;
  delete state.locationErrors[newTrip.id];

  saveTrips();
  saveSelectedTrip();
  event.target.reset();
  setFormDefaults();
  renderApp();
  dom.selectedTripCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function deleteTrip(tripId) {
  const trip = state.trips.find((item) => item.id === tripId);

  if (!trip) {
    return;
  }

  const confirmed = window.confirm(`"${trip.title}" 일정을 삭제할까요?`);

  if (!confirmed) {
    return;
  }

  state.trips = state.trips.filter((item) => item.id !== tripId);
  delete state.locationErrors[tripId];

  if (state.selectedTripId === tripId) {
    state.selectedTripId = getNearestTrip(state.trips)?.id || null;
  }

  saveTrips();
  saveSelectedTrip();
  renderApp();
}

function selectTrip(tripId, shouldScroll) {
  const exists = state.trips.some((trip) => trip.id === tripId);

  if (!exists) {
    return;
  }

  state.selectedTripId = tripId;
  saveSelectedTrip();
  renderApp();

  if (shouldScroll) {
    dom.selectedTripCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function updateChecklistItem(tripId, itemId, checked) {
  const trip = state.trips.find((item) => item.id === tripId);

  if (!trip) {
    return;
  }

  const checklistItem = trip.checklist.find((item) => item.id === itemId);

  if (!checklistItem) {
    return;
  }

  checklistItem.checked = checked;
  saveTrips();
  renderApp();
}

function addChecklistItem(form) {
  const selectedTrip = getSelectedTrip();

  if (!selectedTrip) {
    return;
  }

  const input = form.elements.namedItem("checklistItem");
  const text = String(input?.value || "").trim();

  if (!text) {
    return;
  }

  selectedTrip.checklist.push({
    id: generateId(),
    text,
    checked: false
  });

  saveTrips();
  renderApp();
}

function deleteChecklistItem(tripId, itemId) {
  const trip = state.trips.find((item) => item.id === tripId);

  if (!trip) {
    return;
  }

  trip.checklist = trip.checklist.filter((item) => item.id !== itemId);
  saveTrips();
  renderApp();
}

function updateTripLog(value) {
  const selectedTrip = getSelectedTrip();

  if (!selectedTrip) {
    return;
  }

  selectedTrip.tripLog = value;
  saveTrips();
}

function calculateDday(dateString) {
  const today = startOfDay(new Date());
  const targetDate = startOfDay(new Date(`${dateString}T00:00:00`));
  const diffDays = Math.round((targetDate - today) / 86400000);

  if (diffDays === 0) {
    return {
      label: "D-day",
      className: "today",
      badgeClass: "badge-danger"
    };
  }

  if (diffDays > 0) {
    return {
      label: `D-${diffDays}`,
      className: "future",
      badgeClass: "badge"
    };
  }

  return {
    label: `D+${Math.abs(diffDays)}`,
    className: "past",
    badgeClass: "badge-muted"
  };
}

function getSortedTrips(trips) {
  return [...trips].sort((a, b) => getTripDateValue(a) - getTripDateValue(b));
}

function getNearestTrip(trips) {
  if (!trips.length) {
    return null;
  }

  const sortedTrips = getSortedTrips(trips);
  const today = startOfDay(new Date());
  const upcomingTrip = sortedTrips.find((trip) => startOfDay(new Date(`${trip.date}T00:00:00`)) >= today);

  return upcomingTrip || sortedTrips[sortedTrips.length - 1];
}

function getTripDateValue(trip) {
  const tripDate = new Date(`${trip.date}T${trip.time || "00:00"}:00`);
  return Number.isNaN(tripDate.getTime()) ? Number.MAX_SAFE_INTEGER : tripDate.getTime();
}

function getWeatherData(trip) {
  const seed = createSeed(`${trip.id}-${trip.date}-${trip.locationName}`);
  const conditions = ["맑음", "구름 많음", "흐림", "약한 비 가능"];
  const directions = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];

  return {
    temperature: 18 + (seed % 12),
    condition: conditions[seed % conditions.length],
    precipitation: [10, 20, 30, 40, 50, 60, 70][seed % 7],
    windSpeed: Number((2 + ((seed % 65) / 10)).toFixed(1)),
    windDirection: directions[seed % directions.length]
  };
}

function calculateFishingCondition(weather) {
  const windPenalty = Math.max(0, weather.windSpeed - 2) * 8;
  const rainPenalty = weather.precipitation * 0.35;
  const score = clamp(Math.round(95 - windPenalty - rainPenalty), 0, 100);

  let label = "좋음";
  let headline = "오전 출조에 무난한 조건입니다.";
  let message = "비교적 안정적인 날씨로 기본 준비물만 잘 챙기면 됩니다.";
  let statusText = "양호";
  let badgeClass = "badge-success";

  if (weather.precipitation >= 60) {
    label = "주의";
    headline = "비 예보가 있어 대비가 필요합니다.";
    message = "비 예보가 있어 우비와 방수팩을 챙기세요.";
    statusText = "우천 대비";
    badgeClass = "badge-warning";
  } else if (weather.windSpeed >= 7) {
    label = "주의";
    headline = "강한 바람 구간을 확인하세요.";
    message = "바람이 강할 수 있어 출항 여부를 확인하세요.";
    statusText = "강풍 주의";
    badgeClass = "badge-danger";
  } else if (weather.windSpeed > 4) {
    label = "보통";
    headline = "약간의 바람을 감안한 준비가 좋습니다.";
    message = "바람을 고려해 포인트 이동 시간과 방풍 장비를 준비하세요.";
    statusText = "보통";
    badgeClass = "badge";
  }

  return {
    score,
    label,
    headline,
    message,
    statusText,
    badgeClass
  };
}

function getTideData(trip) {
  const seed = createSeed(`${trip.locationName}-${trip.date}-${trip.targetFish}`);
  const highHour = 4 + (seed % 6);
  const lowHour = 10 + (seed % 7);
  const highMinute = seed % 2 === 0 ? "20" : "50";
  const lowMinute = seed % 3 === 0 ? "10" : "40";
  const windowStartHour = (highHour + 22) % 24;
  const windowEndHour = (highHour + 1) % 24;

  return {
    highTide: `${pad(highHour)}:${highMinute}`,
    lowTide: `${pad(lowHour)}:${lowMinute}`,
    tidalRange: `${(2.1 + ((seed % 20) / 10)).toFixed(1)}m`,
    recommendedWindow: `${pad(windowStartHour)}:${highMinute} - ${pad(windowEndHour)}:${highMinute}`
  };
}

function getNaverMapsConfig() {
  const rawConfig = window.CHULJO_NOTE_CONFIG?.naverMaps || {};
  const rawEndpoints = rawConfig.endpoints || {};

  return {
    clientId: String(rawConfig.clientId || "").trim(),
    proxyBaseUrl: sanitizeBaseUrl(rawConfig.proxyBaseUrl),
    endpoints: {
      staticMap: String(rawEndpoints.staticMap || NAVER_MAPS_ENDPOINTS.staticMap),
      directions5: String(rawEndpoints.directions5 || NAVER_MAPS_ENDPOINTS.directions5),
      directions15: String(rawEndpoints.directions15 || NAVER_MAPS_ENDPOINTS.directions15),
      geocoding: String(rawEndpoints.geocoding || NAVER_MAPS_ENDPOINTS.geocoding),
      reverseGeocoding: String(rawEndpoints.reverseGeocoding || NAVER_MAPS_ENDPOINTS.reverseGeocoding)
    }
  };
}

function hasNaverProxy() {
  return Boolean(getNaverMapsConfig().proxyBaseUrl);
}

function sanitizeBaseUrl(value) {
  const trimmed = String(value || "").trim();
  return trimmed.replace(/\/+$/, "");
}

function hasCoordinates(locationMeta) {
  return Number.isFinite(locationMeta?.lat) && Number.isFinite(locationMeta?.lng);
}

function getCoordinateStatusLabel(trip) {
  if (state.resolvingTripIds.has(trip.id)) {
    return "좌표 조회 중";
  }

  if (hasCoordinates(trip.locationMeta)) {
    return "좌표 저장됨";
  }

  if (state.locationErrors[trip.id]) {
    return "확인 필요";
  }

  if (hasNaverProxy()) {
    return "조회 대기";
  }

  return "프록시 연결 대기";
}

function formatCoordinates(locationMeta) {
  if (!hasCoordinates(locationMeta)) {
    return "미확인";
  }

  return `${locationMeta.lat.toFixed(6)}, ${locationMeta.lng.toFixed(6)}`;
}

function getPlacePreviewState(trip) {
  const locationError = state.locationErrors[trip.id];

  if (locationError) {
    return {
      statusClass: "is-warning",
      statusText: "연동 확인 필요",
      title: "위치 연동에 실패했습니다",
      description: locationError,
      placeholderText: "proxyBaseUrl 또는 프록시 서버 상태를 확인하세요.",
      imageSrc: ""
    };
  }

  if (state.resolvingTripIds.has(trip.id)) {
    return {
      statusClass: "is-info",
      statusText: "좌표 조회 중",
      title: "네이버 지오코딩으로 좌표를 확인하고 있습니다",
      description: "선택한 장소명을 기준으로 정적 지도 미리보기를 준비 중입니다.",
      placeholderText: "좌표를 조회하는 동안 잠시만 기다려주세요.",
      imageSrc: ""
    };
  }

  if (hasCoordinates(trip.locationMeta) && hasNaverProxy()) {
    return {
      statusClass: "is-success",
      statusText: "정적 지도 연결됨",
      title: "네이버 Static Map 미리보기",
      description: trip.locationMeta.roadAddress || "저장된 좌표를 기준으로 정적 지도를 표시합니다.",
      placeholderText: "",
      imageSrc: buildNaverStaticMapUrl(trip)
    };
  }

  if (hasCoordinates(trip.locationMeta)) {
    return {
      statusClass: "is-muted",
      statusText: "좌표 저장됨",
      title: "좌표는 저장되어 있습니다",
      description: "Client Secret을 서버에서만 사용하도록 설계해두어, 프록시를 연결하면 정적 지도가 바로 활성화됩니다.",
      placeholderText: "저장된 좌표를 기반으로 정적 지도 연결을 기다리고 있습니다.",
      imageSrc: ""
    };
  }

  if (hasNaverProxy()) {
    return {
      statusClass: "is-info",
      statusText: "연동 준비 완료",
      title: "장소 좌표를 자동 조회할 수 있습니다",
      description: "프록시가 연결되어 있어 좌표 갱신 버튼으로 네이버 지오코딩을 다시 실행할 수 있습니다.",
      placeholderText: "좌표를 저장하면 정적 지도와 역지오코딩 확장이 쉬워집니다.",
      imageSrc: ""
    };
  }

  if (getNaverMapsConfig().clientId) {
    return {
      statusClass: "is-muted",
      statusText: "프록시 연결 대기",
      title: "네이버 지도 API 설정은 들어가 있습니다",
      description: "Client ID와 엔드포인트는 등록했고, Client Secret은 브라우저 노출을 막기 위해 제외했습니다.",
      placeholderText: "proxyBaseUrl에 서버 경로를 넣으면 정적 지도와 지오코딩이 켜집니다.",
      imageSrc: ""
    };
  }

  return {
    statusClass: "is-warning",
    statusText: "설정 필요",
    title: "네이버 지도 API 설정이 비어 있습니다",
    description: "Client ID를 추가하면 정적 지도와 지오코딩 구조를 그대로 사용할 수 있습니다.",
    placeholderText: "네이버 지도 연동 전용 설정을 준비해두었습니다.",
    imageSrc: ""
  };
}

async function syncSelectedTripLocation() {
  const selectedTrip = getSelectedTrip();

  if (!selectedTrip) {
    return;
  }

  await syncTripLocation(selectedTrip.id, false);
}

async function syncTripLocation(tripId, forceRefresh) {
  const trip = state.trips.find((item) => item.id === tripId);

  if (!trip || !trip.locationName.trim()) {
    return;
  }

  if (!hasNaverProxy()) {
    return;
  }

  if (!forceRefresh && hasCoordinates(trip.locationMeta)) {
    return;
  }

  if (state.resolvingTripIds.has(tripId)) {
    return;
  }

  state.resolvingTripIds.add(tripId);
  delete state.locationErrors[tripId];

  if (trip.id === state.selectedTripId) {
    renderPlaceCard(trip);
  }

  try {
    const geocodedLocation = await geocodeLocationName(trip.locationName);

    if (!geocodedLocation) {
      throw new Error("위치 결과를 찾지 못했습니다.");
    }

    trip.locationMeta = normalizeLocationMeta({
      lat: geocodedLocation.lat,
      lng: geocodedLocation.lng,
      roadAddress: geocodedLocation.roadAddress,
      jibunAddress: geocodedLocation.jibunAddress,
      source: "naver-geocode",
      updatedAt: new Date().toISOString()
    });

    delete state.locationErrors[tripId];
    saveTrips();
  } catch (error) {
    state.locationErrors[tripId] = getFriendlyLocationError(error);
  } finally {
    state.resolvingTripIds.delete(tripId);
    renderApp();
  }
}

// 보안을 위해 Client Secret은 브라우저 코드에 넣지 않고, 동일 출처 프록시를 통해 REST API를 호출합니다.
// 예시:
// GET {proxyBaseUrl}/geocode?query=구매항 -> 네이버 Geocoding 원본 JSON 반환
// GET {proxyBaseUrl}/static-map?center=126.123,36.456&level=13&w=760&h=320&scale=2 -> 이미지 반환
async function geocodeLocationName(query) {
  const response = await fetchNaverProxyJson("geocode", { query });
  const addresses = Array.isArray(response.addresses) ? response.addresses : [];
  const firstAddress = addresses[0];

  if (!firstAddress) {
    return null;
  }

  const lat = toNullableNumber(firstAddress.y ?? firstAddress.lat ?? firstAddress.latitude);
  const lng = toNullableNumber(firstAddress.x ?? firstAddress.lng ?? firstAddress.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    lat,
    lng,
    roadAddress: String(firstAddress.roadAddress || firstAddress.address || ""),
    jibunAddress: String(firstAddress.jibunAddress || "")
  };
}

async function fetchNaverProxyJson(path, queryParams) {
  const url = buildNaverProxyUrl(path, queryParams);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`지도 API 요청 실패 (${response.status})`);
  }

  return response.json();
}

function buildNaverProxyUrl(path, queryParams) {
  const config = getNaverMapsConfig();
  const baseUrl = config.proxyBaseUrl;

  if (!baseUrl) {
    return "";
  }

  const searchParams = new URLSearchParams();

  Object.entries(queryParams || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  });

  const queryString = searchParams.toString();
  return `${baseUrl}/${path}${queryString ? `?${queryString}` : ""}`;
}

function buildNaverStaticMapUrl(trip) {
  if (!hasNaverProxy() || !hasCoordinates(trip.locationMeta)) {
    return "";
  }

  return buildNaverProxyUrl("static-map", {
    center: `${trip.locationMeta.lng},${trip.locationMeta.lat}`,
    level: 13,
    w: 760,
    h: 320,
    scale: 2
  });
}

function getFriendlyLocationError(error) {
  const message = String(error?.message || "");

  if (message.includes("Failed to fetch")) {
    return "지오코딩 요청에 실패했습니다. proxyBaseUrl 또는 프록시 서버 상태를 확인하세요.";
  }

  if (message.includes("지도 API 요청 실패")) {
    return "네이버 지도 프록시 응답이 정상이 아닙니다. 서버 설정을 확인하세요.";
  }

  if (message.includes("위치 결과를 찾지 못했습니다")) {
    return "장소명을 기준으로 좌표를 찾지 못했습니다. 장소명을 조금 더 구체적으로 입력해보세요.";
  }

  return "위치 정보를 가져오지 못했습니다. 프록시 설정과 장소명을 확인해보세요.";
}

function toNullableNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function openNaverMap(placeName) {
  if (!placeName) {
    return;
  }

  const url = `https://map.naver.com/p/search/${encodeURIComponent(placeName)}`;
  window.open(url, "_blank", "noopener");
}

function openKakaoMap(placeName) {
  if (!placeName) {
    return;
  }

  const url = `https://map.kakao.com/link/search/${encodeURIComponent(placeName)}`;
  window.open(url, "_blank", "noopener");
}

function scrollToForm() {
  dom.tripFormCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function formatTripDateTime(dateString, timeString) {
  const date = new Date(`${dateString}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return `${dateString} ${timeString || ""}`.trim();
  }

  const formattedDate = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(date);

  return `${formattedDate} ${timeString || ""}`.trim();
}

function formatMeetupInfo(place, time) {
  if (!place && !time) {
    return "-";
  }

  if (!place) {
    return time;
  }

  if (!time) {
    return place;
  }

  return `${place} · ${time}`;
}

function formatCurrency(value) {
  if (!value) {
    return "미정";
  }

  return `${Number(value).toLocaleString("ko-KR")}원`;
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());

  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createSeed(source) {
  return [...String(source)].reduce((total, character) => total + character.charCodeAt(0), 0);
}

function createEmptyCardMarkup(title, description) {
  return `
    <div class="empty-card">
      <p class="section-kicker">준비 중</p>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(description)}</p>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeHtmlAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function escapeHtmlTextarea(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
