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
let gameStarted = false;
let playerColor = 'black';
let engine = null;
let engineReady = false;
let aiThinking = false;
let engineStage = 'loading';
let engineStatusText = 'AIエンジン：接続準備中';
let aiStatusText = 'AIの初期化中';
let moveHistory = [];
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
      <p>評価値：—</p>
      <p>AI状態：${aiStatusText}</p>
    `;
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
  finishMove();

  // 人間の着手後、AIが準備済みなら自動で応手する。
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

function handleSquareClick(row, col) {
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
  aiThinking;

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

  const thinkTimeSelect = controls.querySelector('#think-time-select');

thinkTimeSelect.value = selectedThinkTime;

thinkTimeSelect.addEventListener('change', () => {
  selectedThinkTime = thinkTimeSelect.value;
});
const turnSelect = controls.querySelector('#turn-select');

turnSelect.value = playerColor;
turnSelect.disabled = gameStarted || aiThinking;

turnSelect.addEventListener('change', () => {
  if (gameStarted || aiThinking) return;

  playerColor = turnSelect.value;

  message = `${playerColor === 'black' ? '先手' : '後手'}を選択しました。`;
  render();
});
  container.appendChild(controls);

  const startAiButton = makeElement(
  'button',
  'start-ai-button',
  '対局を開始'
);

startAiButton.type = 'button';
startAiButton.disabled = !engineReady || gameStarted || aiThinking;

startAiButton.addEventListener('click', () => {
  if (!engineReady || gameStarted || aiThinking) return;

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

  container.appendChild(createHand('white', '後手'));
  container.appendChild(makeElement('h2', '', '盤面'));
  container.appendChild(makeElement('p', 'move-message', message));
  const boardArea = makeElement('div', 'board-area');
boardArea.appendChild(createBoard());
container.appendChild(boardArea);
  container.appendChild(createHand('black', '先手'));

  const information = makeElement('section', 'information');
  information.id = 'move-information';
  information.innerHTML = `
    <p>手数：${Math.max(0, record.length - 1)}</p>
    <p>評価値：—</p>
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

    boardArea.appendChild(choices);
  }

  const resetButton = makeElement('button', 'reset-button', '初期局面に戻す');
  resetButton.type = 'button';
  resetButton.addEventListener('click', () => {
    record.clear();
    moveHistory = [];
    clearSelection();
    message = '初期局面に戻しました。先手の番です。';
    render();
  });
  container.appendChild(resetButton);

// リセットボタンを対局開始ボタンの近くへ移動する
container.insertBefore(
  resetButton,
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

  if (applied) {
    setEngineStatus(`AIの指し手を反映しました：${usiMove}`);
    setAIStatus('AIが1手指しました');
  }

  return applied;
}

