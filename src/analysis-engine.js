
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
const TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 10_000;
const EVAL_FILES = ['nn.bin', 'progress.bin', 'eval_options.txt', 'tag.json'];

function getEngineId() {
  try {
    const saved = localStorage.getItem(ENGINE_STORAGE_KEY);
    return Object.hasOwn(ENGINE_CONFIGS, saved) ? saved : 'suishou';
  } catch {
    return 'suishou';
  }
}

function parseInfo(line) {
  if (/\b(?:lowerbound|upperbound)\b/.test(line)) return null;

  const depth = line.match(/\bdepth\s+(\d+)\b/);
  const multiPv = line.match(/\bmultipv\s+(\d+)\b/);
  const score = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)\b/);
  const pv = line.match(/\bpv\s+(.+)$/);

  if (multiPv && Number(multiPv[1]) !== 1) return null;

  return {
    depth: depth ? Number(depth[1]) : null,
    score: score ? { type: score[1], value: Number(score[2]) } : null,
    pv: pv ? pv[1].trim().split(/\s+/) : [],
    raw: line,
  };
}

/** 解析画面専用。importしただけではエンジンを起動しません。 */
export class AnalysisEngine {
  constructor({ onStatus = () => {}, onInfo = () => {} } = {}) {
    this.engineId = getEngineId();
    this.onStatus = onStatus;
    this.onInfo = onInfo;
    this.engine = null;
    this.ready = false;
    this.phase = 'idle';
    this.initializing = null;
    this.handshake = null;
    this.search = null;
  }

  report(stage, message = '') {
    try {
      this.onStatus({ stage, message, engineId: this.engineId });
    } catch (error) {
      console.error('解析エンジンの状態通知に失敗しました:', error);
    }
  }

  initialize() {
    if (this.ready) return Promise.resolve();
    if (this.initializing) return this.initializing;
    if (this.phase === 'error') {
      return Promise.reject(new Error('エンジンを再初期化できません。解析画面を開き直してください。'));
    }

    this.initializing = this.initializeInternal().catch((error) => {
      this.phase = 'error';
      this.ready = false;
      this.report('error', error?.message || String(error));
      throw error;
    }).finally(() => {
      this.initializing = null;
    });

    return this.initializing;
  }

  async initializeInternal() {
    if (window.crossOriginIsolated !== true || typeof SharedArrayBuffer === 'undefined') {
      throw new Error('SharedArrayBufferを利用できません。COOP・COEP設定を確認してページを再読み込みしてください。');
    }

    const config = ENGINE_CONFIGS[this.engineId];
    const scriptUrl = new URL(
      `${import.meta.env.BASE_URL}${config.scriptPath}`,
      window.location.origin
    ).href;

    this.report('loading-script', `${config.label}のJavaScriptを読み込んでいます。`);
    if (typeof window[config.factoryName] !== 'function') {
      await this.loadScript(scriptUrl);
    }

    const factory = window[config.factoryName];
    if (typeof factory !== 'function') {
      throw new Error('エンジン初期化関数が見つかりません。');
    }

    this.report('loading-wasm', `${config.label}のWASMを初期化しています。`);
    this.engine = await this.withTimeout(
      factory({ locateFile: (file) => new URL(file, scriptUrl).href }),
      TIMEOUT_MS,
      'WASMの初期化が30秒以内に完了しませんでした。'
    );

    if (typeof this.engine?.postMessage !== 'function' || typeof this.engine?.addMessageListener !== 'function') {
      throw new Error('エンジンとのUSI通信機能を利用できません。');
    }

    if (config.evalDataPath) {
      this.report('loading-evaldata', 'エンジンの評価データを読み込んでいます。');
      await this.loadEvalData(config.evalDataPath);
    }

    this.engine.addMessageListener((line) => this.handleMessage(line));
    this.report('handshake', 'USI通信を初期化しています。');
    await this.startHandshake();
    this.ready = true;
    this.phase = 'idle';
    this.report('ready', `${config.label}の準備が完了しました。`);
  }

