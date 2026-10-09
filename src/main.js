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
  subtitle.textContent = 'browser-strategy-shogi-ai 診断版';

  const status = document.createElement('section');
  status.className = 'status';

  status.innerHTML = `
    <h2>システム診断</h2>
    <p id="browser-status">ブラウザ確認中...</p>
    <p id="base-status">ページ設定確認中...</p>
    <p id="engine-status">AIエンジン：未接続</p>
    <p id="isolation-status">分離状態を確認中...</p>
    <p id="wasm-status">共有メモリを確認中...</p>
  `;

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

document.querySelector('#browser-status').textContent =
  `ブラウザ：${navigator.userAgent.includes('Safari') ? 'Safari系ブラウザ' : '確認済み'}`;

document.querySelector('#base-status').textContent =
  `ページベース：${import.meta.env.BASE_URL}`;

document.querySelector('#isolation-status').textContent =
  `クロスオリジン分離：${window.crossOriginIsolated ? '有効' : '無効'}`;

document.querySelector('#wasm-status').textContent =
  `SharedArrayBuffer：${typeof SharedArrayBuffer !== 'undefined' ? '利用可能' : '利用不可'}`;

console.log('browser-strategy-shogi-ai diagnostic version loaded.');

async function testEngineStartup() {
  const engineStatus = document.querySelector('#engine-status');

  engineStatus.textContent = 'AIエンジン：JavaScript読み込み中...';

  try {
    const script = document.createElement('script');
    script.src = `${import.meta.env.BASE_URL}engine/sse42/yaneuraou.js`;

    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () =>
        reject(new Error('エンジンJavaScriptの読み込みに失敗'));

      document.head.appendChild(script);
    });

    if (typeof window.YaneuraOu_sse42 !== 'function') {
      throw new Error('エンジン初期化関数が見つかりません');
    }

    engineStatus.textContent = 'AIエンジン：WASM初期化中...';

    const instance = await window.YaneuraOu_sse42();

    let stage = 'usi';

instance.addMessageListener((line) => {
  console.log('[USI]', line);

  const received = String(line).trim();

  if (stage === 'usi' && received.includes('usiok')) {
    stage = 'ready';
    engineStatus.textContent =
      'AIエンジン：isready送信済み、応答待ち...';

    instance.postMessage('isready');
    return;
  }

  if (stage === 'ready') {
    engineStatus.textContent =
      `AIエンジン：準備中（受信：${received.slice(0, 80)}）`;

    if (received.includes('readyok')) {
      stage = 'thinking';
      engineStatus.textContent = 'AIエンジン：初手を思考中...';
      instance.postMessage('position startpos');
      instance.postMessage('go depth 1');
    }

    return;
  }

  if (stage === 'thinking' && received.startsWith('bestmove')) {
    stage = 'done';

    const match = received.match(/bestmove\s+(\S+)/);
    const move = match ? match[1] : '不明';

    engineStatus.textContent =
      `AIエンジン：1手生成成功（${move}）`;
  }
});

    instance.postMessage('usi');

  } catch (error) {
    console.error('エンジンテスト失敗:', error);

    engineStatus.textContent =
      `AIエンジン：テスト失敗（${error.message || '詳細はコンソールを確認'}）`;
  }
}

testEngineStartup();
