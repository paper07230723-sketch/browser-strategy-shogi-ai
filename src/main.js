import './style.css';
import { importKIF, pieceTypeToStringForBoard } from 'tsshogi';

const app = document.querySelector('#app');

const initialKIF = [
  '手合割：平手',
  '先手：先手',
  '後手：後手',
  '手数----指手---------消費時間--'
].join('\n');

const record = importKIF(initialKIF);
if (record instanceof Error) throw record;

const pieceNames = {
  pawn: '歩',
  lance: '香',
  knight: '桂',
  silver: '銀',
  gold: '金',
  bishop: '角',
  rook: '飛',
  king: '玉',
  promPawn: 'と',
  promLance: '杏',
  promKnight: '圭',
  promSilver: '全',
  horse: '馬',
  dragon: '龍'
};

const handTypes = [
  'rook', 'bishop', 'gold', 'silver', 'knight', 'lance', 'pawn'
];

let selectedSquare = null;
let selectedHandPiece = null;
let pendingPromotion = null;
let message = '先手の番です。動かす駒を選んでください。';
let selectedThinkTime = '0秒';
const ENGINE_CONFIGS = Object.freeze({
  suishou: {
    label: '水匠',
    scriptPath: 'engine/sse42/yaneuraou.js',
    factoryName: 'YaneuraOu_sse42',
    evalDataPath: null,
  },
  mini: {
    label: 'つようら王11mini',
    scriptPath: 'engine/tsuyouraou-mini/yaneuraou.js',
    factoryName: 'YaneuraOu_mini',
    evalDataPath: 'engine/tsuyouraou-mini/evaldata',
  },
  micro: {
    label: 'つようら王11micro',
    scriptPath: 'engine/tsuyouraou-micro/yaneuraou.js',
    factoryName: 'YaneuraOu_micro',
    evalDataPath: 'engine/tsuyouraou-micro/evaldata',
  },
});

const ENGINE_STORAGE_KEY = 'browser-strategy-shogi-ai-engine';
const GAME_SESSION_STORAGE_KEY = 'browser-strategy-shogi-ai-session';
const APP_SETTINGS_STORAGE_KEY =
  'browser-strategy-shogi-ai-settings';

const VALID_THINK_TIMES = [
  '0秒', '1秒', '2秒', '3秒', '4秒', '5秒',
];

function loadAppSettings() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(APP_SETTINGS_STORAGE_KEY)
    );

    return {
      playerColor:
        saved?.playerColor === 'white' ? 'white' : 'black',
      thinkTime:
        VALID_THINK_TIMES.includes(saved?.thinkTime)
          ? saved.thinkTime
          : '0秒',
    };
  } catch {
    return {
      playerColor: 'black',
      thinkTime: '0秒',
    };
  }
}

function saveAppSettings() {
  try {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        playerColor,
        thinkTime: selectedThinkTime,
      })
    );
    return true;
  } catch (error) {
    console.error('対局設定の保存に失敗しました:', error);
    return false;
  }
}

const savedAppSettings = loadAppSettings();

selectedThinkTime = savedAppSettings.thinkTime;

function loadSelectedEngineId() {
  try {
    const saved = localStorage.getItem(ENGINE_STORAGE_KEY);
    return Object.hasOwn(ENGINE_CONFIGS, saved) ? saved : 'suishou';
  } catch {
    return 'suishou';
  }
}

let selectedEngineId = loadSelectedEngineId();
let gameStarted = false;
let playerColor = savedAppSettings.playerColor;
let engine = null;
let engineReady = false;
let aiThinking = false;
let engineStage = 'loading';
let engineStatusText = 'AIエンジン：接続準備中';
let aiStatusText = 'AIの初期化中';
let evaluationText = '—';
let evaluationPerspectiveSign = 1;
let evaluationDepth = -1;
let moveHistory = [];
let ignoreNextBestmove = false;
let gameOver = false;
let gamePaused = false;
let pauseRequested = false;
let resumeRequestedAfterInit = false;
let pauseWatchdog = null;
function savePausedGameSession() {
  const session = {
    version: 1,
    moves: [...moveHistory],
    playerColor,
    thinkTime: selectedThinkTime,
    engineId: selectedEngineId,
    gameStarted: true,
    gamePaused: true,
  };

  try {
    localStorage.setItem(
      GAME_SESSION_STORAGE_KEY,
      JSON.stringify(session)
    );
    return true;
  } catch (error) {
    console.error('対局状態の保存に失敗しました:', error);
    return false;
  }
}

function loadPausedGameSession() {
  try {
    const raw = localStorage.getItem(GAME_SESSION_STORAGE_KEY);
    if (!raw) return null;

    const session = JSON.parse(raw);

    const validMoves =
      Array.isArray(session?.moves) &&
      session.moves.length <= 512 &&
      session.moves.every(
        (usi) =>
          typeof usi === 'string' &&
          /^(?:[1-9][a-i][1-9][a-i]\+?|[PLNSGBR]\*[1-9][a-i])$/.test(usi)
      );

    if (
      session?.version !== 1 ||
      session.gameStarted !== true ||
      session.gamePaused !== true ||
      !validMoves ||
      !['black', 'white'].includes(session.playerColor) ||
      !VALID_THINK_TIMES.includes(session.thinkTime) ||
      !Object.hasOwn(ENGINE_CONFIGS, session.engineId)
    ) {
      return null;
    }

    return session;
  } catch (error) {
    console.warn('保存された対局状態を読み込めません:', error);
    return null;
  }
}