  loadScript(scriptUrl) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        script.remove();
        reject(new Error('エンジンJavaScriptの読み込みが30秒でタイムアウトしました。'));
      }, TIMEOUT_MS);

      script.src = scriptUrl;
      script.async = true;
      script.onload = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        script.remove();
        resolve();
      };
      script.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        script.remove();
        reject(new Error(`エンジンJavaScriptを読み込めませんでした: ${scriptUrl}`));
      };
      document.head.appendChild(script);
    });
  }

  async loadEvalData(evalDataPath) {
    if (!this.engine?.FS?.writeFile) {
      throw new Error('WASMのファイルシステムを利用できません。');
    }

    try {
      this.engine.FS.stat('/evaldata');
    } catch {
      this.engine.FS.mkdir('/evaldata');
    }

    for (const file of EVAL_FILES) {
      const url = new URL(
        `${import.meta.env.BASE_URL}${evalDataPath}/${file}`,
        window.location.origin
      ).href;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`評価ファイルの取得に失敗しました: ${file} (HTTP ${response.status})`);
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0) throw new Error(`評価ファイルが空です: ${file}`);
      this.engine.FS.writeFile(`/evaldata/${file}`, bytes);
    }
  }

  withTimeout(promise, milliseconds, message) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error(message)), milliseconds);
    });
    return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
  }

  startHandshake() {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.handshake = null;
        this.phase = 'error';
        reject(new Error('USI初期化の応答が30秒以内に返りませんでした。'));
      }, TIMEOUT_MS);

      this.handshake = {
        resolve: () => {
          window.clearTimeout(timer);
          this.handshake = null;
          resolve();
        },
        reject: (error) => {
          window.clearTimeout(timer);
          this.handshake = null;
          reject(error);
        },
      };

      this.phase = 'usi';
      try {
        this.engine.postMessage('usi');
      } catch (error) {
        this.handshake.reject(error);
      }
    });
  }

  handleMessage(rawLine) {
    const line = String(rawLine).trim();
    if (!line || this.phase === 'error') return;

    if (this.phase === 'usi' && line === 'usiok') {
      this.phase = 'waiting-ready';
      try {
        this.engine.postMessage('setoption name USI_Hash value 16');
        if (ENGINE_CONFIGS[this.engineId].evalDataPath) {
          this.engine.postMessage('setoption name Threads value 4');
          this.engine.postMessage('setoption name EvalDir value evaldata');
          this.engine.postMessage('setoption name FV_SCALE value 24');
          this.engine.postMessage('setoption name MinimumThinkingTime value 1');
          this.engine.postMessage('setoption name RoundUpToFullSecond value false');
        }
        this.engine.postMessage('isready');
      } catch (error) {
        this.handshake?.reject(error);
        this.phase = 'error';
      }
      return;
    }

    if (this.phase === 'waiting-ready' && line === 'readyok') {
      this.phase = 'idle';
      this.handshake?.resolve();
      return;
    }

    const search = this.search;
    if (!search) return;

    if (line.startsWith('info ')) {
      const info = parseInfo(line);
      if (info) {
        search.lastInfo = info;
        try {
          search.onInfo(info);
        } catch (error) {
          console.error('解析情報の通知に失敗しました:', error);
        }
      }
      return;
    }

    if (line.startsWith('bestmove')) {
      const match = line.match(/^bestmove\s+(\S+)(?:\s+ponder\s+(\S+))?/);
      const result = {
        bestmove: match?.[1] && !['(none)', 'resign', 'win'].includes(match[1]) ? match[1] : null,
        ponder: match?.[2] || null,
        cancelled: search.cancelled,
        info: search.lastInfo,
        raw: line,
      };

      window.clearTimeout(search.timeoutId);
      window.clearTimeout(search.stopTimer);
      this.search = null;
      this.phase = 'idle';
      search.resolve(result);
      this.report('ready', '局面の解析が終了しました。');
    }
  }

  analyze(positionCommand, thinkSeconds, { onInfo = this.onInfo } = {}) {
    if (!this.ready || this.phase !== 'idle') {
      return Promise.reject(new Error('解析エンジンの準備が完了していません。'));
    }
    if (typeof positionCommand !== 'string' || !/^position\s+(?:startpos|sfen)\b/.test(positionCommand.trim())) {
      return Promise.reject(new Error('局面コマンドの形式が正しくありません。'));
    }

    const seconds = Number(thinkSeconds);
    if (![1, 3, 5].includes(seconds)) {
      return Promise.reject(new Error('解析時間は1秒・3秒・5秒から選択してください。'));
    }

    let resolveSearch;
    let rejectSearch;
    const promise = new Promise((resolve, reject) => {
      resolveSearch = resolve;
      rejectSearch = reject;
    });
    const search = {
      resolve: resolveSearch,
      reject: rejectSearch,
      onInfo,
      promise,
      lastInfo: null,
      cancelled: false,
      timeoutId: null,
      stopTimer: null,
    };

    this.search = search;
    this.phase = 'thinking';
    this.report('thinking', `${seconds}秒間、局面を解析しています。`);
    search.timeoutId = window.setTimeout(() => {
      this.requestStop(search, '解析の応答が遅れているため停止を要求しています。');
    }, seconds * 1000 + TIMEOUT_MS);

    try {
      this.engine.postMessage(positionCommand.trim());
      this.engine.postMessage(`go movetime ${seconds * 1000}`);
    } catch (error) {
      this.failSearch(search, error);
    }
    return promise;
  }

  requestStop(search, message) {
    if (this.search !== search) return;
    window.clearTimeout(search.timeoutId);
    search.cancelled = true;
    this.report('stopping', message);
    try {
      this.engine.postMessage('stop');
    } catch (error) {
      this.failSearch(search, error);
      return;
    }
    search.stopTimer = window.setTimeout(() => {
      if (this.search !== search) return;
      this.search = null;
      this.ready = false;
      this.phase = 'error';
      search.reject(new Error('エンジンが停止応答を返しませんでした。解析画面を開き直してください。'));
    }, STOP_TIMEOUT_MS);
  }

  stop() {
    const search = this.search;
    if (!search) return Promise.resolve(null);
    this.requestStop(search, '解析を停止しています。');
    return search.promise;
  }

  failSearch(search, error) {
    if (this.search !== search) return;
    window.clearTimeout(search.timeoutId);
    window.clearTimeout(search.stopTimer);
    this.search = null;
    this.ready = false;
    this.phase = 'error';
    search.reject(error);
  }
}

export { getEngineId };
