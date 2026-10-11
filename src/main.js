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
  return record.position.color === 'white' ? '先手' : '後手';
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

function commitMove(move) {
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

  finishMove();
  return true;
}

function moveFromSquare(fromRow, fromCol, toRow, toCol, promote) {
  const from = squareName(fromRow, fromCol);
  const to = squareName(toRow, toCol);
  const usi = from + to + (promote ? '+' : '');
  const move = record.position.createMoveByUSI(usi);
  return commitMove(move);
}

function isPromotablePiece(piece) {
  return piece && [
    'pawn', 'lance', 'knight', 'silver', 'bishop', 'rook'
  ].includes(piece.type);
}

function canPromote(fromRow, toRow, piece) {
  if (!isPromotablePiece(piece)) return false;
  // 先手（white）は上方向、後手（black）は下方向へ進む。
  const zoneReached = piece.color === 'white'
    ? fromRow <= 2 || toRow <= 2
    : fromRow >= 6 || toRow >= 6;

  return zoneReached;
}

function mustPromote(toRow, piece) {
  if (!piece) return false;

  if (piece.color === 'white') {
    if (piece.type === 'pawn' || piece.type === 'lance') return toRow === 0;
    if (piece.type === 'knight') return toRow <= 1;
  } else {
    if (piece.type === 'pawn' || piece.type === 'lance') return toRow === 8;
    if (piece.type === 'knight') return toRow >= 7;
  }

  return false;
}

function handleSquareClick(row, col) {
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
    commitMove(move);
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

  if (canPromote(from.row, row, movingPiece)) {
    const normalMove = record.position.createMoveByUSI(
      squareName(from.row, from.col) + squareName(row, col)
    );
    const promotedMove = record.position.createMoveByUSI(
      squareName(from.row, from.col) + squareName(row, col) + '+'
    );
    const normalValid = normalMove && record.position.isValidMove(normalMove);
    const promoteValid = promotedMove && record.position.isValidMove(promotedMove);

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
    button.disabled = color !== record.position.color;

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
  const squares = record.position.board.squares;

  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const square = makeElement('button', 'square');
      square.type = 'button';
      square.setAttribute('aria-label', `${9 - col}筋 ${row + 1}段`);

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

        if (piece.color === 'black') pieceElement.classList.add('gote');
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
    <p id="engine-status">AIエンジン：未接続</p>
    <p id="isolation-status"></p>
    <p id="wasm-status"></p>
  `;
  container.appendChild(status);

  const controls = makeElement('section', 'controls');
  controls.innerHTML = `
    <label>手番
      <select id="turn-select" disabled>
        <option value="white">先手</option>
        <option value="black">後手</option>
      </select>
    </label>
    <label>戦型
      <select>
        <option>指定なし</option>
        <option>右四間飛車</option>
      </select>
    </label>
    <label>思考時間
      <select>
        <option>0秒</option>
        <option>1秒</option>
        <option>2秒</option>
        <option>3秒</option>
        <option>5秒</option>
      </select>
    </label>
  `;
  container.appendChild(controls);


  container.appendChild(createHand('black', '後手'));
  container.appendChild(makeElement('h2', '', '盤面'));
  container.appendChild(makeElement('p', 'move-message', message));
  container.appendChild(createBoard());
  container.appendChild(createHand('white', '先手'));

  const information = makeElement('section', 'information');
  information.id = 'move-information';
  information.innerHTML = `
    <p>手数：${Math.max(0, record.length - 1)}</p>
    <p>評価値：—</p>
    <p>AI状態：駒の移動テスト中（AI未接続）</p>
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

    container.appendChild(choices);
  }

  const resetButton = makeElement('button', 'reset-button', '初期局面に戻す');
  resetButton.type = 'button';
  resetButton.addEventListener('click', () => {
    record.clear();
    clearSelection();
    message = '初期局面に戻しました。先手の番です。';
    render();
  });
  container.appendChild(resetButton);

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
}

render();