function clearPausedGameSession() {
  try {
    localStorage.removeItem(GAME_SESSION_STORAGE_KEY);
    return true;
  } catch (error) {
    console.error('保存された対局状態の削除に失敗しました:', error);
    return false;
  }
}
function restorePausedGameSession() {
  const session = loadPausedGameSession();
  if (!session) return false;

  try {
    record.clear();

    for (const usi of session.moves) {
      const move = record.position.createMoveByUSI(usi);

      if (!move || !record.append(move)) {
        throw new Error(`棋譜を再生できません: ${usi}`);
      }
    }

    moveHistory = [...session.moves];
    playerColor = session.playerColor;
    selectedThinkTime = session.thinkTime;
    selectedEngineId = session.engineId;

    gameStarted = true;
    gamePaused = true;
    pauseRequested = false;
    resumeRequestedAfterInit = false;
    aiThinking = false;
    engineReady = false;
    engine = null;
    engineStage = 'idle';

    clearSelection();

    message =
      '対局中断中です。エンジンを変更するか「対局再開」を押してください。';
    engineStatusText = 'AIエンジン：停止中';
    aiStatusText = '対局中断中';

    return true;
  } catch (error) {
    console.error('対局状態の復元に失敗しました:', error);

    record.clear();
    moveHistory = [];
    gameStarted = false;
    gamePaused = false;
    pauseRequested = false;

    clearPausedGameSession();

    message =
      '保存された対局を復元できませんでした。新しい対局を開始してください。';

    return false;
  }
}
let gameOverTitle = '';
let gameOverDetail = '';

// 現在の手番に合法手が残っているか調べる
function hasLegalMove() {
  const position = record.position;
  const squares = position.board.squares;

  // 盤上の駒を移動する手を調べる
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const piece = squares[row * 9 + col];

      if (!piece || piece.color !== position.color) {
        continue;
      }

      const from = squareName(row, col);

      for (let toRow = 0; toRow < 9; toRow++) {
        for (let toCol = 0; toCol < 9; toCol++) {
          if (row === toRow && col === toCol) {
            continue;
          }

          const to = squareName(toRow, toCol);

          const normalMove =
            position.createMoveByUSI(from + to);

          if (
            normalMove &&
            position.isValidMove(normalMove)
          ) {
            return true;
          }

          const promotedMove =
            position.createMoveByUSI(from + to + '+');

          if (
            promotedMove &&
            position.isValidMove(promotedMove)
          ) {
            return true;
          }
        }
      }
    }
  }

  // 持ち駒を打つ手を調べる
  const dropLetters = {
    rook: 'R',
    bishop: 'B',
    gold: 'G',
    silver: 'S',
    knight: 'N',
    lance: 'L',
    pawn: 'P'
  };

  const hand = position.hand(position.color);

  for (const type of handTypes) {
    if (hand.count(type) <= 0) {
      continue;
    }

    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (squares[row * 9 + col]) {
          continue;
        }

        const usi =
          `${dropLetters[type]}*${squareName(row, col)}`;

        const move = position.createMoveByUSI(usi);

        if (move && position.isValidMove(move)) {
          return true;
        }
      }
    }
  }

  return false;
}

// 勝敗を確定する
function finishGame(winnerSource) {
  gameOver = true;
  gameStarted = false;
  aiThinking = false;
  engineStage = 'idle';
  gamePaused = false;
  pauseRequested = false;
  resumeRequestedAfterInit = false;
  clearPausedGameSession();

if (pauseWatchdog !== null) {
  clearTimeout(pauseWatchdog);
  pauseWatchdog = null;
}

  gameOverTitle =
    winnerSource === 'human'
      ? 'プレイヤーの勝ち'
      : 'AIの勝ち';

  gameOverDetail = '指せる手がありません。';

  clearSelection();

  message = gameOverTitle;
  setEngineStatus('AIエンジン：対局終了');
  setAIStatus('対局終了');

  addDiagnostic(`対局終了：${gameOverTitle}`);

  render();
}

// 終了画面から対局設定に戻る
function returnToGameSetup() {
  record.clear();
  moveHistory = [];
  setEvaluationText('—');

  clearSelection();

  gameOver = false;
  gameOverTitle = '';
  gameOverDetail = '';
  gameStarted = false;
  aiThinking = false;
  engineStage = 'idle';
  gamePaused = false;
  pauseRequested = false;
  resumeRequestedAfterInit = false;
  clearPausedGameSession();

if (pauseWatchdog !== null) {
  clearTimeout(pauseWatchdog);
  pauseWatchdog = null;
}

  message =
    '先手・後手を選んで「対局を開始」を押してください。';

  setAIStatus('対局開始待ち');
  render();
}
// 投了：対局開始前の状態に戻す
function resignGame() {
  if (!gameStarted || gamePaused || pauseRequested || gameOver) return;

  // AIが思考中なら停止し、遅れて届いた指し手を無視する
  if (aiThinking && engine) {
    ignoreNextBestmove = true;

    try {
      engine.postMessage('stop');
    } catch (error) {
      ignoreNextBestmove = false;
    }
  }

  aiThinking = false;
  engineStage = 'idle';
  gamePaused = false;
  pauseRequested = false;
  resumeRequestedAfterInit = false;
  setEvaluationText('—');
  clearPausedGameSession();

if (pauseWatchdog !== null) {
  clearTimeout(pauseWatchdog);
  pauseWatchdog = null;
}
  record.clear();
  moveHistory = [];
  clearSelection();
  gameStarted = false;

  message = '投了しました。先手・後手を選んで再び対局を開始できます。';
  setAIStatus('投了により対局終了');
  render();
}

// 待った：直前の人間とAIの着手を取り消す
function takeBack() {
  if (
  !gameStarted ||
  gamePaused ||
  pauseRequested ||
  aiThinking ||
  pendingPromotion ||
  gameOver
) {
  return;
}

  // 先手なら最低2手、後手ならAIの初手も含めて最低3手必要
  const minimumMoves = playerColor === 'black' ? 2 : 3;

  if (moveHistory.length < minimumMoves) {
    message = 'まだ取り消せる着手がありません。';
    render();
    return;
  }

  // 直前の2手を除いた棋譜を作る
  const movesToKeep = moveHistory.slice(0, -2);

  record.clear();

  // 初期局面から、残す棋譜を再生して盤面を復元する
  for (const usi of movesToKeep) {
    const move = record.position.createMoveByUSI(usi);

    if (!move || !record.append(move)) {
      record.clear();
      moveHistory = [];
      clearSelection();
      gameStarted = false;

      message = '盤面を復元できなかったため、対局を初期状態に戻しました。';
      setAIStatus('待った処理に失敗');
      render();
      return;
    }
  }

  moveHistory = movesToKeep;
  setEvaluationText('—');
  clearSelection();

  message = '直前のプレイヤーとAIの着手を取り消しました。';
  setAIStatus('待ったを適用しました');
  render();
}
const DIAGNOSTIC_STORAGE_KEY =
  'browser-strategy-shogi-ai-diagnostics-v1';

