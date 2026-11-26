
import "./analysis.css";
import { AnalysisEngine } from "./analysis-engine.js";
import {
  Color,
  PieceType,
  Square,
  importKIF,
  pieceTypeToStringForBoard,
  getBlackPlayerName,
  getWhitePlayerName,
} from "tsshogi";
const app = document.querySelector("#app");

if (!app) {
  throw new Error("棋譜解析画面の表示先が見つかりません。");
}

const MAX_KIF_CHARACTERS = 250_000;
const MAX_MOVE_COUNT = 3_000;
const ENGINE_STORAGE_KEY = "browser-strategy-shogi-ai-engine";
const ANALYSIS_RELOAD_STATE_KEY =
  "browser-strategy-shogi-ai-reload-state-v1";

const ENGINE_OPTIONS = Object.freeze({
  suishou: "水匠",
  mini: "つようら王11mini",
  micro: "つようら王11micro",
});

const VALID_ANALYSIS_TIMES = ["1", "3", "5"];

function getSelectedEngineId() {
  try {
    const saved = localStorage.getItem(ENGINE_STORAGE_KEY);

    return Object.hasOwn(ENGINE_OPTIONS, saved)
      ? saved
      : "suishou";
  } catch {
    return "suishou";
  }
}

const HAND_PIECES = [
  PieceType.ROOK,
  PieceType.BISHOP,
  PieceType.GOLD,
  PieceType.SILVER,
  PieceType.KNIGHT,
  PieceType.LANCE,
  PieceType.PAWN,
];

const state = {
  record: null,
  moveNodes: [],
  loadedKifuText: "",
  analysisRunning: false,
  analysisCancelled: false,
  analysisResults: [],
};

const element = (tag, className, text) => {
  const node = document.createElement(tag);

  if (className) {
    node.className = className;
  }

  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
};

