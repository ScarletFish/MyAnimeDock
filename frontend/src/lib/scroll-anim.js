// ─── 视图滚动驱动入场动画 ───
// Library / Mylist / Discovery 三个视图共用的滚动入场方案（替代旧的"打开时时间 stagger"）：
// - 区块级：每个 section 一个独立 ScrollTrigger，fade + rise（autoAlpha 0→1, y 16→0），
//   滚动到哪、哪个区块进场，无时间 stagger 列表。
// - 卡片级：ScrollTrigger.batch，每卡一个 trigger（once:true 进视口即自毁），
//   同一批进入视口的卡片（interval≈0.016s 内）按 stagger 波状显现。
// 硬约束：scroller 固定 .main-content（唯一滚动容器）；只动 transform/opacity（autoAlpha）。
// 用法（每个视图一个实例，配合"数据签名"gate）：
//   const anim = createScrollAnim();
//   $effect(() => { if (!视图已打开) return; ...签名未变则 return;
//                   tick().then(() => anim.build({ sections, cards })); });
//   $effect(() => { if (视图已打开) return; anim.kill(); });

const SCROLLER = '.main-content';

export function createScrollAnim() {
  return {
    sectionTriggers: [],
    cardTriggers: [],
    sectionEls: [],
    cardEls: [],

    // sections / cards 为空数组时仅清理旧 trigger。NodeList / 数组均可传入。
    build({ sections = [], cards = [] } = {}) {
      this.kill();
      const gsap = globalThis.gsap;
      if (!gsap || !gsap.ScrollTrigger) return;
      const scroller = document.querySelector(SCROLLER);
      if (!scroller) return;

      for (const el of sections) {
        const tween = gsap.fromTo(
          el,
          { autoAlpha: 0, y: 16 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.5,
            ease: 'power2.out',
            scrollTrigger: { trigger: el, start: 'top 92%', once: true, scroller },
          }
        );
        if (tween.scrollTrigger) {
          this.sectionTriggers.push(tween.scrollTrigger);
          this.sectionEls.push(el);
        }
      }

      const cardList = Array.from(cards);
      if (cardList.length) {
        gsap.set(cardList, { autoAlpha: 0, y: 24 });
        this.cardEls.push(...cardList);
        const batchTriggers = gsap.ScrollTrigger.batch(cardList, {
          start: 'top 92%',
          once: true,
          scroller,
          onEnter: (batch) => {
            gsap.to(batch, {
              y: 0,
              // 目标透明度按状态 class 推导，与 Discovery CSS 规则一致（普通 1 / 已导入 0.5 / 排除 0.6）；
              // 从 0 淡到各自真实值，避免统一淡到 1 后内联覆盖 CSS 造成"浅白→半透明"跳变。
              autoAlpha: (_i, el) =>
                el.classList.contains('discovery-card--imported') ? 0.5
                : el.classList.contains('discovery-card--excluded') ? 0.6
                : 1,
              duration: 0.5,
              ease: 'power2.out',
              stagger: 0.04,
            });
          },
        });
        this.cardTriggers.push(...batchTriggers);
      }
    },

    // kill 全部 trigger（含 once 已自毁的，幂等）并清除捕获元素的隐藏态内联样式，
    // 保证切走再切回时内容直接可见、不残留 opacity:0。
    kill() {
      this.sectionTriggers.forEach((t) => t && t.kill());
      this.cardTriggers.forEach((t) => t && t.kill());
      this.sectionTriggers = [];
      this.cardTriggers = [];
      for (const el of this.sectionEls) {
        el.style.opacity = '';
        el.style.visibility = '';
        el.style.transform = '';
      }
      for (const el of this.cardEls) {
        el.style.opacity = '';
        el.style.visibility = '';
        el.style.transform = '';
      }
      this.sectionEls = [];
      this.cardEls = [];
    },
  };
}