function loadDiagnosticState() {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(DIAGNOSTIC_STORAGE_KEY) || 'null'
    );

    if (
      saved &&
      Number.isInteger(saved.bootCount) &&
      Array.isArray(saved.entries)
    ) {
      return saved;
    }
  } catch (error) {
    // 保存データを読み込めない場合は新規に開始する。
  }

  return {
    bootCount: 0,
    entries: []
  };
}

const diagnosticState = loadDiagnosticState();
diagnosticState.bootCount += 1;

function addDiagnostic(message) {
  const time = new Date().toLocaleTimeString('ja-JP', {
    hour12: false
  });

  diagnosticState.entries.push(
    `[起動${diagnosticState.bootCount} ${time}] ${message}`
  );

  // 直近16件だけを保持する。
  diagnosticState.entries =
    diagnosticState.entries.slice(-16);

  try {
    window.localStorage.setItem(
      DIAGNOSTIC_STORAGE_KEY,
      JSON.stringify(diagnosticState)
    );
  } catch (error) {
    // 保存できなくても、現在の画面には表示する。
  }

  const logElement = document.querySelector('#diagnostic-log');

  if (logElement) {
    logElement.textContent =
      diagnosticState.entries.join('\n');
  }
}

const navigationEntry =
  performance.getEntriesByType('navigation')[0];

addDiagnostic(
  `ページ起動; 種別=${navigationEntry?.type ?? '不明'}; ` +
  `クロスオリジン分離=${window.crossOriginIsolated}; ` +
  `SharedArrayBuffer=${typeof SharedArrayBuffer}; ` +
  `Service Worker=${
    navigator.serviceWorker?.controller
      ? 'controllerあり'
      : 'controllerなし'
  }`
);
function setEngineStatus(text) {
  engineStatusText = text;
  const element = document.querySelector('#engine-status');
  if (element) element.textContent = text;
}

function setAIStatus(text) {
  aiStatusText = text;
  const element = document.querySelector('#move-information');

  if (element) {
    element.innerHTML = `
      <p>手数：${Math.max(0, record.length - 1)}</p>
      <p>評価値（先手視点・歩=100点）：<span id="evaluation-value">${evaluationText}</span></p>
      <p>AI状態：${aiStatusText}</p>
    `;
  }
}