// 画面の基本構造
app.innerHTML = `
  <main class="analysis-shell">

    <header class="analysis-header">
      <a class="analysis-back-link" href="./index.html">
        ← ホームに戻る
      </a>

      <h1>棋譜解析</h1>

      <p class="analysis-description">
        KIF形式の棋譜を貼り付けて、盤面と指し手を確認できます。
      </p>
    </header>

    <section class="analysis-card analysis-input-card">
      <h2>棋譜の読み込み</h2>

      <p class="analysis-input-help">
        KIF形式の棋譜テキストを貼り付けてください。
        ファイルのアップロードには対応していません。
      </p>

      <textarea
        id="kifu-input"
        class="analysis-kifu-input"
        placeholder="手合割：平手&#10;先手：先手&#10;後手：後手&#10;手数----指手---------消費時間--&#10;1 ７六歩(77)&#10;2 ３四歩(33)"
        spellcheck="false"
        aria-label="KIF棋譜テキスト"
      ></textarea>

      <div class="analysis-actions">
        <button
          type="button"
          id="load-kifu"
          class="analysis-button analysis-button--primary"
        >
          棋譜を読み込む
        </button>

        <button
          type="button"
          id="clear-kifu"
          class="analysis-button"
        >
          クリア
        </button>
      </div>

      <div
        id="analysis-notice"
        class="analysis-notice"
        role="status"
        aria-live="polite"
      >
        棋譜テキストを貼り付けてください。
      </div>
    </section>

    <div class="analysis-layout">

      <section class="analysis-card analysis-board-card">
        <h2>盤面</h2>

        <div
          id="analysis-record-meta"
          class="analysis-record-meta"
        >
          棋譜はまだ読み込まれていません。
        </div>

        <div class="analysis-board-area">

          <div id="analysis-hand-white" class="analysis-hand">
            <div class="analysis-hand-title">後手の持ち駒</div>
          </div>

          <div
            id="analysis-board"
            class="analysis-board"
            role="grid"
            aria-label="将棋盤"
          >
            <div class="analysis-placeholder">
              棋譜を読み込むと盤面が表示されます。
            </div>
          </div>

          <div id="analysis-hand-black" class="analysis-hand">
            <div class="analysis-hand-title">先手の持ち駒</div>
          </div>

        </div>

        <div class="analysis-navigation">

          <button
            type="button"
            id="goto-first"
            class="analysis-button"
            disabled
          >
            最初
          </button>

          <button
            type="button"
            id="go-back"
            class="analysis-button"
            disabled
          >
            ◀ 戻る
          </button>

          <button
            type="button"
            id="go-forward"
            class="analysis-button"
            disabled
          >
            進む ▶
          </button>

          <button
            type="button"
            id="goto-last"
            class="analysis-button"
            disabled
          >
            最後
          </button>

        </div>

        <div
          id="analysis-position-status"
          class="analysis-position-status"
          aria-live="polite"
        >
          開始局面
        </div>

      </section>

      <aside class="analysis-card analysis-move-card">
        <h2>指し手一覧</h2>

        <div
          id="analysis-move-list"
          class="analysis-move-list"
        >
          <div class="analysis-placeholder">
            棋譜を読み込むと指し手が表示されます。
          </div>
        </div>
      </aside>

    </div>

    <footer class="analysis-footer">
        <section class="analysis-card analysis-engine-card">
      <h2>AI棋譜解析</h2>

      <p class="analysis-engine-description">
        読み込んだ棋譜の各局面を、選択中のAIエンジンで順番に解析します。
      </p>

     <div class="analysis-engine-settings">
       <label for="analysis-engine-select">
         使用するエンジン
       </label>

       <select id="analysis-engine-select">
        <option value="suishou">水匠</option>
        <option value="mini">つようら王11mini</option>
        <option value="micro">つようら王11micro</option>
      </select>
    </div>

    <div class="analysis-engine-settings">
      <label for="analysis-think-time">
        1局面あたりの解析時間
      </label>

      <select id="analysis-think-time">
        <option value="1" selected>1秒</option>
        <option value="3">3秒</option>
        <option value="5">5秒</option>
      </select>
    </div>

      <div class="analysis-engine-actions">
        <button
          type="button"
          id="start-analysis"
          class="analysis-button analysis-button--primary"
          disabled
        >
          解析開始
        </button>

        <button
          type="button"
          id="stop-analysis"
          class="analysis-button"
          disabled
        >
          解析停止
        </button>
      </div>

      <div
        id="analysis-engine-status"
        class="analysis-notice"
        role="status"
        aria-live="polite"
      >
        棋譜を読み込むと解析を開始できます。
      </div>

      <div
        id="analysis-progress"
        class="analysis-progress"
      >
        解析結果はまだありません。
      </div>
    </section>
      戦型指定型将棋AI
    </footer>

  </main>
`;

const input = document.querySelector("#kifu-input");
const loadButton = document.querySelector("#load-kifu");
const clearButton = document.querySelector("#clear-kifu");

const notice = document.querySelector("#analysis-notice");
const meta = document.querySelector("#analysis-record-meta");
const board = document.querySelector("#analysis-board");
const moveList = document.querySelector("#analysis-move-list");
const positionStatus = document.querySelector(
  "#analysis-position-status"
);

const firstButton = document.querySelector("#goto-first");
const backButton = document.querySelector("#go-back");
const forwardButton = document.querySelector("#go-forward");
const lastButton = document.querySelector("#goto-last");
const engineSelect = document.querySelector("#analysis-engine-select");
const thinkTimeSelect = document.querySelector("#analysis-think-time");
const startAnalysisButton = document.querySelector("#start-analysis");
const stopAnalysisButton = document.querySelector("#stop-analysis");
const engineStatus = document.querySelector("#analysis-engine-status");
const analysisProgress = document.querySelector("#analysis-progress");
engineSelect.value = getSelectedEngineId();

