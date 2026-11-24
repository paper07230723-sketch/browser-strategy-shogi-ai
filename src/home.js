
import "./home.css";

const app = document.querySelector("#app");

if (!app) {
  throw new Error("ホーム画面の表示先 (#app) が見つかりません。");
}

const home = document.createElement("main");
home.className = "home-shell";

home.innerHTML = `
  <header class="home-header">
    <div class="home-brand">
      <span class="home-brand-mark" aria-hidden="true">将</span>
      <span>SHOGI AI</span>
    </div>

    <h1>戦型指定型将棋AI</h1>

    <p class="home-description">
      AIとの対局も、棋譜の振り返りも。<br />
      利用する機能を選択してください。
    </p>
  </header>

  <div class="feature-grid" aria-label="機能選択">

    <a
      class="feature-card feature-card--link"
      href="./game.html"
    >
      <span class="feature-card__topline">
        PLAY MODE
      </span>

      <span class="feature-card__icon" aria-hidden="true">
        将
      </span>

      <span class="feature-card__title">
        AI対局
      </span>

      <span class="feature-card__description">
        3種類の将棋AIと対局できます。
        戦型・戦法を指定した対局にも対応しています。
      </span>

      <span class="feature-card__action">
        対局を始める
        <span aria-hidden="true">→</span>
      </span>
    </a>

    <section
      class="feature-card feature-card--disabled"
      aria-labelledby="analysis-title"
      aria-describedby="analysis-description"
    >
      <span class="feature-card__status">
        準備中
      </span>

      <span class="feature-card__topline">
        ANALYSIS MODE
      </span>

      <span class="feature-card__icon" aria-hidden="true">
        📊
      </span>

      <span class="feature-card__title" id="analysis-title">
        棋譜解析
      </span>

      <span
        class="feature-card__description"
        id="analysis-description"
      >
        棋譜を読み込み、AIによる評価値や
        推奨手を確認できる機能です。
      </span>

      <span class="feature-card__action">
        開発中
      </span>
    </section>

  </div>

  <footer class="home-footer">
    戦型指定型将棋AI
  </footer>
`;

app.replaceChildren(home);