function setEvaluationText(text) {
  evaluationText = text;
  const element = document.querySelector('#evaluation-value');

  if (element) {
    element.textContent = text;
  }
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function squareName(row, col) {
  return `${9 - col}${String.fromCharCode(97 + row)}`;
}

function getPiece(row, col) {
  return record.position.board.squares[row * 9 + col];
}

function isCurrentPlayerPiece(piece) {
  return piece && piece.color === record.position.color;
}

function currentPlayerName() {
  return record.position.color === 'black' ? '先手' : '後手';
}

function handFor(color) {
  return record.position.hand(color);
}

function clearSelection() {
  selectedSquare = null;
  selectedHandPiece = null;
  pendingPromotion = null;
}

function finishMove() {
  clearSelection();
  message = `${currentPlayerName()}の番です。動かす駒を選んでください。`;
  render();
}

function commitMove(move, usi, source = 'human') {
  if (gamePaused || pauseRequested) {
  return false;
}
  if (!move || !record.position.isValidMove(move)) {
    message = 'その手は指せません。別のマスを選んでください。';
    render();
    return false;
  }

  if (!record.append(move)) {
    message = 'その手を記録できませんでした。';
    render();
    return false;
  }

  moveHistory.push(usi);

  // 着手後、次の手番に合法手がなければ対局終了
  if (!hasLegalMove()) {
    finishGame(source);
    return true;
  }

  finishMove();

  // プレイヤーの着手後は、AIに応手させる
  if (source === 'human' && engineReady && gameStarted) {
    requestAiMove();
  }

  return true;
}

function moveFromSquare(fromRow, fromCol, toRow, toCol, promote) {
  const from = squareName(fromRow, fromCol);
  const to = squareName(toRow, toCol);
  const usi = from + to + (promote ? '+' : '');
  const move = record.position.createMoveByUSI(usi);
  return commitMove(move, usi);
}

function isPromotablePiece(piece) {
  return piece && [
    'pawn', 'lance', 'knight', 'silver', 'bishop', 'rook'
  ].includes(piece.type);
}

function canPromote(fromRow, toRow, piece) {
  if (!isPromotablePiece(piece)) return false;

  // tsshogiではblackが先手、whiteが後手。
  const zoneReached = piece.color === 'black'
    ? fromRow <= 2 || toRow <= 2
    : fromRow >= 6 || toRow >= 6;

  return zoneReached;
}

function mustPromote(toRow, piece) {
  if (!piece) return false;

  // 先手（black）は盤面の上方向へ進む。
  if (piece.color === 'black') {
    if (piece.type === 'pawn' || piece.type === 'lance') {
      return toRow === 0;
    }
    if (piece.type === 'knight') {
      return toRow <= 1;
    }
  }

  // 後手（white）は盤面の下方向へ進む。
  if (piece.color === 'white') {
    if (piece.type === 'pawn' || piece.type === 'lance') {
      return toRow === 8;
    }
    if (piece.type === 'knight') {
      return toRow >= 7;
    }
  }

  return false;
}
function completePause() {
  if (pauseWatchdog !== null) {
    clearTimeout(pauseWatchdog);
    pauseWatchdog = null;
  }

  pauseRequested = false;
  aiThinking = false;
  engineStage = 'idle';
  gamePaused = true;

  clearSelection();

  if (!savePausedGameSession()) {
    gamePaused = false;

    message = '対局状態を保存できませんでした。中断を取り消します。';
    setEngineStatus('AIエンジン：対局を継続');
    setAIStatus('保存失敗');

    render();

    if (engineReady && record.position.color !== playerColor) {
      requestAiMove();
    }

    return false;
  }

  message = '対局を中断しました。エンジンを変更するか、対局を再開できます。';
  setEngineStatus('AIエンジン：停止確認済み');
  setAIStatus('対局中断中');

  render();
  return true;
}

function pauseGame() {
  if (!gameStarted || gameOver || gamePaused) return;

  clearSelection();

  if (!aiThinking) {
    completePause();
    return;
  }

  if (!engine) {
    message = 'エンジンの停止を確認できません。';
    render();
    return;
  }

  pauseRequested = true;
  message = 'AIエンジンの停止を待っています。';

  try {
    engine.postMessage('stop');
  } catch (error) {
  pauseRequested = false;
  message = `停止指示に失敗しました：${error.message}`;
  setEngineStatus('AIエンジン：停止指示失敗');
  render();
  return;
}

  if (pauseWatchdog !== null) {
    clearTimeout(pauseWatchdog);
  }

  pauseWatchdog = window.setTimeout(() => {
  if (!pauseRequested) return;

  pauseRequested = false;
  pauseWatchdog = null;

  message =
    '停止応答がありません。AIの思考は継続中です。「対局を中断」を押して再試行してください。';

  setEngineStatus('AIエンジン：停止応答待ち（再試行可能）');
  render();
}, 15000);

  render();
}
function resumeGame() {
  if (!gameStarted || !gamePaused || gameOver) return;

  if (!engineReady || !engine) {
  if (resumeRequestedAfterInit) return;

  resumeRequestedAfterInit = true;
    message = 'エンジンを起動しています。';
    setEngineStatus('AIエンジン：再接続中');
    setAIStatus('対局再開準備中');
    render();

    void startEngineSafely({ resumePausedGame: true });
    return;
  }

  if (!clearPausedGameSession()) {
  resumeRequestedAfterInit = false;
  message = '保存データを削除できないため、再開を中止しました。';
  render();
  return;
}

  if (pauseWatchdog !== null) {
    clearTimeout(pauseWatchdog);
    pauseWatchdog = null;
  }

  gamePaused = false;
  pauseRequested = false;
  resumeRequestedAfterInit = false;

  message = `${currentPlayerName()}の番です。`;

  setEngineStatus('AIエンジン：接続成功');
  setAIStatus('対局再開');

  if (record.position.color !== playerColor) {
    requestAiMove();
  } else {
    render();
  }
}
function handleSquareClick(row, col) {
  if (gameOver || gamePaused || pauseRequested) return;
  if (!gameStarted) {
  message = engineReady
    ? '「AIの初手を開始」を押してください。'
    : 'AIエンジンの準備中です。';

  render();
  return;
}
  if (aiThinking || record.position.color !== playerColor) {
  message = aiThinking
    ? 'AIの思考中です。'
    : 'AIの番です。応手をお待ちください。';

  render();
  return;
}
  if (pendingPromotion) return;

  const piece = getPiece(row, col);

  if (selectedHandPiece) {
    if (piece) {
      if (isCurrentPlayerPiece(piece)) {
        message = '持ち駒を打つ場合は空いているマスを選んでください。';
        render();
      }
      return;
    }

      const usiPiece = {
        pawn: 'P',
        lance: 'L',
        knight: 'N',
        silver: 'S',
        gold: 'G',
        bishop: 'B',
        rook: 'R'
      }[selectedHandPiece];

      const usi = `${usiPiece}*${squareName(row, col)}`;
      const move = record.position.createMoveByUSI(usi);
    commitMove(move,usi);
    return;
  }

    if (!selectedSquare) {
    if (isCurrentPlayerPiece(piece)) {
      selectedSquare = { row, col };
      message = '移動先のマスを選んでください。';
    } else {
      message = '動かす側の駒を選んでください。';
    }
    render();
    return;
  }

  if (selectedSquare.row === row && selectedSquare.col === col) {
    clearSelection();
    message = '駒の選択を解除しました。';
    render();
    return;
  }

  if (isCurrentPlayerPiece(piece)) {
    selectedSquare = { row, col };
    message = '移動先のマスを選んでください。';
    render();
    return;
  }

  const from = selectedSquare;
  const movingPiece = getPiece(from.row, from.col);

  if (!movingPiece) {
    clearSelection();
    render();
    return;
  }

    const fromSquare = squareName(from.row, from.col);
  const toSquare = squareName(row, col);

  if (canPromote(from.row, row, movingPiece)) {
    const normalMove = record.position.createMoveByUSI(
      fromSquare + toSquare
    );
    const promotedMove = record.position.createMoveByUSI(
      fromSquare + toSquare + '+'
    );

    const normalValid =
      normalMove != null &&
      record.position.isValidMove(normalMove);

    const promoteValid =
      promotedMove != null &&
      record.position.isValidMove(promotedMove);

    if (promoteValid) {
      pendingPromotion = {
        from,
        to: { row, col },
        normalValid
      };

      message = normalValid
        ? '成りますか？'
        : 'この移動では成る必要があります。';

      render();
      return;
    }
  }

  moveFromSquare(
    from.row,
    from.col,
    row,
    col,
    mustPromote(row, movingPiece)
  );
}

function selectHandPiece(color, type) {
  if (
  !gameStarted ||
  gamePaused ||
  pauseRequested ||
  aiThinking ||
  gameOver
) {
  return;
}
  if (color !== record.position.color) {
    message = '自分の番の持ち駒を選んでください。';
    render();
    return;
  }

  if (handFor(color).count(type) <= 0) return;

// 選択中の持ち駒をもう一度押したら選択解除
if (selectedHandPiece === type) {
  selectedHandPiece = null;
  message = '持ち駒の選択を解除しました。';
  render();
  return;
}

  selectedSquare = null;
  selectedHandPiece = type;
  pendingPromotion = null;
  message = `${pieceNames[type]}を打つ場所を選んでください。`;
  render();
}

function createHand(color, label) {
  const section = makeElement('section', 'hand-area');
  section.appendChild(makeElement('h3', '', `${label}の持ち駒`));

  const pieces = makeElement('div', 'hand-pieces');
  const hand = handFor(color);
  let hasPiece = false;

  for (const type of handTypes) {
    const count = hand.count(type);
    if (count <= 0) continue;

    hasPiece = true;
    const button = makeElement(
      'button',
      'hand-piece',
      `${pieceNames[type]} ×${count}`
    );
    button.type = 'button';
    button.disabled =
  color !== record.position.color ||
  color !== playerColor ||
  !gameStarted ||
  gamePaused ||
  pauseRequested ||
  aiThinking ||
  gameOver;

    if (selectedHandPiece === type && color === record.position.color) {
      button.classList.add('selected');
    }

    button.addEventListener('click', () => selectHandPiece(color, type));
    pieces.appendChild(button);
  }

  if (!hasPiece) {
    pieces.appendChild(makeElement('span', 'empty-hand', 'なし'));
  }

  section.appendChild(pieces);
  return section;
}

function createBoard() {
  const board = makeElement('div', 'board');

  // 後手を選んだ場合は盤面を180度回転する
  board.style.transform =
    playerColor === 'white' ? 'rotate(180deg)' : '';

  const squares = record.position.board.squares;

  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const square = makeElement('button', 'square');
      square.type = 'button';
      square.setAttribute('aria-label', `${9 - col}筋 ${row + 1}段`);

      square.disabled =
        !gameStarted ||
        gamePaused ||
        pauseRequested ||
        gameOver ||
        aiThinking ||
        record.position.color !== playerColor;

      if (
        selectedSquare &&
        selectedSquare.row === row &&
        selectedSquare.col === col
      ) {
        square.classList.add('selected');
      }

      const piece = squares[row * 9 + col];

      if (piece) {
        const pieceElement = makeElement(
          'span',
          'piece',
          pieceNames[piece.type] ?? pieceTypeToStringForBoard(piece.type)
        );

        // 後手の駒の文字を180度回転する
        if (piece.color === 'white') {
          pieceElement.classList.add('gote');
        }

        square.appendChild(pieceElement);
      }

      square.addEventListener('click', () => handleSquareClick(row, col));
      board.appendChild(square);
    }
  }

  return board;
}