const analysisEngine = new AnalysisEngine({
  onStatus: ({ message }) => {
    engineStatus.textContent = message;
  },
});
function showNotice(message, type = "") {
  notice.className = "analysis-notice";

  if (type) {
    notice.classList.add(`analysis-notice--${type}`);
  }

  notice.textContent = message;
}

function updateNavigation() {
  const record = state.record;

  const available = !!record;
  const currentPly = available ? record.current.ply : 0;
  const totalPly = available ? record.length : 0;

  firstButton.disabled = !available || currentPly === 0;
  backButton.disabled = !available || currentPly === 0;

  forwardButton.disabled =
    !available || currentPly >= totalPly;

  lastButton.disabled =
    !available || currentPly >= totalPly;
}

function renderHand(color, containerId, label) {
  const container = document.querySelector(`#${containerId}`);

  container.replaceChildren();

  container.appendChild(
    element("div", "analysis-hand-title", label)
  );

  const piecesContainer = element(
    "div",
    "analysis-hand-pieces"
  );

  const hand = state.record.position.hand(color);
  let hasPieces = false;

  for (const type of HAND_PIECES) {
    const count = hand.count(type);

    if (count <= 0) continue;

    hasPieces = true;

    piecesContainer.appendChild(
      element(
        "span",
        "",
        `${pieceTypeToStringForBoard(type)} ×${count}`
      )
    );
  }

  if (!hasPieces) {
    piecesContainer.appendChild(
      element("span", "analysis-hand-empty", "なし")
    );
  }

  container.appendChild(piecesContainer);
}

function renderBoard() {
  const position = state.record.position;
  const fragment = document.createDocumentFragment();

  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const file = 9 - col;
      const rank = row + 1;
      const piece = position.board.at(new Square(file, rank));
      const square = element(
        "div",
        `analysis-square${(row + col) % 2 ? " is-dark" : ""}`
      );

      square.setAttribute("role", "gridcell");

      square.setAttribute(
        "aria-label",
        `${file}筋${rank}段 ${
          piece
            ? `${piece.color === Color.BLACK ? "先手" : "後手"}の${pieceTypeToStringForBoard(piece.type)}`
            : "空き"
        }`
      );

      if (piece) {
        const pieceElement = element(
          "span",
          `analysis-piece${piece.color === Color.WHITE ? " is-white" : ""}`,
          pieceTypeToStringForBoard(piece.type)
        );

        square.appendChild(pieceElement);
      }

      if (row === 0 || col === 0) {
        const coordinate = element(
          "span",
          "analysis-coordinate",
          row === 0 && col === 0
            ? `${file}/${rank}`
            : row === 0
              ? String(file)
              : String(rank)
        );

        square.appendChild(coordinate);
      }

      fragment.appendChild(square);
    }
  }

  board.replaceChildren(fragment);

  renderHand(
    Color.WHITE,
    "analysis-hand-white",
    "後手の持ち駒"
  );

  renderHand(
    Color.BLACK,
    "analysis-hand-black",
    "先手の持ち駒"
  );
}

function updateMoveSelection() {
  if (!state.record) return;

  const currentPly = state.record.current.ply;

  for (const button of moveList.querySelectorAll(
    ".analysis-move-button"
  )) {
    const selected = Number(button.dataset.ply) === currentPly;

    button.classList.toggle("is-current", selected);

    if (selected) {
      button.setAttribute("aria-current", "step");
    } else {
      button.removeAttribute("aria-current");
    }
  }
}

function renderPosition() {
  if (!state.record) return;

  const record = state.record;
  const current = record.current;

  renderBoard();

  const turn =
    record.position.color === Color.BLACK ? "先手" : "後手";

  positionStatus.textContent =
    current.ply === 0
      ? `開始局面 · 手番：${turn}`
      : `${current.ply}手目 · ${current.displayText} · 次の手番：${turn}`;

  updateNavigation();
  updateMoveSelection();
}

