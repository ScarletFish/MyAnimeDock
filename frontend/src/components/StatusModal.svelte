<script>
  // ─── StatusModal（Svelte 迁移 Chunk B）───
  // 基于 Mylist.svelte 的组件内状态弹窗（逻辑 + 模板），不基于 vanilla mylist.js。
  // 只认 props，不 fetch、不查 libraryData/mylistData store。
  import { tr, api, coverSrc, localDateStr, todayStr } from '../lib/anime-utils.js';
  import { getStatusLabels } from '../lib/sort.js';
  import { showToast } from './Toast.svelte';
  import { Select } from 'bits-ui';

  let {
    open = $bindable(false),
    item,
    anime = null,
    onSaved = null,
  } = $props();

  // ─── 状态 ───
  let status = $state('wish');
  let statusDdOpen = $state(false);
  let ratingVal = $state('—');
  let progressVal = $state('—');
  let progressMax = $state(999); // 进度上限 = 本地集数，无本地文件时回退 999
  let startSeg = $state({ y: '', m: '', d: '' });
  let endSeg = $state({ y: '', m: '', d: '' });
  let notes = $state('');
  let statusModalTitle = $state('');
  let statusModalBg = $state('');
  let saving = $state(false);

  // open 变 true 时重初始化
  $effect(() => {
    if (!open) return;
    const it = item || {};
    const src = anime || it;

    status = it.status ?? it.myListStatus ?? 'wish';
    statusDdOpen = false;

    statusModalTitle = src.bangumiTitle || src.title || tr('mylist.markStatus');
    statusModalBg = coverSrc(src, 600);

    const rating = it.userRating != null ? it.userRating : '';
    ratingVal = rating !== '' ? String(rating) : '—';

    const storedProgress = it.progress != null ? it.progress : null;
    const watchedCount = src.episodes ? src.episodes.filter((e) => e.watched).length : 0;
    const progVal = storedProgress != null ? storedProgress : watchedCount || '';
    progressVal = progVal !== '' ? String(progVal) : '—';
    // 进度上限 = 本地集数；无本地文件时回退 999
    progressMax = src.episodes && src.episodes.length ? src.episodes.length : 999;

    const storedStart = it.startedAt ? it.startedAt : null;
    const firstPlayed = it.firstPlayedAt ? localDateStr(it.firstPlayedAt) : null;
    setDateToSegments(startSeg, storedStart ? storedStart.substring(0, 10) : firstPlayed || todayStr());

    const storedEnd = it.completedAt ? it.completedAt : null;
    const lastPlayed = it.lastPlayedAt ? localDateStr(it.lastPlayedAt) : null;
    setDateToSegments(endSeg, storedEnd ? storedEnd.substring(0, 10) : lastPlayed || todayStr());

    notes = it.notes || '';
  });

  // 打开时锁定 body 滚动，避免窗口滚动条出现导致布局左移
  $effect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  });

  function setDateToSegments(seg, dateStr) {
    if (dateStr) {
      var parts = dateStr.substring(0, 10).split('-');
      seg.y = parts[0] || '';
      seg.m = parts[1] || '';
      seg.d = parts[2] || '';
    }
  }

  function readDateSegments(seg) {
    var y = seg.y.trim();
    var m = seg.m.trim();
    var d = seg.d.trim();
    if (!y && !m && !d) return '';
    y = y.padStart(4, '0');
    m = m.padStart(2, '0') || '01';
    d = d.padStart(2, '0') || '01';
    return y + '-' + m + '-' + d;
  }

  function segAutoTab(e, seg, field) {
    const input = e.currentTarget;
    let val = input.value.replace(/\D/g, '');
    seg[field] = val;
    input.closest('.date-segments')?.classList.remove('invalid');
    if (val.length >= input.maxLength) {
      const segs = input.closest('.date-segments');
      if (segs) {
        const inputs = segs.querySelectorAll('.date-seg');
        for (let i = 0; i < inputs.length; i++) {
          if (inputs[i] === input && i < inputs.length - 1) {
            inputs[i + 1].focus();
            break;
          }
        }
      }
    }
  }

  // 输入纪律：空段按 Backspace 回退上一格并选中，便于连删
  function segBackspace(e) {
    if (e.key !== 'Backspace') return;
    const input = e.currentTarget;
    if (input.value !== '') return; // 有值时让默认删除行为生效
    const segs = input.closest('.date-segments');
    if (!segs) return;
    const inputs = segs.querySelectorAll('.date-seg');
    for (let i = 1; i < inputs.length; i++) {
      if (inputs[i] === input) {
        const prev = inputs[i - 1];
        prev.focus();
        prev.select();
        e.preventDefault();
        return;
      }
    }
  }

  // 日期校验：全空合法(null)；非法返回字段标识（startedAt/completedAt）
  function validateDateSegments(seg, name) {
    const y = seg.y.trim(), m = seg.m.trim(), d = seg.d.trim();
    if (!y && !m && !d) return null; // 全空 = 未设置，合法
    if (!/^\d{4}$/.test(y) || +y < 1900 || +y > new Date().getFullYear() + 1) return name;
    if (!/^\d{1,2}$/.test(m) || +m < 1 || +m > 12) return name;
    if (!/^\d{1,2}$/.test(d)) return name;
    const maxDay = new Date(Date.UTC(+y, +m, 0)).getUTCDate(); // 当月天数（含大小月/闰年）
    if (+d < 1 || +d > maxDay) return name;
    return null;
  }

  function stepperChange(field, delta, min, max, step) {
    const currentVal = field === 'ratingVal' ? ratingVal : progressVal;
    const current = currentVal === '—' ? 0 : parseFloat(currentVal) || 0;
    let newVal = Math.round((current + delta) / step) * step;
    newVal = Math.max(min, Math.min(max, newVal));
    // 消除浮点误差（如 8.7+0.1 → 8.800000000000001），保留 1 位小数
    newVal = Math.round(newVal * 10) / 10;
    if (field === 'ratingVal') {
      ratingVal = newVal === 0 && delta < 0 ? '—' : String(newVal);
    } else {
      progressVal = newVal === 0 && delta < 0 ? '—' : String(newVal);
    }
  }

  // 评分输入：清洗为合法数字（0-10，最多 1 位小数），留空 = '—'
  function onRatingInput(e) {
    let v = e.target.value;
    if (v === '') { ratingVal = '—'; return; }
    // 剥离非数字/非小数点字符
    let cleaned = v.replace(/[^\d.]/g, '');
    // 只保留第一个小数点
    const firstDot = cleaned.indexOf('.');
    if (firstDot !== -1) {
      cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
    }
    // 最多 1 位小数
    if (cleaned.includes('.')) {
      const [int, dec] = cleaned.split('.');
      cleaned = int + '.' + dec.slice(0, 1);
    }
    e.target.value = cleaned;
    ratingVal = cleaned;
  }
  function onRatingBlur(e) {
    const v = ratingVal;
    if (v === '—' || v === '') { ratingVal = '—'; e.target.value = '—'; return; }
    const n = parseFloat(v);
    if (isNaN(n)) { ratingVal = '—'; e.target.value = '—'; return; }
    // 夹到 0-10，保留 1 位小数
    const clamped = Math.min(10, Math.max(0, n));
    const rounded = Math.round(clamped * 10) / 10;
    ratingVal = String(rounded);
    e.target.value = String(rounded);
  }

  // 进度输入：仅整数，留空 = '—'
  function onProgressInput(e) {
    let v = e.target.value;
    if (v === '') { progressVal = '—'; return; }
    const cleaned = v.replace(/\D/g, '');
    e.target.value = cleaned;
    progressVal = cleaned;
  }
  function onProgressBlur(e) {
    const v = progressVal;
    if (v === '—' || v === '') { progressVal = '—'; e.target.value = '—'; return; }
    const n = parseInt(v, 10);
    if (isNaN(n)) { progressVal = '—'; e.target.value = '—'; return; }
    // 夹到 0 ~ 本地集数
    const clamped = Math.min(progressMax, Math.max(0, n));
    progressVal = String(clamped);
    e.target.value = String(clamped);
  }

  async function saveStatusModal() {
    const id = item && item.id;
    if (!id) return;

    saving = true;
    const statusVal = status;
    const rating = ratingVal !== '—' ? parseFloat(ratingVal) : null;
    const progress = progressVal !== '—' ? parseInt(progressVal, 10) : null;

    // 日期校验：非法则红框提示并聚焦出错字段，中止保存
    const startErr = validateDateSegments(startSeg, 'startedAt');
    const endErr = validateDateSegments(endSeg, 'completedAt');
    const errName = startErr || endErr;
    if (errName) {
      const segs = document.querySelector(`.date-segments[data-date="${errName}"]`);
      if (segs) {
        segs.classList.add('invalid');
        const firstEmpty = [...segs.querySelectorAll('.date-seg')].find((inp) => !inp.value.trim());
        (firstEmpty || segs.querySelector('.date-seg'))?.focus();
      }
      showToast(tr('mylist.invalidDate'), 'error');
      return;
    }

    const startedAt = readDateSegments(startSeg);
    const completedAt = readDateSegments(endSeg);

    const data = {
      status: statusVal,
      rating,
      progress,
      startedAt: startedAt ? startedAt + 'T00:00:00.000Z' : null,
      completedAt: completedAt ? completedAt + 'T00:00:00.000Z' : null,
      notes,
    };

    try {
      await api.put('/api/mylist/' + encodeURIComponent(id), data);
      showToast(tr('mylist.saved'), 'success');
      open = false;
      if (onSaved) onSaved();
    } catch (e) {
      showToast(tr('mylist.saveFailed', { message: e.message }), 'error');
    } finally {
      saving = false;
    }
  }