function createApp() {
  const container = makeElement('main', 'container');
  container.appendChild(makeElement('h1', '', '戦型指定型将棋AI'));
  container.appendChild(makeElement('p', 'subtitle', '駒の移動テスト版'));

  const status = makeElement('section', 'status');
  status.innerHTML = `
    <h2>システム診断</h2>
    <p id="browser-status"></p>
    <p id="base-status"></p>
    <p id="engine-status">${engineStatusText}</p>
    <p id="isolation-status"></p>
    <p id="wasm-status"></p>
    <p id="diagnostic-boot"></p>
<pre id="diagnostic-log" style="white-space: pre-wrap; overflow-wrap: anywhere; max-height: 16rem; overflow-y: auto; font-size: 12px;"></pre>
  `;
  container.appendChild(status);

  const controls = makeElement('section', 'controls');
  controls.innerHTML = `
    <label>手番
      <select id="turn-select">
        <option value="black">先手</option>
        <option value="white">後手</option>
      </select>
    </label>
    <label>戦型
      <select>
        <option>指定なし</option>
        <option>右四間飛車</option>
      </select>
    </label>
    <label>エンジン
  <select id="engine-select">
    <option value="suishou">水匠</option>
    <option value="mini">つようら王11mini</option>
    <option value="micro">つようら王11micro</option>
  </select>
</label>
    <label>思考時間
      <select id="think-time-select">
        <option>0秒</option>
        <option>1秒</option>
        <option>2秒</option>
        <option>3秒</option>
        <option>4秒</option>
        <option>5秒</option>
       </select>
    </label>
  `;

  const engineSelect = controls.querySelector('#engine-select');

engineSelect.value = selectedEngineId;
engineSelect.disabled =
  (gameStarted && !gamePaused) || resumeRequestedAfterInit || pauseRequested || ignoreNextBestmove || gameOver;

engineSelect.addEventListener('change', () => {
  if ((gameStarted && !gamePaused) || resumeRequestedAfterInit || pauseRequested || ignoreNextBestmove || gameOver) {
    engineSelect.value = selectedEngineId;
    return;
  }

  const nextEngineId = engineSelect.value;
  const previousEngineId = selectedEngineId;

  if (!Object.hasOwn(ENGINE_CONFIGS, nextEngineId)) {
    engineSelect.value = selectedEngineId;
    return;
  }

  try {
    localStorage.setItem(ENGINE_STORAGE_KEY, nextEngineId);
  } catch (error) {
    message = 'エンジン設定を保存できませんでした。';
    engineSelect.value = selectedEngineId;
    render();
    return;
  }

  selectedEngineId = nextEngineId;

  if (gamePaused && !savePausedGameSession()) {
  selectedEngineId = previousEngineId;
  engineSelect.value = previousEngineId;

  try {
    localStorage.setItem(ENGINE_STORAGE_KEY, previousEngineId);
  } catch (error) {
    console.error('エンジン設定の復元に失敗しました:', error);
  }

  message = '中断中の対局状態を保存できませんでした。';
  render();
  return;
}

  window.location.reload();
});

  const thinkTimeSelect = controls.querySelector('#think-time-select');

thinkTimeSelect.value = selectedThinkTime;
thinkTimeSelect.disabled =
  (gameStarted && !gamePaused) ||
  resumeRequestedAfterInit ||
  pauseRequested ||
  gameOver;

thinkTimeSelect.addEventListener('change', () => {
  if (
    (gameStarted && !gamePaused) ||
    resumeRequestedAfterInit ||
    pauseRequested ||
    gameOver
  ) {
    thinkTimeSelect.value = selectedThinkTime;
    return;
  }

  selectedThinkTime = thinkTimeSelect.value;

  saveAppSettings();

  if (gamePaused) {
    if (!savePausedGameSession()) {
      message = '中断中の対局設定を保存できませんでした。';
      render();
    }
  }
});
const turnSelect = controls.querySelector('#turn-select');

turnSelect.value = playerColor;
turnSelect.disabled = gameStarted || aiThinking || gameOver;

turnSelect.addEventListener('change', () => {
  if (gameStarted || aiThinking || gameOver) return;

  playerColor = turnSelect.value;
  saveAppSettings();

  message = `${playerColor === 'black' ? '先手' : '後手'}を選択しました。`;
  render();
});
  container.appendChild(controls);

  const startAiButton = makeElement(
  'button',
  'start-ai-button',
  gameStarted
    ? (gamePaused ? '対局再開' : '対局を中断')
    : '対局を開始'
);

startAiButton.type = 'button';
startAiButton.disabled =
  gameOver ||
  ignoreNextBestmove ||
  resumeRequestedAfterInit ||
  (gameStarted
    ? pauseRequested
    : (!engineReady || aiThinking));

startAiButton.addEventListener('click', () => {
  if (gameOver) return;

  if (gameStarted) {
    if (gamePaused) {
      resumeGame();
    } else if (!pauseRequested) {
      pauseGame();
    }
    return;
  }

  if (!engineReady || aiThinking || ignoreNextBestmove) return;

  setEvaluationText('—');
  gameStarted = true;

  if (record.position.color === playerColor) {
    message = `${playerColor === 'black' ? '先手' : '後手'}の番です。駒を選んでください。`;
    render();
    return;
  }

  message = 'AIが初手を考えています。';
  render();
  requestAiMove();
});

container.appendChild(startAiButton);

  if (playerColor === 'white') {
  // プレイヤーが後手なら、上側は先手の持ち駒
  container.appendChild(createHand('black', '先手'));
} else {
  // プレイヤーが先手なら、上側は後手の持ち駒
  container.appendChild(createHand('white', '後手'));
}
  container.appendChild(makeElement('h2', '', '盤面'));
  container.appendChild(makeElement('p', 'move-message', message));
  const boardArea = makeElement('div', 'board-area');
boardArea.appendChild(createBoard());

if (gameOver) {
  const overlay = makeElement('section', 'game-over-overlay');

  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'assertive');

  overlay.appendChild(
    makeElement('h2', 'game-over-title', gameOverTitle)
  );

  overlay.appendChild(
    makeElement('p', 'game-over-detail', gameOverDetail)
  );

  const returnButton = makeElement(
    'button',
    'game-over-button',
    '対局設定に戻る'
  );

  returnButton.type = 'button';
  returnButton.addEventListener('click', returnToGameSetup);

  overlay.appendChild(returnButton);
  boardArea.appendChild(overlay);
}