function renderMoveList() {
  const fragment = document.createDocumentFragment();

  for (const node of state.moveNodes) {
    const button = element(
      "button",
      "analysis-move-button"
    );

    button.type = "button";
    button.dataset.ply = String(node.ply);

    const number = element(
      "span",
      "analysis-move-number",
      `${node.ply}.`
    );

    const move = element(
      "span",
      "",
      node.displayText
    );

    button.append(number, move);

    button.addEventListener("click", () => {
      state.record.goto(node.ply);
      renderPosition();

      button.scrollIntoView({
        block: "nearest",
        behavior: "auto",
      });
    });

    fragment.appendChild(button);
  }

  if (state.moveNodes.length === 0) {
    fragment.appendChild(
      element(
        "div",
        "analysis-placeholder",
        "指し手がありません。"
      )
    );
  }

  moveList.replaceChildren(fragment);
  updateMoveSelection();
}

function renderLoadedRecord() {
  const record = state.record;

  const blackName =
    getBlackPlayerName(record.metadata) || "先手";

  const whiteName =
    getWhitePlayerName(record.metadata) || "後手";

  meta.textContent =
    `${blackName}　対　${whiteName} ／ 全${record.length}手`;

  renderBoard();
  renderMoveList();
  renderPosition();
}

function loadKifu() {
  const text = input.value;

  if (!text.trim()) {
    showNotice(
      "棋譜テキストを貼り付けてください。",
      "error"
    );
    return;
  }

  if (text.length > MAX_KIF_CHARACTERS) {
    showNotice(
      `棋譜が長すぎます。${MAX_KIF_CHARACTERS.toLocaleString()}文字以内にしてください。`,
      "error"
    );
    return;
  }

  loadButton.disabled = true;
  showNotice("棋譜を読み込んでいます...");

  // Safariの画面更新を先に反映してから解析する。
  requestAnimationFrame(() => {
    try {
      const imported = importKIF(text);

      if (imported instanceof Error) {
        throw imported;
      }

      imported.goto(0);
      imported.resetAllBranchSelection();

      const nodes = imported.moves.filter(
        (node) => node.ply > 0
      );

      if (nodes.length > MAX_MOVE_COUNT) {
        throw new Error(
          `この画面では${MAX_MOVE_COUNT.toLocaleString()}手までの棋譜に対応しています。`
        );
      }

      state.record = imported;
      state.moveNodes = nodes;
      state.loadedKifuText = text;
      startAnalysisButton.disabled = false;
      state.analysisResults = [];
      renderAnalysisResults();

      renderLoadedRecord();

      showNotice(
        `棋譜を読み込みました。全${imported.length}手です。`,
        "success"
      );
    } catch (error) {
      console.error("KIF読み込みエラー:", error);

      showNotice(
        `棋譜を読み込めませんでした。${error?.message || "KIF形式を確認してください。"}`,
        "error"
      );
    } finally {
      loadButton.disabled = false;
    }
  });
}

// 前後の移動
firstButton.addEventListener("click", () => {
  if (!state.record) return;

  state.record.goto(0);
  renderPosition();
});

backButton.addEventListener("click", () => {
  if (!state.record) return;

  state.record.goBack();
  renderPosition();
});

forwardButton.addEventListener("click", () => {
  if (!state.record) return;

  state.record.goForward();
  renderPosition();
});

lastButton.addEventListener("click", () => {
  if (!state.record) return;

  state.record.goto(state.record.length);
  renderPosition();
});