</script>

{#if open}
  <div class="modal-overlay show" id="svelte-statusModal" onclick={(e) => { if (e.target === e.currentTarget) open = false; }}>
    <div class="modal status-modal">
      <button class="status-modal-close" onclick={() => (open = false)} aria-label={tr('common.close')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="status-modal-inner">
        <div class="status-modal-heading-row">
          <h2 class="status-modal-heading" id="svelte-statusModalTitle">{statusModalTitle}</h2>
        </div>
        <div class="status-modal-body">
          <div class="field-row">
            <div class="field-cell">
              <label class="field-label" for="svelte-statusDdTrigger">{tr('common.status')}</label>
              <div class="status-dd" id="svelte-statusDd" class:is-open={statusDdOpen}>
                <Select.Root type="single" bind:value={status} bind:open={statusDdOpen}>
                  <Select.Trigger class="status-dd-trigger" id="svelte-statusDdTrigger">
                    <span class="status-dd-text" id="svelte-statusDdText">{getStatusLabels()[status] || tr('common.wish')}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="status-dd-chevron"><polyline points="6 9 12 15 18 9"/></svg>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Content class="status-dd-menu" id="svelte-statusDdMenu" align="start" style="width: var(--bits-floating-anchor-width)">
                      <Select.Item value="watching">
                        {#snippet child(p)}
                          <div {...p.props} class="status-dd-opt" class:is-selected={p.selected}>
                            <svg class="status-dd-opt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="9"/></svg>
                            <span>{tr('common.watching')}</span>
                            <svg class="status-dd-opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                          </div>
                        {/snippet}
                      </Select.Item>
                      <Select.Item value="wish">
                        {#snippet child(p)}
                          <div {...p.props} class="status-dd-opt" class:is-selected={p.selected}>
                            <svg class="status-dd-opt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                            <span>{tr('common.wish')}</span>
                            <svg class="status-dd-opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                          </div>
                        {/snippet}
                      </Select.Item>
                      <Select.Item value="completed">
                        {#snippet child(p)}
                          <div {...p.props} class="status-dd-opt" class:is-selected={p.selected}>
                            <svg class="status-dd-opt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                            <span>{tr('common.completed')}</span>
                            <svg class="status-dd-opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                          </div>
                        {/snippet}
                      </Select.Item>
                      <Select.Item value="on_hold">
                        {#snippet child(p)}
                          <div {...p.props} class="status-dd-opt" class:is-selected={p.selected}>
                            <svg class="status-dd-opt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                            <span>{tr('common.on_hold')}</span>
                            <svg class="status-dd-opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                          </div>
                        {/snippet}
                      </Select.Item>
                      <Select.Item value="dropped">
                        {#snippet child(p)}
                          <div {...p.props} class="status-dd-opt" class:is-selected={p.selected}>
                            <svg class="status-dd-opt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            <span>{tr('common.dropped')}</span>
                            <svg class="status-dd-opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                          </div>
                        {/snippet}
                      </Select.Item>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>
              </div>
            </div>
            <div class="field-cell">
              <label class="field-label" for="svelte-ratingDisplay">{tr('common.rating')}</label>
              <div class="num-stepper" id="svelte-ratingStepper" data-min="0" data-max="10" data-step="0.1">
                <button type="button" class="num-stepper-btn" onclick={() => stepperChange('ratingVal', -0.1, 0, 10, 0.1)}>−</button>
                <input
                  type="text"
                  class="num-stepper-val"
                  id="svelte-ratingDisplay"
                  inputmode="decimal"
                  value={ratingVal}
                  oninput={(e) => onRatingInput(e)}
                  onblur={(e) => onRatingBlur(e)}
                  aria-label={tr('common.rating')}
                  style="border:none;background:transparent;outline:none;text-align:center;min-width:0;flex:1"
                />
                <button type="button" class="num-stepper-btn" onclick={() => stepperChange('ratingVal', 0.1, 0, 10, 0.1)}>+</button>
              </div>
            </div>
            <div class="field-cell">
              <label class="field-label" for="svelte-progressDisplay">{tr('mylist.progressEpisodes')}</label>
              <div class="num-stepper" id="svelte-progressStepper" data-min="0" data-max={progressMax} data-step="1">
                <button type="button" class="num-stepper-btn" onclick={() => stepperChange('progressVal', -1, 0, progressMax, 1)}>−</button>
                <input
                  type="text"
                  class="num-stepper-val"
                  id="svelte-progressDisplay"
                  inputmode="numeric"
                  value={progressVal}
                  oninput={(e) => onProgressInput(e)}
                  onblur={(e) => onProgressBlur(e)}
                  aria-label={tr('mylist.progressEpisodes')}
                  style="border:none;background:transparent;outline:none;text-align:center;min-width:0;flex:1"
                />
                <button type="button" class="num-stepper-btn" onclick={() => stepperChange('progressVal', 1, 0, progressMax, 1)}>+</button>
              </div>
            </div>
          </div>
          <div class="field-row">
            <div class="field-cell">
              <label class="field-label" for="svelte-startDateY">{tr('common.startDate')}</label>
              <div class="date-segments" data-date="startedAt">
                <input type="text" class="date-seg date-seg--y" id="svelte-startDateY" maxlength="4" placeholder="YYYY" inputmode="numeric" value={startSeg.y} oninput={(e) => segAutoTab(e, startSeg, 'y')} onkeydown={segBackspace} aria-label={tr('mylist.startDateYear')}>
                <span class="date-sep">/</span>
                <input type="text" class="date-seg date-seg--m" maxlength="2" placeholder="MM" inputmode="numeric" value={startSeg.m} oninput={(e) => segAutoTab(e, startSeg, 'm')} onkeydown={segBackspace} aria-label={tr('mylist.startDateMonth')}>
                <span class="date-sep">/</span>
                <input type="text" class="date-seg date-seg--d" maxlength="2" placeholder="DD" inputmode="numeric" value={startSeg.d} oninput={(e) => segAutoTab(e, startSeg, 'd')} onkeydown={segBackspace} aria-label={tr('mylist.startDateDay')}>
              </div>
            </div>
            <div class="field-cell">
              <label class="field-label" for="svelte-endDateY">{tr('common.endDate')}</label>
              <div class="date-segments" data-date="completedAt">
                <input type="text" class="date-seg date-seg--y" id="svelte-endDateY" maxlength="4" placeholder="YYYY" inputmode="numeric" value={endSeg.y} oninput={(e) => segAutoTab(e, endSeg, 'y')} onkeydown={segBackspace} aria-label={tr('mylist.endDateYear')}>
                <span class="date-sep">/</span>
                <input type="text" class="date-seg date-seg--m" maxlength="2" placeholder="MM" inputmode="numeric" value={endSeg.m} oninput={(e) => segAutoTab(e, endSeg, 'm')} onkeydown={segBackspace} aria-label={tr('mylist.endDateMonth')}>
                <span class="date-sep">/</span>
                <input type="text" class="date-seg date-seg--d" maxlength="2" placeholder="DD" inputmode="numeric" value={endSeg.d} oninput={(e) => segAutoTab(e, endSeg, 'd')} onkeydown={segBackspace} aria-label={tr('mylist.endDateDay')}>
              </div>
            </div>
            <div class="field-cell">
              <label class="field-label" for="svelte-notesInput">{tr('common.notes')}</label>
              <input type="text" id="svelte-notesInput" class="notes-input" placeholder={tr('mylist.notesPlaceholder')} maxlength="200" bind:value={notes} aria-label={tr('common.notes')}>
            </div>
          </div>
        </div>
        <div class="status-modal-footer">
          <button class="btn btn-primary" onclick={saveStatusModal} disabled={saving} aria-busy={saving}>
            {#if saving}
              <span class="btn-spinner spin" aria-hidden="true"></span>
              {tr('common.save')}
            {:else}
              {tr('common.save')}
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}