container.appendChild(boardArea);
  if (playerColor === 'white') {
  // プレイヤーが後手なら、下側は後手の持ち駒
  container.appendChild(createHand('white', '後手'));
} else {
  // プレイヤーが先手なら、下側は先手の持ち駒
  container.appendChild(createHand('black', '先手'));
}
const waitButton = makeElement('button', 'wait-button', '待った');
waitButton.type = 'button';

waitButton.disabled =
  !gameStarted ||
  gamePaused ||
  pauseRequested ||
  aiThinking ||
  pendingPromotion ||
  moveHistory.length < (playerColor === 'black' ? 2 : 3) ||
  gameOver;

waitButton.addEventListener('click', takeBack);
container.appendChild(waitButton);
  const information = makeElement('section', 'information');
  information.id = 'move-information';
  information.innerHTML = `
    <p>手数：${Math.max(0, record.length - 1)}</p>
    <p>評価値（先手視点・歩=100点）：<span id="evaluation-value">${evaluationText}</span></p>
    <p>AI状態：${aiStatusText}</p>
  `;
  container.appendChild(information);

  if (pendingPromotion) {
    const choices = makeElement('div', 'promotion-choices');
    choices.appendChild(makeElement('span', '', '成りを選択：'));

    const promoteButton = makeElement('button', '', '成る');
    promoteButton.type = 'button';
    promoteButton.addEventListener('click', () => {
      const pending = pendingPromotion;
      pendingPromotion = null;
      moveFromSquare(
        pending.from.row,
        pending.from.col,
        pending.to.row,
        pending.to.col,
        true
      );
    });
    choices.appendChild(promoteButton);

        if (pendingPromotion.normalValid) {
      const normalButton = makeElement('button', '', '成らない');
      normalButton.type = 'button';
      normalButton.addEventListener('click', () => {
        const pending = pendingPromotion;
        pendingPromotion = null;
        moveFromSquare(
          pending.from.row,
          pending.from.col,
          pending.to.row,
          pending.to.col,
          false
        );
      });
      choices.appendChild(normalButton);
    }

    // 駒を移動させず、成りの選択を取り消す
    const cancelButton = makeElement('button', '', 'キャンセル');
    cancelButton.type = 'button';
    cancelButton.addEventListener('click', () => {
      clearSelection();
      message = '駒の移動をキャンセルしました。';
      render();
    });
    choices.appendChild(cancelButton);

    boardArea.appendChild(choices);
  }

  const resignButton = makeElement('button', 'resign-button', '投了');
resignButton.type = 'button';
resignButton.disabled =
  !gameStarted ||
  gamePaused ||
  pauseRequested ||
  gameOver;

resignButton.addEventListener('click', resignGame);

container.appendChild(resignButton);

// 以前のリセットボタンと同じ位置に配置する
container.insertBefore(
  resignButton,
  container.querySelector('.hand-area')
);

return container;
}

function render() {
  app.replaceChildren(createApp());

  document.querySelector('#browser-status').textContent =
    `ブラウザ：${navigator.userAgent.includes('Safari') ? 'Safari系ブラウザ' : '確認済み'}`;

  document.querySelector('#base-status').textContent =
    `ページベース：${import.meta.env.BASE_URL}`;

  document.querySelector('#isolation-status').textContent =
    `クロスオリジン分離：${window.crossOriginIsolated ? '有効' : '無効'}`;

  document.querySelector('#wasm-status').textContent =
    `SharedArrayBuffer：${typeof SharedArrayBuffer !== 'undefined' ? '利用可能' : '利用不可'}`;
    const diagnosticBoot = document.querySelector('#diagnostic-boot');

if (diagnosticBoot) {
  diagnosticBoot.textContent =
    `起動回数（保存データ）：${diagnosticState.bootCount}`;
}

const diagnosticLog = document.querySelector('#diagnostic-log');

if (diagnosticLog) {
  diagnosticLog.textContent =
    diagnosticState.entries.join('\n');
}
}
restorePausedGameSession();
render();

function applyEngineMove(usiMove) {
  const move = record.position.createMoveByUSI(usiMove);

  if (!move || !record.position.isValidMove(move)) {
    setEngineStatus(`AIの指し手を反映できませんでした：${usiMove}`);
    setAIStatus('指し手の反映に失敗');
    render();
    return false;
  }

  const applied = commitMove(move, usiMove, 'ai');

  if (applied && !gameOver) {
  setEngineStatus(`AIの指し手を反映しました：${usiMove}`);
  setAIStatus('AIが1手指しました');
}

  return applied;
}