function requestAiMove() {
  if (!engineReady || !engine || aiThinking) return;

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
async function inspectEngineResponse(url, label) {
  try {
    const response = await fetch(url, {
      cache: 'no-store'
    });

    let sample = '';

    if (response.body) {
      const reader = response.body.getReader();
      const result = await reader.read();

      if (result.value) {
        sample = new TextDecoder().decode(
          result.value.slice(0, 1024)
        );
      }

      await reader.cancel().catch(() => {});
    }

    const contentType =
      response.headers.get('content-type') || '不明';

    addDiagnostic(
      `${label}: GET=${response.status} ${response.statusText}; ` +
      `Content-Type=${contentType}; ` +
      `redirected=${response.redirected}; ` +
      `取得先=${response.url}`
    );

    addDiagnostic(
      `${label}: 先頭部分=${JSON.stringify(
        sample.replace(/\s+/g, ' ').slice(0, 180)
      )}; ` +
      `YaneuraOu_sse42の文字列=${
        sample.includes('YaneuraOu_sse42')
      }`
    );
  } catch (error) {
    addDiagnostic(
      `${label}: GET調査に失敗=${
        error?.message || String(error)
      }`
    );
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
async function diagnoseServiceWorker() {
  try {
    const controller = navigator.serviceWorker?.controller;

    addDiagnostic(
      `SW制御状態: ${
        controller
          ? `${controller.state || '状態不明'}; ${controller.scriptURL}`
          : 'controllerなし'
      }`
    );

    if (navigator.serviceWorker) {
      const registrations =
        await navigator.serviceWorker.getRegistrations();

      const summary = registrations.map((registration) => {
        const active = registration.active;
        const waiting = registration.waiting;
        const installing = registration.installing;

        return (
          `scope=${registration.scope}; ` +
          `active=${active?.state || 'なし'}; ` +
          `waiting=${waiting?.state || 'なし'}; ` +
          `installing=${installing?.state || 'なし'}`
        );
      });

      addDiagnostic(
        `SW登録一覧: ${
          summary.length ? summary.join(' | ') : '登録なし'
        }`
      );
    }

    const response = await fetch(window.location.href, {
      cache: 'no-store'
    });
    const engineResponse = await fetch(
  `${import.meta.env.BASE_URL}engine/sse42/yaneuraou.js`,
  {
    cache: 'no-store'
  }
);
// エンジンJSの内容と構文を診断する
try {
  const engineSource = await engineResponse.clone().text();

  addDiagnostic(
    `エンジンJS内容検査: ` +
    `文字数=${engineSource.length}; ` +
    `先頭=${JSON.stringify(engineSource.slice(0, 100))}; ` +
    `末尾=${JSON.stringify(engineSource.slice(-200))}`
  );

  try {
    // 実行せずに、JavaScriptとして構文を解析できるか確認する
    new Function(engineSource);
    addDiagnostic('エンジンJS構文検査: 成功');
  } catch (error) {
    addDiagnostic(
      `エンジンJS構文検査: ` +
      `${error.name}: ${error.message}`
    );
  }
} catch (error) {
  addDiagnostic(
    `エンジンJS内容検査失敗: ` +
    `${error.name}: ${error.message}`
  );
}
addDiagnostic(
  `エンジン応答ヘッダー: ` +
  `status=${engineResponse.status}; ` +
  `Content-Type=${
    engineResponse.headers.get('Content-Type') || 'なし'
  }; ` +
  `COOP=${
    engineResponse.headers.get('Cross-Origin-Opener-Policy') || 'なし'
  }; ` +
  `COEP=${
    engineResponse.headers.get('Cross-Origin-Embedder-Policy') || 'なし'
  }; ` +
  `CORP=${
    engineResponse.headers.get('Cross-Origin-Resource-Policy') || 'なし'
  }; ` +
  `Content-Encoding=${
    engineResponse.headers.get('Content-Encoding') || 'なし'
  }`
);
    addDiagnostic(
      `ページ応答: status=${response.status}; ` +
      `COOP=${response.headers.get('Cross-Origin-Opener-Policy') || 'なし'}; ` +
      `COEP=${response.headers.get('Cross-Origin-Embedder-Policy') || 'なし'}; ` +
      `CORP=${response.headers.get('Cross-Origin-Resource-Policy') || 'なし'}`
    );
  } catch (error) {
    addDiagnostic(
      `SW・ヘッダー診断エラー: ${
        error?.message || String(error)
      }`
    );
  }
}
async function connectEngine() {
  try {
    addDiagnostic('エンジン接続処理開始');
    setEngineStatus('AIエンジン：JavaScript読み込み中...');

  const scriptUrl = new URL(
  `${import.meta.env.BASE_URL}engine/sse42/yaneuraou.js`,
  window.location.origin
).href;
// WorkerとWASMの応答を個別に診断する
async function inspectEngineAsset(file, inspectText = false) {
  const url = new URL(file, scriptUrl).href;

  try {
    const response = await fetch(url, {
      cache: 'no-store'
    });

    let size = response.headers.get('Content-Length') || '不明';
    let preview = '';

    if (inspectText) {
      const source = await response.text();
      size = new TextEncoder().encode(source).length;

      preview =
        `; 先頭=${JSON.stringify(source.slice(0, 100))}`;
    }

    addDiagnostic(
      `関連ファイル診断 ${file}: ` +
      `status=${response.status}; ` +
      `Content-Type=${response.headers.get('Content-Type') || 'なし'}; ` +
      `COEP=${response.headers.get('Cross-Origin-Embedder-Policy') || 'なし'}; ` +
      `CORP=${response.headers.get('Cross-Origin-Resource-Policy') || 'なし'}; ` +
      `サイズ=${size}; ` +
      `redirected=${response.redirected}; ` +
      `URL=${response.url}${preview}`
    );
  } catch (error) {
    addDiagnostic(
      `関連ファイル診断失敗 ${file}: ` +
      `${error?.name || 'Error'}: ${error?.message || String(error)}`
    );
  }
}

await inspectEngineAsset('yaneuraou.worker.js', true);
await inspectEngineAsset('yaneuraou.wasm');
// Worker内部からエンジンJSを読み込めるか診断する
await new Promise((resolve) => {
  const probeSource = `
    self.onmessage = (event) => {
      try {
        importScripts(event.data.url);
        self.postMessage({
          ok: true,
          factoryType: typeof self.YaneuraOu_sse42
        });
      } catch (error) {
        self.postMessage({
          ok: false,
          name: error?.name,
          message: error?.message,
          stack: error?.stack
        });
      }
    };
  `;

  let worker;
  let blobUrl;
  let timeoutId;
  let finished = false;

  const finish = (result) => {
    if (finished) return;
    finished = true;

    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (worker) worker.terminate();
    if (blobUrl) URL.revokeObjectURL(blobUrl);

    addDiagnostic(
      `Worker内importScripts診断: ${JSON.stringify(result)}`
    );
    resolve();
  };

  try {
    blobUrl = URL.createObjectURL(
      new Blob([probeSource], { type: 'text/javascript' })
    );

    worker = new Worker(blobUrl);

    worker.onmessage = (event) => finish(event.data);

    worker.onerror = (event) => {
      finish({
        ok: false,
        error: 'WorkerError',
        message: event.message,
        filename: event.filename,
        line: event.lineno
      });
    };

    timeoutId = setTimeout(
      () => finish({ ok: false, error: 'timeout' }),
      5000
    );

    worker.postMessage({ url: scriptUrl });
  } catch (error) {
    finish({
      ok: false,
      name: error?.name,
      message: error?.message
    });
  }
});
addDiagnostic(`エンジンJS取得開始: ${scriptUrl}`);

const response = await fetch(scriptUrl, {
  cache: 'no-store'
});

if (!response.ok) {
  throw new Error(`エンジンJS取得失敗: HTTP ${response.status}`);
}

const source = await response.text();

addDiagnostic(
  `エンジンJS取得成功: 文字数=${source.length}`
);

try {
  // グローバルスコープで初期化関数を登録する
  (0, eval)(source);
} catch (error) {
  throw new Error(
    `エンジンJS実行失敗: ${error?.message || String(error)}`
  );
}

const factoryType = typeof window.YaneuraOu_sse42;

addDiagnostic(
  `eval後の初期化関数の型=${factoryType}`
);

if (factoryType !== 'function') {
  throw new Error(
    'eval後もエンジン初期化関数が見つかりません'
  );
}

    setEngineStatus('AIエンジン：WASM初期化中...');
    addDiagnostic('WASM初期化開始');

    let timeoutId;

    try {
      const initPromise = window.YaneuraOu_sse42({
  locateFile: (file) => new URL(file, scriptUrl).href,
  mainScriptUrlOrBlob: new Blob([source], { type: 'text/javascript' })
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

    engineStage = 'usi';
    addDiagnostic('USI応答の待機を開始');

    engine.addMessageListener((line) => {
      const received = String(line).trim();
      console.log('[USI]', received);

      if (engineStage === 'usi' && received.includes('usiok')) {
        engineStage = 'ready';

        addDiagnostic('USI応答: usiok');

        setEngineStatus(
          'AIエンジン：準備完了を確認中...'
        );

        engine.postMessage('setoption name USI_Hash value 16');
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
async function startEngineSafely() {
  // 先にService Workerと応答ヘッダーを診断する
  await diagnoseServiceWorker();

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

  render();
}

void startEngineSafely();