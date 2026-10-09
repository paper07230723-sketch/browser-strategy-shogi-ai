import './style.css';

const app = document.querySelector('#app');

const initialBoard = [
  ['香', '桂', '銀', '金', '王', '金', '銀', '桂', '香'],
  ['', '飛', '', '', '', '', '', '角', ''],
  ['歩', '歩', '歩', '歩', '歩', '歩', '歩', '歩', '歩'],
  ['', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', ''],
  ['歩', '歩', '歩', '歩', '歩', '歩', '歩', '歩', '歩'],
  ['', '角', '', '', '', '', '', '飛', ''],
  ['香', '桂', '銀', '金', '玉', '金', '銀', '桂', '香']
];

function createBoard() {
  const board = document.createElement('div');
  board.className = 'board';

  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const square = document.createElement('div');
      square.className = 'square';

      const piece = initialBoard[row][col];

      if (piece) {
        const pieceElement = document.createElement('span');
        pieceElement.className = 'piece';

        // 上3段を後手、下3段を先手として表示
        if (row < 3) {
          pieceElement.classList.add('gote');
        }

        pieceElement.textContent = piece;
        square.appendChild(pieceElement);
      }

      board.appendChild(square);
    }
  }

  return board;
}

function createApp() {
  const container = document.createElement('main');
  container.className = 'container';

  const title = document.createElement('h1');
  title.textContent = '戦型指定型将棋AI';

  const subtitle = document.createElement('p');
  subtitle.className = 'subtitle';
  subtitle.textContent =
    'browser-strategy-shogi-ai 診断版';

  const status = document.createElement('section');
  status.className = 'status';

  status.innerHTML = `
    <h2>システム診断</h2>
    <p id="browser-status">ブラウザ確認中...</p>
    <p id="base-status">ページ設定確認中...</p>
    <p id="engine-status">AIエンジン：未接続</p>
  `;
      <p id="isolation-status">分離状態を確認中...</p>
    <p id="wasm-status">共有メモリを確認中...</p>

  const controls = document.createElement('section');
  controls.className = 'controls';

  controls.innerHTML = `
    <label>
      手番
      <select>
        <option>先手</option>
        <option>後手</option>
      </select>
    </label>

    <label>
      戦型
      <select>
        <option>指定なし</option>
        <option>右四間飛車</option>
      </select>
    </label>

    <label>
      思考時間
      <select>
        <option>0秒</option>
        <option>1秒</option>
        <option>2秒</option>
        <option>3秒</option>
        <option>5秒</option>
      </select>
    </label>
  `;

  const boardTitle = document.createElement('h2');
  boardTitle.textContent = '盤面';

  const board = createBoard();

  const information = document.createElement('section');
  information.className = 'information';

  information.innerHTML = `
    <p>評価値：—</p>
    <p>AI状態：準備中</p>
  `;

  container.append(
    title,
    subtitle,
    status,
    controls,
    boardTitle,
    board,
    information
  );

  return container;
}

app.appendChild(createApp());

const browserStatus = document.querySelector('#browser-status');
const baseStatus = document.querySelector('#base-status');

browserStatus.textContent =
  `ブラウザ：${navigator.userAgent.includes('Safari') ? 'Safari系ブラウザ' : '確認済み'}`;

baseStatus.textContent =
  `ページベース：${import.meta.env.BASE_URL}`;

console.log('browser-strategy-shogi-ai diagnostic version loaded.');