// 棋譜読み込み
loadButton.addEventListener("click", loadKifu);
engineSelect.addEventListener("change", () => {
  const previousEngineId = getSelectedEngineId();
  const nextEngineId = engineSelect.value;

  if (!Object.hasOwn(ENGINE_OPTIONS, nextEngineId)) {
    engineSelect.value = previousEngineId;
    return;
  }

  if (nextEngineId === previousEngineId) return;

  const reloadState = {
    version: 1,
    inputText: input.value,
    loadedKifuText: state.loadedKifuText,
    wasLoaded: Boolean(state.record),
    thinkTime: thinkTimeSelect.value,
  };

  try {
    sessionStorage.setItem(
      ANALYSIS_RELOAD_STATE_KEY,
      JSON.stringify(reloadState)
    );

    localStorage.setItem(ENGINE_STORAGE_KEY, nextEngineId);
  } catch (error) {
    try {
      sessionStorage.removeItem(ANALYSIS_RELOAD_STATE_KEY);
    } catch {
      // 保存領域を利用できない場合は無視する。
    }

    engineSelect.value = previousEngineId;

    engineStatus.textContent =
      `エンジン設定を保存できませんでした：${error?.message || String(error)}`;

    return;
  }

  window.location.reload();
});

// 入力のクリア
clearButton.addEventListener("click", () => {
  input.value = "";

  state.record = null;
  state.moveNodes = [];
  state.loadedKifuText = "";

  meta.textContent = "棋譜はまだ読み込まれていません。";
  board.replaceChildren(
    element(
      "div",
      "analysis-placeholder",
      "棋譜を読み込むと盤面が表示されます。"
    )
  );

  moveList.replaceChildren(
    element(
      "div",
      "analysis-placeholder",
      "棋譜を読み込むと指し手が表示されます。"
    )
  );

  document.querySelector("#analysis-hand-white").replaceChildren(
    element("div", "analysis-hand-title", "後手の持ち駒")
  );

  document.querySelector("#analysis-hand-black").replaceChildren(
    element("div", "analysis-hand-title", "先手の持ち駒")
  );

  positionStatus.textContent = "開始局面";

  updateNavigation();

  showNotice("入力と読み込んだ棋譜をクリアしました。");
});

updateNavigation();

function normalizeInfoToSentePerspective(info, sentePerspectiveSign) {
  if (!info?.score || !Number.isFinite(info.score.value)) {
    return info;
  }

  return {
    ...info,
    score: {
      ...info.score,
      value: info.score.value * sentePerspectiveSign,
    },
  };
}

function formatEvaluation(info) {
  if (!info?.score || !Number.isFinite(info.score.value)) {
    return "評価値：取得できませんでした";
  }

  const { type, value } = info.score;

  if (type === "mate") {
    if (value === 0) {
      return "詰み判定（手数0）";
    }

    const winner = value > 0 ? "先手" : "後手";

    return `${winner}勝ち（詰みまで ${Math.abs(value)} 手）`;
  }

  const displayValue = value > 0 ? `+${value}` : String(value);
  const advantage =
    value > 0 ? "先手有利" :
    value < 0 ? "後手有利" :
    "互角";

  return `評価値：${displayValue} cp（${advantage}）`;
}



function collectAnalysisPositions() {
  const record = state.record;
  const originalPly = record.current.ply;
  const positions = [];

  try {
    for (let ply = 0; ply <= record.length; ply++) {
      record.goto(ply);

      positions.push({
        ply,
        sfen: record.position.sfen,
        move: ply === 0
          ? "開始局面"
          : record.current.displayText,
        sentePerspectiveSign:
          record.position.color === Color.BLACK ? 1 : -1,
      });
    }
  } finally {
    record.goto(originalPly);
    renderPosition();
  }

  return positions;
}


function renderAnalysisResults() {
  const fragment = document.createDocumentFragment();

  for (const result of state.analysisResults) {
    const item = element(
      "div",
      "analysis-progress"
    );

    const heading = element(
      "strong",
      "",
      `${result.ply}手目：${result.move}`
    );

    const evaluation = element(
      "div",
      "",
      formatEvaluation(result.info)
    );

    const bestMove = element(
      "div",
      "",
      `推奨手：${result.bestmove || "なし"}`
    );

    const depth = element(
      "div",
      "",
      `探索深さ：${result.info?.depth ?? "不明"}`
    );

    item.append(heading, evaluation, bestMove, depth);
    fragment.appendChild(item);
  }

  if (state.analysisResults.length === 0) {
    fragment.appendChild(
      element("div", "analysis-placeholder", "解析結果はまだありません。")
    );
  }

  analysisProgress.replaceChildren(fragment);
}