function requestAiMove() {
  if (
    !engineReady ||
    !engine ||
    aiThinking ||
    gamePaused ||
    pauseRequested ||
    gameOver
  ) {
    return;
  }

  evaluationPerspectiveSign =
    record.position.color === 'black' ? 1 : -1;
  evaluationDepth = -1;
  setEvaluationText('—');

  aiThinking = true;
  engineStage = 'thinking';

  setEngineStatus('AIエンジン：思考中...');
  setAIStatus('AIが指し手を探索中');
  render();

  try {
    const positionCommand = moveHistory.length > 0
      ? `position startpos moves ${moveHistory.join(' ')}`
      : 'position startpos';

    const selectedTime = Number.parseInt(selectedThinkTime, 10);

    engine.postMessage(positionCommand);

    if (selectedTime > 0) {
      engine.postMessage(`go movetime ${selectedTime * 1000}`);
    } else {
      engine.postMessage('go depth 1');
    }
  } catch (error) {
    aiThinking = false;
    engineStage = 'idle';

    setEngineStatus(
      `AIへの思考指示に失敗：${error.message || '詳細はコンソールを確認'}`
    );
    setAIStatus('思考開始に失敗');
    render();
  }
}

window.addEventListener('error', (event) => {
  const target = event.target;
  const targetSrc = target?.src || '';
  const filename = event.filename || '';
  const message = event.message || '';

  // エンジンの読み込みエラーと、実行時エラーを記録する。
  if (
    targetSrc.includes('yaneuraou.js') ||
    filename.includes('yaneuraou.js') ||
    message.includes('YaneuraOu') ||
    target === window
  ) {
    addDiagnostic(
      `ブラウザerrorイベント: ` +
      `target=${target?.tagName || 'window'}; ` +
      `src=${targetSrc || 'なし'}; ` +
      `message=${message || 'なし'}; ` +
      `file=${filename || 'なし'}; ` +
      `line=${event.lineno || 0}; ` +
      `column=${event.colno || 0}; ` +
      `error=${event.error?.stack || event.error?.message || '詳細なし'}`
    );
  }
}, true);

// PromiseやWASMの非同期処理で発生した未処理エラーも記録する。
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;

  addDiagnostic(
    `未処理Promiseエラー: ${
      reason?.stack || reason?.message || String(reason)
    }`
  );
});

async function connectEngine() {
  try {
    addDiagnostic('エンジン接続処理開始');
    setEngineStatus('AIエンジン：JavaScript読み込み中...');

  const engineConfig = ENGINE_CONFIGS[selectedEngineId];

const scriptUrl = new URL(
  `${import.meta.env.BASE_URL}${engineConfig.scriptPath}`,
  window.location.origin
).href;

addDiagnostic(`エンジンJS読み込み開始: ${scriptUrl}`);

if (typeof window[engineConfig.factoryName] !== 'function') {
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;

    const timeoutId = window.setTimeout(() => {
      script.onload = null;
      script.onerror = null;
      script.remove();
      reject(
        new Error('エンジンJSの読み込みが30秒でタイムアウトしました')
      );
    }, 30000);

    script.onload = () => {
      window.clearTimeout(timeoutId);
      script.remove();
      resolve();
    };

    script.onerror = () => {
      window.clearTimeout(timeoutId);
      script.remove();
      reject(
        new Error(`エンジンJSの読み込みに失敗しました: ${scriptUrl}`)
      );
    };

    document.head.appendChild(script);
  });
}

const factoryType = typeof window[engineConfig.factoryName];

addDiagnostic(
  `script要素読み込み後の初期化関数の型=${factoryType}`
);

if (factoryType !== 'function') {
  throw new Error(
    'script要素読み込み後もエンジン初期化関数が見つかりません'
  );
}

    setEngineStatus('AIエンジン：WASM初期化中...');
    addDiagnostic('WASM初期化開始');

    let timeoutId;

    try {
      const initPromise = window[engineConfig.factoryName]({
  locateFile: (file) => new URL(file, scriptUrl).href,
});

      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
          addDiagnostic('WASM初期化が30秒でタイムアウト');

          reject(
            new Error(
              'WASMの初期化が30秒以内に完了しませんでした'
            )
          );
        }, 30000);
      });

      engine = await Promise.race([
        initPromise,
        timeoutPromise
      ]);
    } finally {
      window.clearTimeout(timeoutId);
    }

    addDiagnostic('WASM初期化成功');

    if (engineConfig.evalDataPath) {
  if (!engine.FS?.writeFile) {
    throw new Error('WASMのファイルシステムを利用できません。');
  }

  try {
    engine.FS.stat('/evaldata');
  } catch {
    engine.FS.mkdir('/evaldata');
  }

  const evalFiles = [
    'nn.bin',
    'progress.bin',
    'eval_options.txt',
    'tag.json',
  ];

  for (const file of evalFiles) {
    const url = new URL(
      `${import.meta.env.BASE_URL}${engineConfig.evalDataPath}/${file}`,
      window.location.origin
    ).href;

    const response = await fetch(url, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(
        `評価ファイルの取得に失敗しました: ${file} (HTTP ${response.status})`
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());

    if (bytes.length === 0) {
      throw new Error(`評価ファイルが空です: ${file}`);
    }

    engine.FS.writeFile(`/evaldata/${file}`, bytes);

    addDiagnostic(
      `評価ファイル読み込み成功: ${file} (${bytes.length} bytes)`
    );
  }
}

    engineStage = 'usi';
    addDiagnostic('USI応答の待機を開始');

    engine.addMessageListener((line) => {
      const received = String(line).trim();
      console.log('[USI]', received);

      if (engineStage === 'thinking' && received.startsWith('info ')) {
        const depthMatch = received.match(/\bdepth\s+(\d+)\b/);
        const multiPvMatch = received.match(/\bmultipv\s+(\d+)\b/);
        const scoreMatch = received.match(/\bscore\s+(cp|mate)\s+(-?\d+)\b/);
        const hasBound = /\b(?:lowerbound|upperbound)\b/.test(received);

        if (
          depthMatch &&
          (!multiPvMatch || Number(multiPvMatch[1]) === 1) &&
          scoreMatch &&
          !hasBound
        ) {
          const depth = Number(depthMatch[1]);

          if (Number.isSafeInteger(depth) && depth >= evaluationDepth) {
            evaluationDepth = depth;
            const score =
              Number(scoreMatch[2]) * evaluationPerspectiveSign;

            if (scoreMatch[1] === 'cp') {
              const formatted =
                (score > 0 ? '+' : '') + String(score);

              setEvaluationText(formatted);
            } else {
              const rawMateText = scoreMatch[2];
              const rawMate = Number(rawMateText);
              const engineWins = !rawMateText.startsWith('-');
              const senteWins = engineWins
                ? evaluationPerspectiveSign === 1
                : evaluationPerspectiveSign === -1;
              const mateDescription = rawMateText === '-0'
                ? 'エンジン側は既に詰み'
                : `エンジン視点のUSI mate値 ${rawMate > 0 ? '+' : ''}${rawMate}`;

              setEvaluationText(
                (senteWins ? '先手勝ち' : '後手勝ち') +
                `（${mateDescription}）`
              );
            }
          }
        }
      }
  if (received.startsWith('bestmove') && ignoreNextBestmove) {
  ignoreNextBestmove = false;

  addDiagnostic('投了後の停止応答を確認。指し手を無視しました。');

  message = 'AIエンジンの停止を確認しました。新しい対局を開始できます。';
  render();
  return;
}
      if (engineStage === 'usi' && received.includes('usiok')) {
        engineStage = 'ready';

        addDiagnostic('USI応答: usiok');

        setEngineStatus(
          'AIエンジン：準備完了を確認中...'
        );

        engine.postMessage('setoption name USI_Hash value 16');

        if (engineConfig.evalDataPath) {
          engine.postMessage('setoption name Threads value 4');
          engine.postMessage('setoption name EvalDir value evaldata');
          engine.postMessage('setoption name FV_SCALE value 24');
          engine.postMessage('setoption name MinimumThinkingTime value 1');
          engine.postMessage('setoption name RoundUpToFullSecond value false');
        }

        engine.postMessage('isready');

      

        addDiagnostic('USIコマンド送信: isready');
        return;
      }

      if (
        engineStage === 'ready' &&
        received.includes('readyok')
      ) {
        engineStage = 'idle';
        engineReady = true;

        addDiagnostic('USI応答: readyok。エンジン準備完了');

        setEngineStatus('AIエンジン：接続成功');
        setAIStatus('AIの準備完了');
        if (resumeRequestedAfterInit) {
          resumeGame();
          return;
        }

        render();
        return;
      }

      if (
        engineStage === 'thinking' &&
        received.startsWith('bestmove')
      ) {
        const match = received.match(/^bestmove\s+(\S+)/);
        const usiMove = match?.[1];

        aiThinking = false;
        engineStage = 'idle';
        if (pauseRequested) {
          addDiagnostic('中断要求後のbestmoveを受信。指し手を反映せず停止します。');
          completePause();
          return;
        }
        if (
          !usiMove ||
          ['resign', 'win', '(none)'].includes(usiMove)
        ) {
          addDiagnostic(`通常の指し手を受信できず: ${received}`);

          setEngineStatus(
            `AIが通常の指し手を返しませんでした：${received}`
          );

          setAIStatus('指し手なし');
          render();
          return;
        }

        addDiagnostic(`AIの指し手を受信: ${usiMove}`);
        applyEngineMove(usiMove);
      }
    });

    engine.postMessage('usi');
    addDiagnostic('USIコマンド送信: usi');
  } catch (error) {
    aiThinking = false;
    engineReady = false;
    resumeRequestedAfterInit = false;

    const errorMessage =
      error?.message || String(error);

    addDiagnostic(`エンジン接続エラー: ${errorMessage}`);

    console.error('AIエンジン接続エラー:', error);

    setEngineStatus(
      `AIエンジン：接続失敗（${errorMessage}）`
    );

    setAIStatus('エンジン接続に失敗');
    render();
  }
}
async function startEngineSafely({ resumePausedGame = false } = {}) {
  if (gamePaused && !resumePausedGame) {
    setEngineStatus('AIエンジン：対局中断中');
    setAIStatus('対局中断中');
    render();
    return;
  }
  

  const retryKey = 'browser-strategy-shogi-ai-coi-retry-v2';

  // 分離とSharedArrayBufferの両方が使える場合だけ起動する
  if (
    window.crossOriginIsolated === true &&
    typeof SharedArrayBuffer !== 'undefined'
  ) {
    try {
      sessionStorage.removeItem(retryKey);
    } catch (error) {
      // 保存領域が使えない場合も起動を続ける
    }

    addDiagnostic('分離状態を確認。エンジン起動を開始します。');
    await connectEngine();
    return;
  }

  addDiagnostic(
    '分離状態を確認できません。' +
    `crossOriginIsolated=${window.crossOriginIsolated}; ` +
    `SharedArrayBuffer=${typeof SharedArrayBuffer}; ` +
    `Service Worker=${
      navigator.serviceWorker?.controller
        ? 'controllerあり'
        : 'controllerなし'
    }`
  );

  let retryAttempted = false;

  try {
    retryAttempted = sessionStorage.getItem(retryKey) === '1';
  } catch (error) {
    addDiagnostic('再読み込み判定用の保存領域を利用できません。');
  }

  // Service Workerがページを制御している場合は、一度だけ再試行
  if (
    navigator.serviceWorker?.controller &&
    !retryAttempted
  ) {
    try {
      sessionStorage.setItem(retryKey, '1');
      addDiagnostic('分離状態を回復するため、一度再読み込みします。');
      window.location.reload();
      return;
    } catch (error) {
      addDiagnostic(
        `再読み込みの準備に失敗: ${error?.message || String(error)}`
      );
    }
  }

  // 分離できていない状態ではエンジンを起動しない
  setEngineStatus(
    'AIエンジン：分離設定を確認できません。再読み込みが必要です。'
  );
  setAIStatus(
    'SharedArrayBufferが利用できないため、エンジンの起動を停止しました。'
  );
  if (resumePausedGame) {
  resumeRequestedAfterInit = false;
}

  render();
}

void startEngineSafely();