async function startAnalysis() {
  if (!state.record || state.analysisRunning) return;

  state.analysisRunning = true;
  state.analysisCancelled = false;
  state.analysisResults = [];

  startAnalysisButton.disabled = true;
  stopAnalysisButton.disabled = false;
  loadButton.disabled = true;
  clearButton.disabled = true;
  thinkTimeSelect.disabled = true;
  engineSelect.disabled = true;

  analysisProgress.textContent = "解析準備中です。";

  try {
    const positions = collectAnalysisPositions();
    const thinkSeconds = Number(thinkTimeSelect.value);

    engineStatus.textContent = "AIエンジンを初期化しています。";
    await analysisEngine.initialize();

    for (let index = 0; index < positions.length; index++) {
      if (state.analysisCancelled) break;

      const position = positions[index];

      engineStatus.textContent =
        `${position.ply}手目を解析しています。`;

      analysisProgress.textContent =
        `進捗：${index + 1} / ${positions.length} 局面`;

      const result = await analysisEngine.analyze(
        `position sfen ${position.sfen}`,
        thinkSeconds
      );

      if (result.cancelled || state.analysisCancelled) break;

      state.analysisResults.push({
        ply: position.ply,
        move: position.move,
        bestmove: result.bestmove,
        info: normalizeInfoToSentePerspective(
          result.info,
          position.sentePerspectiveSign
        ),
      });

      renderAnalysisResults();

      analysisProgress.insertBefore(
        element(
          "div",
          "",
          `進捗：${index + 1} / ${positions.length} 局面`
        ),
        analysisProgress.firstChild
      );
    }

    if (state.analysisCancelled) {
      engineStatus.textContent = "解析を停止しました。";
    } else {
      engineStatus.textContent =
        `解析完了：${state.analysisResults.length}局面`;
    }
  } catch (error) {
    console.error("棋譜解析エラー:", error);
    engineStatus.textContent =
      `解析エラー：${error?.message || String(error)}`;
  } finally {
    state.analysisRunning = false;
    startAnalysisButton.disabled = !state.record;
    stopAnalysisButton.disabled = true;
    loadButton.disabled = false;
    clearButton.disabled = false;
    thinkTimeSelect.disabled = false;
    engineSelect.disabled = false;
  }
}

startAnalysisButton.addEventListener("click", startAnalysis);

stopAnalysisButton.addEventListener("click", async () => {
  if (!state.analysisRunning) return;

  state.analysisCancelled = true;
  stopAnalysisButton.disabled = true;
  engineStatus.textContent = "解析を停止しています。";

  try {
    await analysisEngine.stop();
  } catch (error) {
    console.error("解析停止エラー:", error);
  }
});

function restoreAnalysisPageState() {
  let saved = null;

  try {
    const raw = sessionStorage.getItem(
      ANALYSIS_RELOAD_STATE_KEY
    );

    if (!raw) return;

    sessionStorage.removeItem(ANALYSIS_RELOAD_STATE_KEY);
    saved = JSON.parse(raw);
  } catch (error) {
    console.error("解析画面の状態復元に失敗しました:", error);
    return;
  }

  if (saved?.version !== 1) return;

  const inputText =
    typeof saved.inputText === "string"
      ? saved.inputText
      : "";

  input.value = inputText;

  if (VALID_ANALYSIS_TIMES.includes(String(saved.thinkTime))) {
    thinkTimeSelect.value = String(saved.thinkTime);
  }

  if (
    saved.wasLoaded === true &&
    typeof saved.loadedKifuText === "string" &&
    saved.loadedKifuText.trim()
  ) {
    input.value = saved.loadedKifuText;
    loadKifu();
    input.value = inputText;
  }
}

restoreAnalysisPageState();
